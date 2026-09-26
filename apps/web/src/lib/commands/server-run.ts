/**
 * Headless runners: the same commands as ./run.ts (⌘K, WebMCP, window.darwin), for callers without a browser:
 * the Darwin control MCP server (/api/darwin/mcp) and the CLI (scripts/darwin.ts).
 *
 * Every runner calls the same HTTP API routes the browser runners call, against `origin`, forwarding the
 * caller's Authorization / Cookie, so the admin gate (lib/auth/admin.ts) applies exactly as in the console.
 * Browser-only effects (navigate, highlight) become an absolute `href` with "open this page" text.
 *
 * Confirm-risk commands (rollback, act_on_briefing) never run unless the input carries `confirm: true`:
 * without it they answer { ok: false } with the exact question the console would ask, and change nothing.
 */
import type { Insight, LoopState } from "@/lib/contracts";
import { money, PHASE_META, pct } from "@/lib/console/format";
import { ROADMAP, roadmapArea, roadmapFor, whatsLeftText, type RoadmapArea } from "@/lib/status/roadmap";
import { resolveSite, siteSlug } from "./parse";
import { describeStore, installState, installText, platformText, researchText, type InspectLite, type ResearchLite, type VerifyLite, type WhichStore } from "./results";
import { AGENT_LEVERS, inputJsonSchema, pageHref, PAGE_KEYS, PAGES, resolveCommand, specOf, type CommandInput, type PageKey } from "./specs";
import type { CommandName, CommandResult, CommandSites } from "./types";

/* ------------------------------------------------------------------ options */

export interface HeadlessOptions {
  /** Darwin's origin, e.g. "http://localhost:3000". Every route is called against it. */
  origin: string;
  /** Forwarded to every call (Authorization, Cookie). Only these two are kept. */
  headers?: Headers | Record<string, string | undefined>;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** The page the caller is "on" (whats_left without an area). */
  page?: string;
  /** Earlier turns, for ask_darwin follow-ups. */
  history?: { role: "user" | "darwin"; text: string }[];
}

interface Ctx {
  origin: string;
  headers: Record<string, string>;
  fetch: typeof fetch;
  page?: string;
  history?: { role: "user" | "darwin"; text: string }[];
}

const FORWARD = ["authorization", "cookie"] as const;

function ctxOf(opts: HeadlessOptions): Ctx {
  const headers: Record<string, string> = {};
  const src = opts.headers;
  for (const k of FORWARD) {
    const v = src instanceof Headers ? src.get(k) : src ? (Object.entries(src).find(([key]) => key.toLowerCase() === k)?.[1] ?? undefined) : undefined;
    if (v) headers[k] = v;
  }
  return { origin: opts.origin.replace(/\/+$/, ""), headers, fetch: opts.fetch ?? fetch, page: opts.page, history: opts.history };
}

/* ------------------------------------------------------------------ http */

