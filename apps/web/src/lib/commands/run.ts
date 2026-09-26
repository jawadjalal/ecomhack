/**
 * Browser runners: what each command does, through Darwin's existing APIs. `ConsoleApi` where it has a
 * method (so `?mock=1` keeps working), otherwise the existing routes. Every runner returns
 * { ok, text, href?, data? } with a human sentence built only from what the API reported.
 *
 * Callers (⌘K, WebMCP, window.darwin) go through `runCommand`, which validates the input first.
 * Confirm-risk commands are gated by the caller (the ⌘K runtime) before `runCommand` is reached.
 */
import type { Insight, LoopState } from "@/lib/contracts";
import type { ConsoleApi } from "@/lib/console/api";
import { money, PHASE_META } from "@/lib/console/format";
import { roadmapArea, roadmapFor, whatsLeftText } from "@/lib/status/roadmap";
import { resolveSite } from "./parse";
import { AGENT_LEVERS, pageHref, PAGES, resolveCommand, specOf, type CommandInput } from "./specs";
import type { CommandName, CommandResult, CommandSites } from "./types";

/* ------------------------------------------------------------------ context */

export interface CommandContext {
  api: ConsoleApi;
  mock: boolean;
  /** Live location (it changes while a plan runs). */
  location(): { pathname: string; search: string };
  /** Client-side navigation (keeps ?mock=1). */
  navigate(href: string): void;
  /** Wait for an element, scroll to it and pulse it. Resolves false when it never appears. */
  highlight(selector: string, opts?: { timeoutMs?: number }): Promise<boolean>;
  /** The provider's autopilot switch (keeps the nav in sync and starts simulated traffic when on). */
  setAutopilot(on: boolean): Promise<void>;
  /** Revalidate the console's live data after a change. */
  refresh(): void;
  /** Known sites (GET /api/command context). */
  sites(): Promise<CommandSites>;
  /** Earlier turns, for follow-up questions. */
  history?: { role: "user" | "darwin"; text: string }[];
}

type Runner<N extends CommandName> = {
  run(input: CommandInput<N>, ctx: CommandContext): Promise<CommandResult>;
  /** The concrete question to ask before a confirm-risk command runs. */
  confirm?(input: CommandInput<N>, ctx: CommandContext): Promise<string>;
};

/* ------------------------------------------------------------------ http */

async function http<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new HttpError(j.error ?? `${method} ${path} answered ${res.status}`, res.status);
  return j;
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const n = (v: number) => v.toLocaleString("en-GB");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const pageSite = (ctx: CommandContext) => new URLSearchParams(ctx.location().search).get("site") ?? undefined;

/** The site a command targets: named (fuzzy against known sites), the one on screen, or the only one known. */
async function pickSite(named: string | undefined, kind: keyof CommandSites, ctx: CommandContext, onPage: string): Promise<{ site?: string; known: string[] }> {
  const known = (await ctx.sites().catch(() => ({ tracking: [], web: [] })))[kind];
  if (named) return { site: resolveSite(named, known), known };
  const here = ctx.location().pathname.startsWith(onPage) ? pageSite(ctx) : undefined;
  if (here) return { site: here, known };
  return { site: known.length === 1 ? known[0] : undefined, known };
}

function rankInsights(loop: LoopState): Insight[] {
  return [...loop.insights].sort((a, b) => b.impactScore - a.impactScore);
}

const impact = (v: number) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ""));

/* ------------------------------------------------------------------ runners */

const RUNNERS: { [N in CommandName]: Runner<N> } = {
  navigate: {
    async run({ page, site, id }, ctx) {
      const href = pageHref(page, { site, id });
      ctx.navigate(href);
      return { ok: true, text: `Opened ${PAGES[page].label}${site ? ` for ${site}` : ""}.`, href };
    },
  },

  build_dashboard: {
    async run({ request, site: named }, ctx) {
      const { site, known } = await pickSite(named, "tracking", ctx, "/console/dashboards");
      if (!site) {
        return {
          ok: false,
          text: known.length ? `Which store? Darwin has tracking plans for ${known.join(", ")}: say “…for ${known[0]}”.` : "No store has a tracking plan yet: set one up first and Darwin builds its dashboards.",
          href: known.length ? "/console/dashboards" : "/onboarding",
          linkLabel: known.length ? "Open dashboards" : "Set up a store",
        };
      }
      let res: { reply: string; id?: string };
      try {
        res = await http("POST", "/api/dashboards", { site, message: request });
      } catch (err) {
        const missing = err instanceof HttpError && err.status === 404;
        return { ok: false, text: (err as Error).message, href: missing ? "/onboarding" : undefined, linkLabel: missing ? "Set up a store" : undefined };
      }
      const href = pageHref("dashboards", { site });
      if (!res.id) return { ok: false, text: res.reply, href, linkLabel: "Open dashboards" };
      ctx.navigate(href);
      const seen = await ctx.highlight(`[data-dashboard="${CSS.escape(res.id)}"]`, { timeoutMs: 10_000 });
      return { ok: true, text: seen ? res.reply : `${res.reply} (It's on the dashboards page.)`, href, linkLabel: "Open dashboards", data: { site, id: res.id } };
    },
  },

  simulate_traffic: {
    async run({ humans, agents }, ctx) {
      if (!humans && !agents) return { ok: false, text: "Nothing to send: ask for some people or agents." };
      const r = await ctx.api.simulate({ humans, agents });
      ctx.refresh();
      const who = [r.humans ? plural(r.humans, "simulated person", "simulated people") : "", r.agents ? plural(r.agents, "simulated AI agent") : ""].filter(Boolean).join(" and ");
      const orders = r.orders ? `${plural(r.orders, "order")} (${money(r.revenue)})` : "no orders";
      return { ok: true, text: `Sent ${who}: ${orders}. All of it is labelled simulated.`, synthetic: true, href: "/console", linkLabel: "See Overview", data: r };
    },
  },

  set_autopilot: {
    async run({ on }, ctx) {
      await ctx.setAutopilot(on);
      const loop = await ctx.api.getLoop().catch(() => undefined);
      if (loop && loop.autopilot !== on) return { ok: false, text: "Darwin couldn't change autopilot just now. Try again in a moment." };
      return {
        ok: true,
        text: on
          ? "Autopilot is on: Darwin observes, tests and ships winners on its own. Simulated shoppers are on too, so it has traffic to learn from."
          : "Autopilot is paused. Darwin waits for you to step the loop.",
      };
    },
  },

  step_loop: {
    async run({ times }, ctx) {
      const before = await ctx.api.getLoop().catch(() => undefined);
      let last: LoopState | undefined;
      for (let i = 0; i < times; i++) last = await ctx.api.stepLoop();
      ctx.refresh();
      if (!last) return { ok: false, text: "The loop didn't move." };
      const from = before ? PHASE_META[before.phase].label : undefined;
      const to = PHASE_META[last.phase];
      const said = last.log.at(-1)?.message;
      const moved = from && from !== to.label ? `Darwin moved from ${from} to ${to.label}` : `Darwin is at ${to.label}`;
      return { ok: true, text: `${moved}${said ? `: ${said}` : `. ${to.blurb}.`}`, href: "/console", linkLabel: "See Overview", data: { phase: last.phase, generation: last.generation } };
    },
  },

  send_shopper: {
    async run({ brief, via }, ctx) {
      const { session: s } = await ctx.api.sendShopper(brief, true, via);
      ctx.refresh();
      const tag = s.synthetic ? " (simulated)" : "";
      const text =
        s.outcome === "purchased"
          ? `${s.agentName} bought${s.orderTotal ? ` for ${money(s.orderTotal)}` : ""}${tag}, in ${plural(s.toolCalls.length, "step")}.`
          : s.outcome === "abandoned"
            ? `${s.agentName} left without buying${s.reason ? `: ${s.reason}` : ""}${tag}.`
            : `${s.agentName} is still shopping${tag}.`;
      return { ok: true, text, synthetic: s.synthetic, href: "/console", linkLabel: "See live shoppers", data: s };
    },
  },

  ask_darwin: {
    async run({ question }, ctx) {
      const r = await http<{ answer: string; cards?: { label: string; value: string }[]; source: "llm" | "heuristic" }>("POST", "/api/ask", {
        question,
        history: ctx.history?.slice(-10),
      });
      return { ok: true, text: r.answer, data: { cards: r.cards ?? [], source: r.source } };
    },
  },

  open_issue: {
    async run({ rank, id }, ctx) {
      const loop = await ctx.api.getLoop();
      const ranked = rankInsights(loop);
      if (!ranked.length) return { ok: false, text: "Darwin hasn't found any issues yet: let it observe some shoppers first.", href: "/console/issues", linkLabel: "Open Issues" };
      const i = id ? ranked.findIndex((x) => x.id === id) : (rank ?? 1) - 1;
      const insight = ranked[i];
      if (!insight) return { ok: false, text: id ? `There's no issue with id ${id}.` : `There are only ${plural(ranked.length, "issue")} right now.`, href: "/console/issues", linkLabel: "Open Issues" };
      const href = pageHref("issues", { id: insight.id });
      ctx.navigate(href);
      void ctx.highlight(`[data-sel-id="${CSS.escape(insight.id)}"]`, { timeoutMs: 6000 });
      return {
        ok: true,
        text: `Issue ${i + 1} of ${ranked.length}: ${insight.title}. About ${impact(insight.impactScore)} buyers lost per 1,000 visits.`,
        href,
        linkLabel: "Open the issue",
        data: { id: insight.id, rank: i + 1 },
      };
    },
  },

  rollback: {
    async confirm({ generation }, ctx) {
      const loop = await ctx.api.getLoop().catch(() => undefined);
      const rec = loop?.history.find((h) => h.generation === generation);
      if (!loop) return `Put Gen ${generation} back live? Shoppers see its store right away and any running test stops.`;
      if (!rec) return `Gen ${generation} was never shipped (live is Gen ${loop.generation}). Try anyway?`;
      const label = rec.label?.replace(/^gen(?:eration)?\s*\d+\s*[:·—-]\s*/i, "").trim();
      return `Put Gen ${generation}${label ? ` (“${label}”)` : ""} back live instead of Gen ${loop.generation}? Shoppers see it right away and any running test stops.`;
    },
    async run({ generation }, ctx) {
      const loop = await ctx.api.rollback(generation);
      ctx.refresh();
      return { ok: true, text: `Gen ${generation}'s store is live again (now Gen ${loop.generation}). The rollback is recorded on Changes.`, href: "/console/changes", linkLabel: "Open Changes", data: { generation: loop.generation } };
    },
  },

  start_agent_test: {
    async run({ lever, buyers }, ctx) {
      try {
        const r = await http<{ buyers?: { sent?: number } | number; did?: string[] }>("POST", "/api/store-agent/tests", { start: lever, ...(buyers ? { buyers } : {}) });
        ctx.refresh();
        const sent = buyers ? ` and sent ${plural(buyers, "simulated buyer agent")}` : "";
        return { ok: true, text: `Started testing “${AGENT_LEVERS[lever]}” on your store agent${sent}. Half the conversations get it; payments decide.`, synthetic: !!buyers, href: "/console/agents", linkLabel: "Open Store agent", data: r };
      } catch (err) {
        return { ok: false, text: `Couldn't start it: ${(err as Error).message}.`, href: "/console/agents", linkLabel: "Open Store agent" };
      }
    },
  },

  set_agent_autopilot: {
    async run({ on }) {
      const r = await http<{ did?: string[] }>("POST", "/api/store-agent/tests", { autopilot: on });
      const did = r.did?.length ? ` ${r.did.join(" ")}` : "";
      return {
        ok: true,
        text: on ? `Store agent autopilot is on: Darwin tests one pitch lever at a time and keeps the winners.${did}` : "Store agent autopilot is paused.",
        href: "/console/agents",
        linkLabel: "Open Store agent",
      };
    },
  },

  draft_personalization: {
    async run({ prompt, site: named }, ctx) {
      const { site, known } = await pickSite(named, "web", ctx, "/console/personalize");
      if (!site) return { ok: false, text: known.length ? `Which site? darwin.js runs on ${known.join(", ")}.` : "No site runs darwin.js yet.", href: "/console/personalize", linkLabel: "Open Personalize" };
      const draft = await http<{ rule: { name: string; audience: { sources?: string[] }; changes: unknown[] }; source: string }>("POST", "/api/web/draft", { site, prompt });
      const saved = await http<{ rule: { id: string; name: string; status: string } }>("POST", "/api/web/rules", { rule: draft.rule, status: "draft" });
      const href = pageHref("personalize", { site });
      ctx.navigate(href);
      const who = draft.rule.audience.sources?.length ? `visitors from ${draft.rule.audience.sources.join(", ")}` : "every visitor";
      const blanks = JSON.stringify(draft.rule.changes).includes("[Your") ? " Fill in the [Your …] blanks first." : "";
      return {
        ok: true,
        text: `Drafted “${saved.rule.name}” for ${who}: ${plural(draft.rule.changes.length, "change")}. Saved as a draft, not live: review it on Personalize and press Start to test it.${blanks}`,
        href,
        linkLabel: "Review the draft",
        data: { site, ruleId: saved.rule.id, source: draft.source },
      };
    },
  },

  briefing: {
    async run() {
      const b = await http<{ text: string; ask?: { id: string; action: string }; items: { url?: string; traffic: string }[] }>("GET", "/api/briefing");
      const url = b.items.find((i) => i.url)?.url;
      const href = url ? new URL(url, window.location.origin).pathname + new URL(url, window.location.origin).search : "/console/settings";
      return { ok: true, text: b.text, href, linkLabel: "See details", synthetic: b.items.some((i) => i.traffic !== "real"), data: b };
    },
  },

  act_on_briefing: {
    async confirm({ action, id }) {
      const item = await briefingItem(action, id).catch(() => undefined);
      if (!item) return action === "ship" ? "Ship the test Darwin recommends?" : "Stop the test Darwin flagged?";
      return `${action === "ship" ? "Ship" : "Stop"} “${item.title}”? ${item.say}`;
    },
    async run({ action, id }) {
      const item = await briefingItem(action, id);
      if (!item) return { ok: false, text: action === "ship" ? "Nothing is ready to ship right now." : "No running test to stop right now.", href: "/console/experiments", linkLabel: "Open Experiments" };
      const r = await http<{ ok: boolean; text: string }>("POST", "/api/briefing/act", { id: item.id, action });
      return { ok: r.ok, text: r.text, href: item.url ? new URL(item.url, window.location.origin).pathname : undefined, linkLabel: "See it" };
    },
  },

  whats_left: {
    async run({ area }, ctx) {
      const a = area ? roadmapArea(area) : roadmapFor(ctx.location().pathname);
      if (!a) return { ok: false, text: "This page isn't on the roadmap yet." };
      return { ok: true, text: whatsLeftText(a), data: a };
    },
  },
};