export class HeadlessHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function http<T>(ctx: Ctx, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await ctx.fetch(`${ctx.origin}${path}`, {
    method,
    headers: { ...ctx.headers, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new HeadlessHttpError(j.error ?? `${method} ${path} answered ${res.status}`, res.status);
  return j;
}

const abs = (ctx: Ctx, href: string) => new URL(href, `${ctx.origin}/`).toString();
const n = (v: number) => v.toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const impact = (v: number) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ""));
const rankInsights = (loop: LoopState): Insight[] => [...loop.insights].sort((a, b) => b.impactScore - a.impactScore);

async function sites(ctx: Ctx): Promise<CommandSites> {
  const r = await http<{ context?: { sites?: CommandSites } }>(ctx, "GET", "/api/command");
  return r.context?.sites ?? { tracking: [], web: [] };
}

/** Named site (fuzzy against known ones), else the only one known. */
async function pickSite(ctx: Ctx, named: string | undefined, kind: keyof CommandSites): Promise<{ site?: string; known: string[] }> {
  const known = (await sites(ctx).catch(() => ({ tracking: [], web: [] }) as CommandSites))[kind];
  if (named) return { site: resolveSite(named, known), known };
  return { site: known.length === 1 ? known[0] : undefined, known };
}

/* ------------------------------------------------------------------ runners */

type Runner<N extends CommandName> = {
  run(input: CommandInput<N>, ctx: Ctx): Promise<CommandResult>;
  confirm?(input: CommandInput<N>, ctx: Ctx): Promise<string>;
};

interface BriefingItemLite {
  id: string;
  title: string;
  say: string;
  status: string;
  kind: string;
  traffic: string;
  actions: string[];
  url?: string;
}
interface BriefingLite {
  headline?: string;
  text: string;
  ask?: { id: string; action: string };
  items: BriefingItemLite[];
}

async function briefingItem(ctx: Ctx, action: "ship" | "stop", id?: string): Promise<BriefingItemLite | undefined> {
  const b = await http<BriefingLite>(ctx, "GET", "/api/briefing");
  if (id) return b.items.find((i) => i.id === id);
  if (b.ask?.action === action) return b.items.find((i) => i.id === b.ask!.id);
  return b.items.find((i) => i.actions.includes(action));
}

const RUNNERS: { [N in CommandName]: Runner<N> } = {
  navigate: {
    async run({ page, site, id }, ctx) {
      const href = abs(ctx, pageHref(page, { site, id }));
      return { ok: true, text: `Open this page: ${PAGES[page].label}${site ? ` for ${site}` : ""} at ${href}`, href, linkLabel: `Open ${PAGES[page].label}` };
    },
  },

  build_dashboard: {
    async run({ request, site: named }, ctx) {
      const { site, known } = await pickSite(ctx, named, "tracking");
      if (!site) {
        return {
          ok: false,
          text: known.length ? `Which store? Darwin has tracking plans for ${known.join(", ")}: pass site, e.g. “${known[0]}”.` : "No store has a tracking plan yet: set one up first and Darwin builds its dashboards.",
          href: abs(ctx, known.length ? "/console/dashboards" : "/onboarding"),
          linkLabel: known.length ? "Open dashboards" : "Set up a store",
        };
      }
      let res: { reply: string; id?: string };
      try {
        res = await http(ctx, "POST", "/api/dashboards", { site, message: request });
      } catch (err) {
        const missing = err instanceof HeadlessHttpError && err.status === 404;
        return { ok: false, text: (err as Error).message, href: missing ? abs(ctx, "/onboarding") : undefined, linkLabel: missing ? "Set up a store" : undefined };
      }
      const href = abs(ctx, pageHref("dashboards", { site }));
      if (!res.id) return { ok: false, text: res.reply, href, linkLabel: "Open dashboards" };
      return { ok: true, text: `${res.reply} Open this page to see it: ${href}`, href, linkLabel: "Open dashboards", data: { site, id: res.id } };
    },
  },

  simulate_traffic: {
    async run({ humans, agents }, ctx) {
      if (!humans && !agents) return { ok: false, text: "Nothing to send: ask for some people or agents." };
      const r = await http<{ humans: number; agents: number; orders: number; revenue: number }>(ctx, "POST", "/api/simulate", { humans, agents });
      const who = [r.humans ? plural(r.humans, "simulated person", "simulated people") : "", r.agents ? plural(r.agents, "simulated AI agent") : ""].filter(Boolean).join(" and ");
      const orders = r.orders ? `${plural(r.orders, "order")} (${money(r.revenue)})` : "no orders";
      return { ok: true, text: `Sent ${who}: ${orders}. All of it is labelled simulated.`, synthetic: true, href: abs(ctx, "/console"), linkLabel: "See Overview", data: r };
    },
  },

  set_autopilot: {
    async run({ on }, ctx) {
      const loop = await http<LoopState>(ctx, "POST", "/api/loop/autopilot", { on });
      if (loop.autopilot !== on) return { ok: false, text: "Darwin couldn't change autopilot just now. Try again in a moment." };
      return {
        ok: true,
        text: on
          ? "Autopilot is on: Darwin observes, tests and ships winners on its own while the console is open. Headless, feed it with simulate_traffic and move it with step_loop."
          : "Autopilot is paused. Darwin waits for you to step the loop.",
        href: abs(ctx, "/console"),
        linkLabel: "See Overview",
        data: { autopilot: loop.autopilot, phase: loop.phase, generation: loop.generation },
      };
    },
  },

  step_loop: {
    async run({ times }, ctx) {
      const before = await http<LoopState>(ctx, "GET", "/api/loop").catch(() => undefined);
      let last: LoopState | undefined;
      for (let i = 0; i < times; i++) last = await http<LoopState>(ctx, "POST", "/api/loop/step", {});
      if (!last) return { ok: false, text: "The loop didn't move." };
      const from = before ? PHASE_META[before.phase].label : undefined;
      const to = PHASE_META[last.phase];
      const said = last.log.at(-1)?.message;
      const moved = from && from !== to.label ? `Darwin moved from ${from} to ${to.label}` : `Darwin is at ${to.label}`;
      return { ok: true, text: `${moved}${said ? `: ${said}` : `. ${to.blurb}.`}`, href: abs(ctx, "/console"), linkLabel: "See Overview", data: { phase: last.phase, generation: last.generation } };
    },
  },

  send_shopper: {
    async run({ brief, via }, ctx) {
      const { session: s } = await http<{
        session: { agentName: string; outcome: string; orderTotal?: number; reason?: string; synthetic?: boolean; toolCalls: unknown[] };
      }>(ctx, "POST", "/api/agent/shop", { brief, useLlm: true, via });
      const tag = s.synthetic ? " (simulated)" : "";
      const text =
        s.outcome === "purchased"
          ? `${s.agentName} bought${s.orderTotal ? ` for ${money(s.orderTotal)}` : ""}${tag}, in ${plural(s.toolCalls.length, "step")}.`
          : s.outcome === "abandoned"
            ? `${s.agentName} left without buying${s.reason ? `: ${s.reason}` : ""}${tag}.`
            : `${s.agentName} is still shopping${tag}.`;
      return { ok: true, text, synthetic: s.synthetic, href: abs(ctx, "/console"), linkLabel: "See live shoppers", data: s };
    },
  },

  ask_darwin: {
    async run({ question }, ctx) {
      const r = await http<{ answer: string; cards?: { label: string; value: string }[]; source: "llm" | "heuristic" }>(ctx, "POST", "/api/ask", {
        question,
        history: ctx.history?.slice(-10),
      });
      return { ok: true, text: r.answer, data: { cards: r.cards ?? [], source: r.source } };
    },
  },

  open_issue: {
    async run({ rank, id }, ctx) {
      const loop = await http<LoopState>(ctx, "GET", "/api/loop");
      const ranked = rankInsights(loop);
      const list = abs(ctx, "/console/issues");
      if (!ranked.length) return { ok: false, text: "Darwin hasn't found any issues yet: let it observe some shoppers first.", href: list, linkLabel: "Open Issues" };
      const i = id ? ranked.findIndex((x) => x.id === id) : (rank ?? 1) - 1;
      const insight = ranked[i];
      if (!insight) return { ok: false, text: id ? `There's no issue with id ${id}.` : `There are only ${plural(ranked.length, "issue")} right now.`, href: list, linkLabel: "Open Issues" };
      const href = abs(ctx, pageHref("issues", { id: insight.id }));
      return {
        ok: true,
        text: `Issue ${i + 1} of ${ranked.length}: ${insight.title}. About ${impact(insight.impactScore)} buyers lost per 1,000 visits. Open this page: ${href}`,
        href,
        linkLabel: "Open the issue",
        data: { id: insight.id, rank: i + 1, insight },
      };
    },
  },

  rollback: {
    async confirm({ generation }, ctx) {
      const loop = await http<LoopState>(ctx, "GET", "/api/loop").catch(() => undefined);
      const rec = loop?.history.find((h) => h.generation === generation);
      if (!loop) return `Put Gen ${generation} back live? Shoppers see its store right away and any running test stops.`;
      if (!rec) return `Gen ${generation} was never shipped (live is Gen ${loop.generation}). Try anyway?`;
      const label = rec.label?.replace(/^gen(?:eration)?\s*\d+\s*[:·—-]\s*/i, "").trim();
      return `Put Gen ${generation}${label ? ` (“${label}”)` : ""} back live instead of Gen ${loop.generation}? Shoppers see it right away and any running test stops.`;
    },
    async run({ generation }, ctx) {
      const loop = await http<LoopState>(ctx, "POST", "/api/loop/rollback", { generation });
      return {
        ok: true,
        text: `Gen ${generation}'s store is live again (now Gen ${loop.generation}). The rollback is recorded on Changes.`,
        href: abs(ctx, "/console/changes"),
        linkLabel: "Open Changes",
        data: { generation: loop.generation },
      };
    },
  },

  start_agent_test: {
    async run({ lever, buyers }, ctx) {
      const href = abs(ctx, "/console/agents");
      try {
        const r = await http<{ did?: string[] }>(ctx, "POST", "/api/store-agent/tests", { start: lever, ...(buyers ? { buyers } : {}) });
        const sent = buyers ? ` and sent ${plural(buyers, "simulated buyer agent")}` : "";
        return { ok: true, text: `Started testing “${AGENT_LEVERS[lever]}” on your store agent${sent}. Half the conversations get it; payments decide.`, synthetic: !!buyers, href, linkLabel: "Open Store agent", data: r };
      } catch (err) {
        return { ok: false, text: `Couldn't start it: ${(err as Error).message}.`, href, linkLabel: "Open Store agent" };
      }
    },
  },

  set_agent_autopilot: {
    async run({ on }, ctx) {
      const r = await http<{ did?: string[] }>(ctx, "POST", "/api/store-agent/tests", { autopilot: on });
      const did = r.did?.length ? ` ${r.did.join(" ")}` : "";
      return {
        ok: true,
        text: on ? `Store agent autopilot is on: Darwin tests one pitch lever at a time and keeps the winners.${did}` : "Store agent autopilot is paused.",
        href: abs(ctx, "/console/agents"),
        linkLabel: "Open Store agent",
      };
    },
  },

  draft_personalization: {
    async run({ prompt, site: named }, ctx) {
      const { site, known } = await pickSite(ctx, named, "web");
      if (!site) return { ok: false, text: known.length ? `Which site? darwin.js runs on ${known.join(", ")}: pass site.` : "No site runs darwin.js yet.", href: abs(ctx, "/console/personalize"), linkLabel: "Open Personalize" };
      const draft = await http<{ rule: { name: string; audience: { sources?: string[] }; changes: unknown[] }; source: string }>(ctx, "POST", "/api/web/draft", { site, prompt });
      const saved = await http<{ rule: { id: string; name: string; status: string } }>(ctx, "POST", "/api/web/rules", { rule: draft.rule, status: "draft" });
      const href = abs(ctx, pageHref("personalize", { site }));
      const who = draft.rule.audience.sources?.length ? `visitors from ${draft.rule.audience.sources.join(", ")}` : "every visitor";
      const blanks = JSON.stringify(draft.rule.changes).includes("[Your") ? " Fill in the [Your …] blanks first." : "";
      return {
        ok: true,
        text: `Drafted “${saved.rule.name}” for ${who}: ${plural(draft.rule.changes.length, "change")}. Saved as a draft, not live: review it on Personalize (${href}) and press Start to test it.${blanks}`,
        href,
        linkLabel: "Review the draft",
        data: { site, ruleId: saved.rule.id, source: draft.source },
      };
    },
  },

  briefing: {
    async run(_input, ctx) {
      const b = await http<BriefingLite>(ctx, "GET", "/api/briefing");
      const url = b.items.find((i) => i.url)?.url;
      return { ok: true, text: b.text, href: abs(ctx, url ?? "/console/settings"), linkLabel: "See details", synthetic: b.items.some((i) => i.traffic !== "real"), data: b };
    },
  },

  act_on_briefing: {
    async confirm({ action, id }, ctx) {
      const item = await briefingItem(ctx, action, id).catch(() => undefined);
      if (!item) return action === "ship" ? "Ship the test Darwin recommends?" : "Stop the test Darwin flagged?";
      return `${action === "ship" ? "Ship" : "Stop"} “${item.title}”? ${item.say}`;
    },
    async run({ action, id }, ctx) {
      const item = await briefingItem(ctx, action, id);
      if (!item) return { ok: false, text: action === "ship" ? "Nothing is ready to ship right now." : "No running test to stop right now.", href: abs(ctx, "/console/experiments"), linkLabel: "Open Experiments" };
      const r = await http<{ ok: boolean; text: string }>(ctx, "POST", "/api/briefing/act", { id: item.id, action });
      return { ok: r.ok, text: r.text, href: item.url ? abs(ctx, item.url) : undefined, linkLabel: "See it" };
    },
  },

  whats_left: {
    async run({ area }, ctx) {
      const a = area ? roadmapArea(area) : ctx.page ? roadmapFor(ctx.page) : undefined;
      if (a) return { ok: true, text: whatsLeftText(a), href: abs(ctx, a.route), data: a };
      if (area || ctx.page) return { ok: false, text: "This page isn't on the roadmap yet." };
      return { ok: true, text: roadmapOverview(), data: ROADMAP.map(roadmapLine) };
    },
  },

  start_demo: {
    async run(_input, ctx) {
      const demo = await http<DemoResponseLite>(ctx, "POST", "/api/demo");
      const loop = await http<LoopState>(ctx, "POST", "/api/loop/autopilot", { on: true });
      // Headless there's no open console to keep shoppers coming, so top the store up once when /api/demo didn't.
      const sim = demo.action === "none" || !demo.action ? await http<SimLite>(ctx, "POST", "/api/simulate", { humans: 200, agents: 20 }).catch(() => undefined) : undefined;
      const filled =
        demo.action === "seeded"
          ? `Darwin filled the demo store with simulated shoppers and ran its loop to Gen ${demo.status.generation}`
          : demo.action === "refilled"
            ? "Darwin sent a fresh round of simulated shoppers to the demo store"
            : sim
              ? `Darwin sent ${plural(sim.humans, "simulated person", "simulated people")} and ${plural(sim.agents, "simulated AI agent")} to the demo store`
              : "The demo store already has simulated shoppers";
      const auto = loop.autopilot ? "Autopilot is on: Darwin observes, tests and ships winners by itself (move it along headless with step_loop or watch_fix)." : "Autopilot didn't switch on: try set_autopilot.";
      const connected = demo.status.mode === "connected" ? " Note: a store of yours is connected too; this only runs on the demo store." : "";
      return {
        ok: loop.autopilot,
        text: `${filled}. ${auto} Every shopper here is simulated and labelled.${connected}`,
        synthetic: true,
        href: abs(ctx, "/console"),
        linkLabel: "Watch it on Overview",
        data: { demo, autopilot: loop.autopilot, phase: loop.phase, generation: loop.generation, simulated: sim },
      };
    },
  },

  watch_fix: {
    async run({ steps }, ctx) {
      const before = await http<LoopState>(ctx, "GET", "/api/loop").catch(() => undefined);
      const startLen = before?.log.length ?? 0;
      const phases: { phase: LoopState["phase"]; said?: string }[] = [];
      let last: LoopState | undefined;
      for (let i = 0; i < steps; i++) {
        last = await http<LoopState>(ctx, "POST", "/api/loop/step", {});
        phases.push({ phase: last.phase, said: last.log.at(-1)?.message });
        if (last.log.length > startLen && (last.phase === "ship" || last.phase === "idle")) break;
      }
      if (!last) return { ok: false, text: "The loop didn't move." };
      const lines = phases.map((p, i) => `${i + 1}. ${PHASE_META[p.phase].label}${p.said ? `: ${p.said}` : ""}`);
      const end = last.phase === "ship" ? `Darwin reached Ship (Gen ${last.generation} live).` : last.phase === "idle" ? "The run is done: Darwin is back at Idle." : `Darwin stopped at ${PHASE_META[last.phase].label} after ${plural(phases.length, "phase")}: run watch_fix again to carry on.`;
      return {
        ok: true,
        text: `${lines.join("\n")}\n${end} Test traffic in the experiment phase is simulated.`,
        synthetic: true,
        href: abs(ctx, "/console"),
        linkLabel: "See Overview",
        data: { phases: phases.map((p) => p.phase), generation: last.generation, phase: last.phase },
      };
    },
  },

  check_install: {
    async run({ url: given, site: named }, ctx) {
      const known = await sites(ctx).catch(() => ({ tracking: [], web: [] }) as CommandSites);
      const all = [...new Set([...known.tracking, ...known.web])];
      const saved = given ? undefined : await savedStore(ctx, named ?? (all.length === 1 ? all[0] : undefined));
      const url = given ?? saved?.url;
      if (!url) {
        return { ok: false, text: "Which store should Darwin check? Pass url, your store's address (like https://shop.example.com).", href: abs(ctx, "/onboarding"), linkLabel: "Set up a store" };
      }
      const site = named ? resolveSite(named, all) : (saved?.site ?? resolveSite(siteSlug(url), all));
      if (!site) return { ok: false, text: `Which darwin.js site is ${url}? Pass site.` };
      const v = await http<VerifyLite>(ctx, "GET", `/api/onboarding/verify?${new URLSearchParams({ site, url })}`);
      const state = installState(v);
      return { ok: true, text: installText(state, v), href: abs(ctx, "/onboarding"), linkLabel: "Open setup", data: { state, site, ...v } };
    },
  },

  save_setup: {
    async run({ email, site: named }, ctx) {
      if (!email) return { ok: false, text: "What email should Darwin save your setup under? Pass email. Nothing is sent to it: you get a link to keep." };
      const site = named ? resolveSite(named, (await sites(ctx).catch(() => ({ tracking: [], web: [] }) as CommandSites)).tracking) : undefined;
      const r = await http<{ email: string; resumeUrl: string }>(ctx, "POST", "/api/account", { email, ...(site ? { site } : {}) });
      return {
        ok: true,
        text: `Saved your setup under ${r.email}${site ? ` for ${site}` : ""}. Keep this link to pick up where you left off on any browser (valid 30 days): ${r.resumeUrl}. Nothing was emailed.`,
        href: r.resumeUrl,
        linkLabel: "Resume link",
        data: { email: r.email, site, resumeUrl: r.resumeUrl },
      };
    },
  },

  which_store: {
    async run(_input, ctx) {
      const w = await whichStore(ctx);
      return { ok: true, text: w.text, href: abs(ctx, w.demo ? "/store" : "/console/settings"), linkLabel: w.demo ? "Open the demo store" : "Open Settings", data: w };
    },
  },

  detect_platform: {
    async run({ url }, ctx) {
      const r = await http<InspectLite>(ctx, "GET", `/api/onboarding/inspect?${new URLSearchParams({ url })}`);
      return { ok: r.reachable, text: platformText(r), href: abs(ctx, "/onboarding"), linkLabel: "Set up this store", data: r };
    },
  },

  research_competitors: {
    async run({ query, store }, ctx) {
      const r = await http<ResearchLite>(ctx, "POST", "/api/research", { kind: "competitors", query, ...(store ? { store } : {}) });
      const href = abs(ctx, `/console/research?id=${encodeURIComponent(r.id)}`);
      return { ok: true, text: `${researchText(r)} Full report: ${href}`, href, linkLabel: "Open the report", data: r };
    },
  },
};

/* ------------------------------------------------------------------ helpers for the setup / demo commands */

interface DemoResponseLite {
  status: { mode: "demo" | "connected"; generation: number; hasSimulatedTraffic: boolean; connections: { github?: string; sites: string[]; whop?: string } };
  action?: "seeded" | "refilled" | "none";
  steps?: number;
}
interface SimLite {
  humans: number;
  agents: number;
  orders: number;
  revenue: number;
}
/** The onboarding store for a site (its tracking plan's address), when one is saved. */
async function savedStore(ctx: Ctx, site: string | undefined): Promise<{ site: string; url?: string } | undefined> {
  if (!site) return undefined;
  const r = await http<{ plan?: { siteUrl?: string } }>(ctx, "GET", `/api/onboarding/plan?${new URLSearchParams({ site })}`).catch(() => undefined);
  const url = r?.plan?.siteUrl;
  return { site, url: url && /^https?:\/\//.test(url) ? url : undefined };
}

async function whichStore(ctx: Ctx): Promise<WhichStore> {
  const [gh, account, known] = await Promise.all([
    http<{ repo?: string; connection?: { repo?: string } }>(ctx, "GET", "/api/github/status").catch(() => undefined),
    http<{ email?: string; sites?: string[] }>(ctx, "GET", "/api/account").catch(() => undefined),
    sites(ctx).catch(() => ({ tracking: [], web: [] }) as CommandSites),
  ]);
  return describeStore(gh, account, known);
}

function roadmapLine(a: RoadmapArea) {
  return { key: a.key, name: a.name, route: a.route, status: a.status, leftToDo: a.leftToDo };
}

function roadmapOverview(): string {
  return ROADMAP.map((a) => `${a.name} (${a.status}${a.leftToDo.length ? `, ${plural(a.leftToDo.length, "thing")} left` : ""})`).join("; ") + ". Pass area for the detail.";
}

/* ------------------------------------------------------------------ entry points */

function parse(name: string, input: unknown): { name: CommandName; input: unknown } | { error: string } {
  const resolved = resolveCommand(name);
  if (!resolved) return { error: `Unknown command “${name}”.` };
  const raw = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : input ?? {};
  if (raw && typeof raw === "object") delete (raw as Record<string, unknown>).confirm;
  const parsed = specOf(resolved).input.safeParse(raw);
  if (!parsed.success) return { error: `Bad input for ${resolved}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}` };
  return { name: resolved, input: parsed.data };
}

/** True when the caller confirmed a risky command (input.confirm === true). */
export function isConfirmed(input: unknown): boolean {
  return !!input && typeof input === "object" && (input as Record<string, unknown>).confirm === true;
}

/** The question to ask before a confirm-risk command (falls back to its plain label). */
export async function confirmTextHeadless(name: string, input: unknown, opts: HeadlessOptions): Promise<string> {
  const p = parse(name, input);
  if ("error" in p) return p.error;
  const runner = RUNNERS[p.name] as Runner<CommandName>;
  const fallback = `${specOf(p.name).describe(p.input as never)}?`;
  if (!runner.confirm) return fallback;
  try {
    return await runner.confirm(p.input as never, ctxOf(opts));
  } catch {
    return fallback;
  }
}

/**
 * Validate and run one command headlessly. Never throws: failures come back as { ok: false, text }.
 * Confirm-risk commands need `confirm: true` in the input; without it nothing changes and the result carries the
 * question (`data.needsConfirmation`).
 */
export async function runCommandHeadless(name: string, input: unknown, opts: HeadlessOptions): Promise<CommandResult> {
  const p = parse(name, input);
  if ("error" in p) return { ok: false, text: p.error };
  const spec = specOf(p.name);
  if (spec.risk === "confirm" && !isConfirmed(input)) {
    const question = await confirmTextHeadless(p.name, input, opts);
    return { ok: false, text: question, data: { needsConfirmation: true, command: p.name, question, how: "Run it again with confirm: true to go ahead." } };
  }
  try {
    const runner = RUNNERS[p.name] as Runner<CommandName>;
    return await runner.run(p.input as never, ctxOf(opts));
  } catch (err) {
    return { ok: false, text: `${spec.title} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** A command's JSON Schema for headless callers: confirm-risk commands take a required-to-run `confirm` flag. */
export function headlessInputSchema(name: CommandName): Record<string, unknown> {
  const schema = inputJsonSchema(name);
  if (specOf(name).risk !== "confirm") return schema;
  const properties = { ...((schema.properties as Record<string, unknown>) ?? {}) };
  properties.confirm = { type: "boolean", description: "Set true once the merchant has approved this change. Without it Darwin only returns the question to ask." };
  return { ...schema, properties };
}

/* ------------------------------------------------------------------ read-only views (MCP resources-as-tools, CLI) */

export interface PageInfo {
  key: PageKey;
  label: string;
  url: string;
  purpose: string;
}

const PAGE_PURPOSE: Record<PageKey, string> = {
  overview: "Mission control: the loop, KPIs for humans vs AI agents, live shoppers.",
  issues: "Conversion problems Darwin found, ranked by buyers lost per 1,000 visits.",
  fixes: "Page changes Darwin proposed for those issues.",
  experiments: "A/B tests: running, decided and shipped, with probability to beat.",
  changes: "Shipped generations of the store, with rollback.",
  settings: "Connections (GitHub, Whop), keys, shipping rules.",
  agents: "The store's own AI agent (A2A): its funnel and pitch A/B tests.",
  dashboards: "Dashboards built from a site's tracking plan.",
  personalize: "darwin.js personalization rules for any store: drafts, tests, results.",
  traffic: "Where visitors and AI agents come from.",
  onboarding: "Set up a store: connect GitHub or Whop, choose what to track.",
  readiness: "Agent-readiness audit of any store URL.",
};

const EXTRA_PAGES = [
  { key: "store", label: "Demo storefront", href: "/store", purpose: "The PACE running store shoppers see (renders the live or test variant)." },
  { key: "llms", label: "llms.txt", href: "/llms.txt", purpose: "How AI shopping agents use the store (tools, MCP, A2A)." },
  { key: "store_mcp", label: "Store MCP", href: "/api/mcp", purpose: "MCP server for shopping agents (search, cart, checkout)." },
  { key: "darwin_mcp", label: "Darwin control MCP", href: "/api/darwin/mcp", purpose: "This control plane: every console command as an MCP tool (admin)." },
] as const;

export function darwinPages(origin: string): { key: string; label: string; url: string; purpose: string }[] {
  const o = origin.replace(/\/+$/, "");
  return [
    ...PAGE_KEYS.map((key) => ({ key, label: PAGES[key].label, url: `${o}${PAGES[key].href}`, purpose: PAGE_PURPOSE[key] })),
    ...EXTRA_PAGES.map((p) => ({ key: p.key, label: p.label, url: `${o}${p.href}`, purpose: p.purpose })),
  ];
}

/** Resolve "experiments", "Store agent", "store" → the page (for `darwin open <page>`). */
export function findPage(origin: string, query: string): { key: string; label: string; url: string; purpose: string } | undefined {
  const q = query.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const pages = darwinPages(origin);
  return pages.find((p) => p.key === q) ?? pages.find((p) => p.label.toLowerCase().replace(/[\s-]+/g, "_") === q) ?? pages.find((p) => p.key.startsWith(q) || p.label.toLowerCase().startsWith(q.replace(/_/g, " ")));
}

interface KpisLite {
  totalEvents: number;
  overall: { visitors: number; orders: number; revenue: number; conversionRate: number };
  byKind: Record<"human" | "agent", { visitors: number; orders: number; conversionRate: number }>;
}

/** The same snapshot the chat and Overview cite. One dataset: real, or labelled simulated, never both. */
interface SnapshotLite {
  kind: "real" | "simulated" | "empty";
  emptyLine: string;
  simulated: boolean;
  summary: KpisLite;
}

/** darwin_state / `darwin state`: the loop, the shared store snapshot and running tests, from the live API. */
export async function darwinState(opts: HeadlessOptions): Promise<CommandResult> {
  const ctx = ctxOf(opts);
  const [loop, snapRes, brief] = await Promise.allSettled([
    http<LoopState>(ctx, "GET", "/api/loop"),
    http<SnapshotLite>(ctx, "GET", "/api/analytics/snapshot"),
    http<BriefingLite>(ctx, "GET", "/api/briefing"),
  ]);
  if (loop.status === "rejected") return { ok: false, text: `Couldn't read Darwin's state: ${(loop.reason as Error).message}` };
  const l = loop.value;
  const lines: string[] = [];
  const top = rankInsights(l)[0];
  lines.push(
    `Loop: Gen ${l.generation} live, phase ${PHASE_META[l.phase].label}, autopilot ${l.autopilot ? "on" : "off"}${l.experimentId ? `, test ${l.experimentId} running` : ""}.`,
  );
  if (top) lines.push(`Top issue: ${top.title} (about ${impact(top.impactScore)} buyers lost per 1,000 visits).`);
  const snap = snapRes.status === "fulfilled" ? snapRes.value : undefined;
  if (snap?.kind === "empty") lines.push(snap.emptyLine);
  else if (snap) {
    const kpis = snap.summary;
    const o = kpis.overall;
    const note = snap.simulated ? " All of this is simulated traffic (synthetic)." : " All real traffic.";
    lines.push(
      `KPIs: ${plural(o.visitors, "visitor")}, ${plural(o.orders, "order")}, ${money(o.revenue)}, conversion ${pct(o.conversionRate)} (humans ${pct(kpis.byKind.human?.conversionRate)}, AI agents ${pct(kpis.byKind.agent?.conversionRate)}).${note}`,
    );
  }
  const items = brief.status === "fulfilled" ? brief.value.items : [];
  const live = items.filter((i) => ["running", "winning", "losing", "ready"].includes(i.status));
  lines.push(live.length ? `Running tests: ${live.map((i) => `${i.title} [${i.kind}, ${i.status}]${i.traffic !== "real" ? ` (${i.traffic} traffic)` : ""}`).join("; ")}.` : "No tests running.");
  if (brief.status === "fulfilled" && brief.value.ask) lines.push(`Darwin asks: ${brief.value.headline ?? brief.value.text}`);
  return {
    ok: true,
    text: lines.join("\n"),
    href: abs(ctx, "/console"),
    linkLabel: "Open Overview",
    synthetic: snap?.simulated || undefined,
    data: {
      loop: { phase: l.phase, generation: l.generation, autopilot: l.autopilot, experimentId: l.experimentId, designer: l.designer, insights: rankInsights(l).map((i) => ({ id: i.id, title: i.title, impactScore: i.impactScore })) },
      kpis: snap && snap.kind !== "empty" ? { kind: snap.kind, simulated: snap.simulated, overall: snap.summary.overall, byKind: snap.summary.byKind } : undefined,
      tests: live,
      ask: brief.status === "fulfilled" ? brief.value.ask : undefined,
    },
  };
}