interface BriefingItemLite {
  id: string;
  title: string;
  say: string;
  actions: string[];
  url?: string;
}

async function briefingItem(action: "ship" | "stop", id?: string): Promise<BriefingItemLite | undefined> {
  const b = await http<{ ask?: { id: string; action: string }; items: BriefingItemLite[] }>("GET", "/api/briefing");
  if (id) return b.items.find((i) => i.id === id);
  if (b.ask?.action === action) return b.items.find((i) => i.id === b.ask!.id);
  return b.items.find((i) => i.actions.includes(action));
}

/* ------------------------------------------------------------------ entry points */

function parse(name: string, input: unknown): { name: CommandName; input: unknown } | { error: string } {
  const resolved = resolveCommand(name);
  if (!resolved) return { error: `Unknown command “${name}”.` };
  const parsed = specOf(resolved).input.safeParse(input ?? {});
  if (!parsed.success) return { error: `Bad input for ${resolved}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}` };
  return { name: resolved, input: parsed.data };
}

/** Validate and run one command. Never throws: failures come back as { ok: false, text }. */
export async function runCommand(name: string, input: unknown, ctx: CommandContext): Promise<CommandResult> {
  const p = parse(name, input);
  if ("error" in p) return { ok: false, text: p.error };
  try {
    const runner = RUNNERS[p.name] as Runner<CommandName>;
    return await runner.run(p.input as never, ctx);
  } catch (err) {
    return { ok: false, text: `${specOf(p.name).title} failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The question to ask before a confirm-risk command (falls back to its plain label). */
export async function confirmText(name: string, input: unknown, ctx: CommandContext): Promise<string> {
  const p = parse(name, input);
  if ("error" in p) return p.error;
  const runner = RUNNERS[p.name] as Runner<CommandName>;
  const fallback = `${specOf(p.name).describe(p.input as never)}?`;
  if (!runner.confirm) return fallback;
  try {
    return await runner.confirm(p.input as never, ctx);
  } catch {
    return fallback;
  }
}
