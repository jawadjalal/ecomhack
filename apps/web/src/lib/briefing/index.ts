/**
 * The merchant briefing: Darwin's state in a few plain-English sentences a chat bot (the team's Grok bot)
 * can forward as-is, the decisions waiting on the merchant, and a way to act on them.
 *
 *   getBriefing({ origin })   → headline + text + items (store page tests, web tests, store agent pitch tests)
 *   actOnBriefing(id, action) → ship or stop one item through the public API of the area that owns it
 *
 * Reads other areas through their public APIs only and computes no statistics of its own: every
 * P(beat), lift and "enough data" call comes from the area that runs the test.
 */
import type { AnalyticsEvent, ExperimentResult, TrafficSource, VariantStats, WebRule, WebRuleResult } from "@/lib/contracts";
import { eventStore } from "@/lib/analytics/store";
import { getAnalyticsSummary } from "@/lib/analytics/summary";
import { getExperiment, listExperiments } from "@/lib/experiments/store";
import { getLoopState, loopConfigFromEnv, stepLoop } from "@/lib/optimizer";
import { AUTOPILOT as WEB_RULES, endRule, getRule, judge, listRules, webState, WebRuleError } from "@/lib/web";
import { AGENT_TEST_RULES, LEVERS, agentFunnel, agentTestsView, shipAgentTest, stopAgentTest } from "@/lib/store-agent";

/* ------------------------------------------------------------------ types */

export type BriefingAction = "ship" | "stop";
export type BriefingStatus = "running" | "winning" | "losing" | "ready" | "shipped" | "stopped";
/** Where the numbers came from: "simulated" = only Darwin's simulated shoppers, "mixed" = some of them, "real" = none. */
export type BriefingTraffic = "simulated" | "mixed" | "real";

export interface BriefingItem {
  /** "loop:<experimentId>", "web:<site>:<ruleId>" or "agent:<testId>". Pass it back to actOnBriefing. */
  id: string;
  /** loop = the Darwin storefront's page test, web = a darwin.js site's A/B test, agent = the store agent's pitch test. */
  kind: "loop" | "web" | "agent";
  title: string;
  /** winning: P(beat) ≥ 80%, losing: ≤ 20%, ready: past the owner's bar to ship (with enough data). */
  status: BriefingStatus;
  probabilityToBeat?: number;
  /** Relative lift of the change over the original (0.12 = +12%). */
  lift?: number;
  /** Visitors (or buyer-agent conversations) counted, both arms. */
  sample?: number;
  traffic: BriefingTraffic;
  /** One plain-English line. Says "(simulated traffic)" when the numbers are simulated. */
  say: string;
  /** What actOnBriefing can do with this item right now. Empty: nothing to decide. */
  actions: BriefingAction[];
  /** Console page with the details. */
  url?: string;
  /** When a shipped / stopped item ended. */
  endedAt?: string;
}

export interface Briefing {
  generatedAt: string;
  /** One or two sentences: the key number and the question for the merchant. */
  headline: string;
  /** 2-5 short sentences a bot can forward as-is. */
  text: string;
  /** The decision the headline asks about. On "yes", call actOnBriefing(ask.id, ask.action). */
  ask?: { id: string; action: BriefingAction };
  /** Most urgent first: ready, winning, losing, running, then what shipped / stopped in the last 24 hours. */
  items: BriefingItem[];
}

/* ------------------------------------------------------------------ formatting */

const RECENT_MS = 24 * 60 * 60 * 1000;
const MAX_ENDED_PER_KIND = 3;
const WINNING = 0.8;
const LOSING = 0.2;

const LABEL: Record<BriefingTraffic, string> = { simulated: " (simulated traffic)", mixed: " (includes simulated traffic)", real: "" };

/** Conversion-style rates: one decimal under 10% so 2.4% doesn't read as 2%. */
const rate = (x: number) => (x > 0 && x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
/** Chances: never "100%" or "0%" for a posterior. */
const chance = (p: number) => (p > 0.99 ? "over 99%" : p < 0.01 ? "under 1%" : `${Math.round(p * 100)}%`);
const bar = (p: number) => `${+(p * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? "+" : "-"}${Math.round(Math.abs(x) * 100)}%`;
const num = (n: number) => n.toLocaleString("en-GB");
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

function trafficOf(total: number, real: number): BriefingTraffic {
  if (total <= 0) return "real";
  if (real <= 0) return "simulated";
  return real < total ? "mixed" : "real";
}

function statusFor(p: number | undefined, ready: boolean): BriefingStatus {
  if (ready) return "ready";
  if (p === undefined) return "running";
  if (p >= WINNING) return "winning";
  if (p <= LOSING) return "losing";
  return "running";
}

const isRecent = (at: string | undefined, now: number) => !!at && now - Date.parse(at) <= RECENT_MS;

/**
 * An item before its `say` line is put together: `detail` (the numbers, labelled with where they came from)
 * then `tail` (what happens next). One sentence, no final full stop.
 */
type Draft = Omit<BriefingItem, "say"> & { detail: string; tail?: string };

function toItem({ detail, tail, ...item }: Draft): BriefingItem {
  return { ...item, say: `${detail}${LABEL[item.traffic]}${tail ?? ""}.` };
}

/* ------------------------------------------------------------------ store agent pitch tests */

/** Buyer-agent conversations per test, and how many were real (not simulated buyers). */
function agentTestTraffic(events: readonly AnalyticsEvent[]): Map<string, { total: number; real: number }> {
  const out = new Map<string, { total: number; real: number }>();
  for (const e of events) {
    if (e.event !== "agent_variant") continue;
    const testId = e.properties?.test_id;
    if (typeof testId !== "string") continue;
    const t = out.get(testId) ?? { total: 0, real: 0 };
    t.total++;
    if (e.properties.synthetic !== true) t.real++;
    out.set(testId, t);
  }
  return out;
}

function agentItems(events: readonly AnalyticsEvent[], origin: string, now: number): Draft[] {
  const { state, results } = agentTestsView(events);
  const traffic = agentTestTraffic(events);
  const out: Draft[] = [];
  let ended = 0;
  for (const t of [...state.tests].reverse()) {
    const label = LEVERS[t.lever].label;
    const r = results.find((x) => x.testId === t.id);
    const n = r ? r.control.conversations + r.treatment.conversations : 0;
    const tt = traffic.get(t.id) ?? { total: 0, real: 0 };
    const base = {
      id: `agent:${t.id}`,
      kind: "agent" as const,
      title: label,
      probabilityToBeat: r?.probabilityToBeat,
      lift: r?.lift,
      sample: n,
      traffic: trafficOf(tt.total, tt.real),
      url: `${origin}/console/agents`,
    };
    if (t.status === "running") {
      const p = r?.probabilityToBeat;
      const enough =
        !!r &&
        Math.min(r.control.conversations, r.treatment.conversations) >= AGENT_TEST_RULES.minPerArm &&
        r.control.paid + r.treatment.paid >= AGENT_TEST_RULES.minPaid;
      const ready = enough && p !== undefined && p >= AGENT_TEST_RULES.ship;
      if (!r || p === undefined) {
        out.push({ ...base, status: "running", actions: ["ship", "stop"], detail: `Your store agent is testing “${label}”: ${plural(n, "buyer-agent conversation")} so far, too early to tell` });
        continue;
      }
      out.push({
        ...base,
        status: statusFor(p, ready),
        actions: ["ship", "stop"],
        detail:
          `On your store agent, ${rate(r.treatment.rate)} of buyer-agent conversations paid with “${label}” vs ${rate(r.control.rate)} without: ` +
          `${chance(p)} chance it's better after ${plural(n, "conversation")}`,
        tail: ready ? `, past the ${bar(AGENT_TEST_RULES.ship)} bar to ship` : p >= AGENT_TEST_RULES.ship ? `; Darwin would wait for more conversations before calling it` : undefined,
      });
    } else if (ended < MAX_ENDED_PER_KIND && isRecent(t.endedAt, now)) {
      ended++;
      const who = t.reason?.startsWith("Approved by the merchant") || t.reason?.startsWith("Stopped by the merchant") ? "on your say-so" : "by Darwin";
      const what = t.status === "shipped" ? `was shipped into your store agent's pitch ${who}` : `was stopped on your store agent ${who}`;
      const numbers = r && r.probabilityToBeat !== undefined ? `: ${rate(r.control.rate)} → ${rate(r.treatment.rate)} of conversations paid, ${chance(r.probabilityToBeat)} chance it was better` : "";
      out.push({ ...base, status: t.status, actions: [], endedAt: t.endedAt, detail: `“${label}” ${what}${numbers}` });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ web tests (any site with darwin.js) */

const FROM: Record<TrafficSource, string> = {
  ai: "visitors from AI assistants",
  search: "visitors from search engines",
  social: "visitors from social media",
  paid: "visitors from paid ads",
  email: "visitors from email",
  referral: "visitors from other websites",
  direct: "direct visitors",
};

const whoOf = (rule: WebRule) => (rule.audience.sources?.length ? rule.audience.sources.map((s) => FROM[s]).join(" and ") : "all visitors");
const didOf = (rule: WebRule) => (rule.metric === "order_completed" ? "bought" : `did “${rule.metric}”`);

function webNumbers(res: WebRuleResult | undefined): string | undefined {
  if (!res || res.probabilityToBeat === undefined) return undefined;
  const n = res.control.visitors + res.treatment.visitors;
  return `${chance(res.probabilityToBeat)} chance it's better${res.lift !== undefined ? `, ${signed(res.lift)}` : ""}, ${plural(n, "visitor")}${res.synthetic ? " (simulated)" : ""}`;
}

function webItems(origin: string, now: number): { items: Draft[]; facts: Map<string, string> } {
  const items: Draft[] = [];
  const facts = new Map<string, string>();
  const endedAt = (r: WebRule) => r.outcome?.at ?? r.shippedAt;
  const relevant = listRules()
    .filter((r) => r.mode === "test" && (r.status === "running" || ((r.status === "shipped" || r.status === "paused") && isRecent(endedAt(r), now))))
    .sort((a, b) => (endedAt(b) ?? "").localeCompare(endedAt(a) ?? ""));
  let ended = 0;
  for (const site of [...new Set(relevant.map((r) => r.site))]) {
    const state = webState(site);
    const ov = state.overview;
    if (ov.visitors >= 20) {
      facts.set(site, `${site} turns ${rate(ov.conversionRate)} of its visitors into buyers${LABEL[trafficOf(ov.visitors, ov.visitors - ov.syntheticVisitors)]}.`);
    }
    for (const rule of relevant.filter((r) => r.site === site)) {
      const res = state.results.find((x) => x.ruleId === rule.id);
      const n = res ? res.control.visitors + res.treatment.visitors : 0;
      const traffic: BriefingTraffic = res?.synthetic ? "simulated" : ov.syntheticVisitors > 0 && n > 0 ? "mixed" : "real";
      const base = {
        id: `web:${site}:${rule.id}`,
        kind: "web" as const,
        title: rule.name,
        probabilityToBeat: res?.probabilityToBeat,
        lift: res?.lift,
        sample: n,
        traffic,
        url: `${origin}/console/personalize?site=${encodeURIComponent(site)}`,
      };
      const who = whoOf(rule);
      if (rule.status === "running") {
        const p = res?.probabilityToBeat;
        const ready = judge(res)?.decision === "shipped";
        const detail =
          !res || p === undefined
            ? `On ${site}, “${rule.name}” is being tested on ${who}: ${plural(n, "visitor")} so far, too early to tell`
            : `On ${site}, ${rate(res.treatment.conversionRate)} of ${who} ${didOf(rule)} with “${rule.name}” vs ${rate(res.control.conversionRate)} without: ` +
              `${chance(p)} chance it's better after ${plural(n, "visitor")}`;
        items.push({ ...base, status: statusFor(p, ready), actions: ["ship", "stop"], detail, tail: ready ? `, past the ${bar(WEB_RULES.ship)} bar to ship` : undefined });
      } else if (ended < MAX_ENDED_PER_KIND) {
        ended++;
        const o = rule.outcome;
        const shipped = rule.status === "shipped";
        const by = o ? (o.by === "manual" ? " on your say-so" : " by Darwin") : "";
        const numbers =
          o?.probabilityToBeat !== undefined ? `: ${chance(o.probabilityToBeat)} chance it was better${o.lift !== undefined ? `, ${signed(o.lift)} ${didOf(rule) === "bought" ? "orders" : "conversions"}` : ""}` : "";
        items.push({
          ...base,
          status: shipped ? "shipped" : "stopped",
          actions: [],
          endedAt: endedAt(rule),
          detail: `On ${site}, “${rule.name}” was ${shipped ? `shipped to ${who}` : `stopped for ${who}`}${by}${numbers}`,
        });
      }
    }
  }
  return { items, facts };
}

/* ------------------------------------------------------------------ the storefront's page tests (optimizer loop) */

function arm(v: VariantStats, audience: ExperimentResult["audience"]) {
  return audience === "agent" || audience === "human" ? { visitors: v.byKind[audience].visitors, rate: v.byKind[audience].conversionRate } : { visitors: v.visitors, rate: v.conversionRate };
}

function loopItems(origin: string, now: number): Draft[] {
  const state = getLoopState();
  const shipBar = loopConfigFromEnv().shipThreshold;
  const out: Draft[] = [];
  const url = `${origin}/console`;

  /** Visitors behind the result (only the audience it's measured on), and how many of them were real. */
  const labelled = (experimentId: string, result: ExperimentResult | undefined) => {
    if (!result) return { sample: 0, traffic: "real" as BriefingTraffic };
    const audience = result.audience ?? "all";
    const sample = arm(result.control, audience).visitors + arm(result.treatment, audience).visitors;
    const real = getAnalyticsSummary({ experimentId, includeSynthetic: false });
    return { sample, traffic: trafficOf(sample, audience === "all" ? real.overall.visitors : real.byKind[audience].visitors) };
  };

  const exp = state.experimentId ? getExperiment(state.experimentId) : undefined;
  const current = exp?.status === "running" ? exp : undefined;
  if (current) {
    const result = current.result;
    const p = result?.probabilityToBeat;
    const deciding = state.phase === "decide" && !!result && result.decision !== "running";
    const ready = deciding && result!.decision === "ship";
    const audience = result?.audience ?? "all";
    const who = audience === "agent" ? "AI shoppers" : audience === "human" ? "shoppers" : "visitors";
    let detail = `Your store is testing “${current.name}”: too early to tell`;
    let tail: string | undefined;
    if (result && p !== undefined) {
      const c = arm(result.control, audience);
      const t = arm(result.treatment, audience);
      detail =
        `On your store, ${rate(t.rate)} of ${who} bought with “${current.name}” vs ${rate(c.rate)} on the current page: ` +
        `${chance(p)} chance it's better after ${plural(c.visitors + t.visitors, who.slice(0, -1))}`;
      if (ready) tail = `, past Darwin's ${bar(shipBar)} bar to ship`;
      else if (deciding && result.decision === "inconclusive") tail = `; no clear winner, so Darwin will shelve it on its next step`;
      else if (deciding && result.decision === "reject") tail = `; it lost, so Darwin will shelve it on its next step`;
    }
    // A finished test that didn't win: "losing" if it lost, else just "running" until Darwin shelves it.
    const status = deciding && !ready ? (result!.decision === "reject" ? "losing" : "running") : statusFor(p, ready);
    const actions: BriefingAction[] = ready ? ["ship"] : deciding ? ["stop"] : [];
    out.push({
      id: `loop:${current.id}`,
      kind: "loop",
      title: current.name,
      status,
      probabilityToBeat: p,
      lift: result?.lift,
      ...labelled(current.id, result),
      actions,
      url,
      detail,
      tail,
    });
  }

  const ended = listExperiments()
    .filter((e) => e.status === "completed" && isRecent(e.completedAt, now))
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, MAX_ENDED_PER_KIND);
  for (const e of ended) {
    const result = e.result;
    const shipped = result?.decision === "ship";
    const gen = state.history.find((h) => h.experimentId === e.id);
    const numbers = result ? `: ${signed(result.lift)} conversion, ${chance(result.probabilityToBeat)} chance it was better` : "";
    out.push({
      id: `loop:${e.id}`,
      kind: "loop",
      title: e.name,
      status: shipped ? "shipped" : "stopped",
      probabilityToBeat: result?.probabilityToBeat,
      lift: result?.lift,
      ...labelled(e.id, result),
      actions: [],
      // A shipped generation links to its pull request when there is one.
      url: gen?.prUrl ?? url,
      endedAt: e.completedAt,
      detail: shipped
        ? `“${e.name}” went live on your store${gen ? ` as Gen ${gen.generation}` : ""}${numbers}`
        : `“${e.name}” was shelved on your store${result?.decision === "reject" ? " because it lost" : " with no clear winner"}${numbers}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ headline facts */

/** "Checkout drop-off is 38%." for the live store spec, when enough shoppers reached checkout. */
function storeFact(): string | undefined {
  const specVersion = getLoopState().liveSpec.version;
  const all = getAnalyticsSummary({ specVersion });
  const real = getAnalyticsSummary({ specVersion, includeSynthetic: false });
  const pick = (s: typeof all) => {
    const funnel = s.byKind.human.funnel;
    const at = (step: string) => funnel.find((f) => f.step === step)?.visitors ?? 0;
    return { checkout: at("checkout_started"), paid: at("order_completed") };
  };
  const f = pick(all);
  if (f.checkout < 10) return undefined;
  const drop = Math.max(0, 1 - f.paid / f.checkout);
  return `Checkout drop-off is ${rate(drop)}${LABEL[trafficOf(f.checkout, pick(real).checkout)]}.`;
}

function agentFact(events: readonly AnalyticsEvent[]): string | undefined {
  const f = agentFunnel(events);
  if (f.conversations < 5) return undefined;
  return `${rate(f.conversion)} of buyer-agent conversations with your store agent end in a payment${LABEL[trafficOf(f.conversations, f.conversations - f.simulated)]}.`;
}

/* ------------------------------------------------------------------ briefing */

const RANK: Record<BriefingStatus, number> = { ready: 0, winning: 1, losing: 2, running: 3, shipped: 4, stopped: 5 };
const ACTIVE = new Set<BriefingStatus>(["ready", "winning", "losing", "running"]);

function byUrgency(a: Draft, b: Draft): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
  const pa = a.probabilityToBeat ?? 0.5;
  const pb = b.probabilityToBeat ?? 0.5;
  if (a.status === "ready" || a.status === "winning") return pb - pa;
  if (a.status === "losing") return pa - pb;
  if (a.status === "running") return (b.sample ?? 0) - (a.sample ?? 0);
  return (b.endedAt ?? "").localeCompare(a.endedAt ?? "");
}

/** Compute once, on first use. */
function lazy<T>(fn: () => T): () => T {
  let done = false;
  let value: T | undefined;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value as T;
  };
}

/** Darwin's state for the merchant, most urgent decision first. `origin` builds the console links. */
export async function getBriefing(opts: { origin: string }): Promise<Briefing> {
  const origin = opts.origin.replace(/\/+$/, "");
  const now = Date.now();
  const events = eventStore().all();
  const web = webItems(origin, now);
  const drafts = [...loopItems(origin, now), ...web.items, ...agentItems(events, origin, now)].sort(byUrgency);
  const items = drafts.map(toItem);
  const unlabelled = new Map(items.map((item, i) => [item, `${drafts[i].detail}${drafts[i].tail ?? ""}.`]));

  // What to ask: the most urgent item the merchant can act on.
  const shipAsk = items.find((i) => (i.status === "ready" || i.status === "winning") && i.actions.includes("ship"));
  // Store page tests that lost are shelved by Darwin on its next step anyway: no need to ask about those.
  const stopAsk = shipAsk ? undefined : items.find((i) => i.status === "losing" && i.actions.includes("stop") && i.kind !== "loop");
  const asked = shipAsk ?? stopAsk;
  const active = items.filter((i) => ACTIVE.has(i.status));
  const top = asked ?? active[0];

  // The key number: about the same thing as the top item (so it never mixes up two stores), else the first there is.
  const storeNumber = lazy(storeFact);
  const agentNumber = lazy(() => agentFact(events));
  const fact = top
    ? top.kind === "agent"
      ? agentNumber()
      : top.kind === "web"
        ? web.facts.get(top.id.split(":")[1])
        : storeNumber()
    : (storeNumber() ?? agentNumber() ?? [...web.facts.values()][0]);

  // One sentence: the question, or what's going on. `labelsTop` = it already says where top's numbers came from.
  let main: string;
  let labelsTop = false;
  const p = top?.probabilityToBeat;
  const label = top ? LABEL[top.traffic] : "";
  if (top && asked && p !== undefined) {
    labelsTop = true;
    main =
      top.status === "ready"
        ? `“${top.title}” is ready to ship, ${chance(p)} chance it beats what you have now${label}: want me to ship it?`
        : top.status === "winning"
          ? `“${top.title}” is winning at ${chance(p)}${label}: want me to ship it?`
          : `“${top.title}” is losing, only ${chance(p)} chance it's better${label}: want me to stop it?`;
  } else if (top && (top.status === "winning" || top.status === "ready") && p !== undefined) {
    labelsTop = true;
    main = `“${top.title}” is winning at ${chance(p)}${label}; Darwin ships it by itself once it clears the bar.`;
  } else if (top && top.status === "losing" && p !== undefined) {
    labelsTop = true;
    main = `“${top.title}” is losing, only ${chance(p)} chance it's better${label}; Darwin stops it by itself if it stays that way.`;
  } else if (top) {
    main = active.length === 1 ? `“${top.title}” is being tested; nothing to decide yet.` : `${num(active.length)} tests are running; nothing to decide yet.`;
  } else if (items.length) {
    main = "Nothing needs you right now.";
  } else {
    main = events.length ? "Nothing is being tested right now." : "Nothing is being tested yet, and there's no traffic to learn from.";
  }

  // 2-5 short sentences: number, question, the details, what else is going on, how to answer.
  const sentences = fact ? [fact, main] : [main];
  const lead = top ?? items[0];
  if (lead) sentences.push(labelsTop && lead === top ? unlabelled.get(lead)! : lead.say);
  const others = active.filter((i) => i !== top).length;
  if (others > 0) sentences.push(`${others === 1 ? "One other test is" : `${num(others)} other tests are`} running.`);
  const hint = shipAsk
    ? shipAsk.actions.includes("stop")
      ? "Reply “ship it” to ship it, or “stop” to end the test."
      : "Reply “ship it” to ship it."
    : stopAsk
      ? "Reply “stop it” to end it, or “keep it” to let it run."
      : undefined;
  const shipped = items.filter((i) => i.status === "shipped" && i !== lead);
  if (shipped.length && sentences.length + (hint ? 1 : 0) < 5) sentences.push(`Shipped in the last day: ${shipped.map((i) => `“${i.title}”`).join(", ")}.`);
  if (hint) sentences.push(hint);
  if (sentences.length < 2) sentences.push("Start a test from the console, or send traffic to your store.");

  return {
    generatedAt: new Date(now).toISOString(),
    headline: fact ? `${fact} ${main}` : main,
    text: sentences.join(" "),
    ...(asked ? { ask: { id: asked.id, action: shipAsk ? ("ship" as const) : ("stop" as const) } } : {}),
    items,
  };
}

/* ------------------------------------------------------------------ acting on it */

export interface BriefingActResult {
  ok: boolean;
  /** Plain English for the merchant: what happened, or why nothing did. */
  text: string;
}

const UNKNOWN: BriefingActResult = { ok: false, text: "I don't recognise that item. Ask Darwin for a fresh briefing and use an id from it." };

async function actOnLoop(experimentId: string, action: BriefingAction): Promise<BriefingActResult> {
  const exp = getExperiment(experimentId);
  if (!exp) return { ok: false, text: "There's no store page test with that id." };
  const state = getLoopState();
  if (state.experimentId !== exp.id || exp.status === "completed") {
    return { ok: false, text: `“${exp.name}” isn't the test Darwin is running any more. Ask for a fresh briefing.` };
  }
  const result = exp.result;
  const deciding = state.phase === "decide" && !!result && result.decision !== "running";
  const p = result ? chance(result.probabilityToBeat) : "not measured yet";
  const shipBar = bar(loopConfigFromEnv().shipThreshold);

  if (action === "ship") {
    if (!deciding || result!.decision !== "ship") {
      return {
        ok: false,
        text: `Darwin only ships a store page change once its test clears the ${shipBar} bar, and “${exp.name}” is at ${p}. Darwin calls it by itself when the data is in; follow it in the console.`,
      };
    }
    const after = await stepLoop(); // decide → ship: promotes the winner and opens the pull request
    const gen = after.history.find((h) => h.experimentId === exp.id);
    if (!gen) return { ok: false, text: "Darwin is in the middle of another step. Try again in a minute." };
    return { ok: true, text: `Shipped “${exp.name}”: it's live on your store as Gen ${gen.generation}.${gen.prUrl ? ` Pull request: ${gen.prUrl}` : ""}` };
  }

  if (!deciding || result!.decision === "ship") {
    return {
      ok: false,
      text:
        deciding && result!.decision === "ship"
          ? `“${exp.name}” won its test (${p} chance it's better), so Darwin can't shelve it from chat. To hold it back, turn autopilot off in the console.`
          : `Darwin can't stop a store page test from chat while it's still collecting data; it stops losers by itself. To pause everything, turn autopilot off in the console.`,
    };
  }
  await stepLoop(); // decide → shelve the loser / no-winner
  if (getExperiment(exp.id)?.status !== "completed") return { ok: false, text: "Darwin is in the middle of another step. Try again in a minute." };
  return { ok: true, text: `Stopped “${exp.name}”: your store keeps the current page, and Darwin won't try it again.` };
}

function actOnWeb(site: string, ruleId: string, action: BriefingAction): BriefingActResult {
  const rule = getRule(ruleId);
  if (!rule || rule.site !== site) return { ok: false, text: `There's no web test with that id on ${site}.` };
  if (rule.mode !== "test") return { ok: false, text: `“${rule.name}” is a personalization everyone in its audience already sees, not an A/B test.` };
  if (rule.status !== "running") return { ok: false, text: `“${rule.name}” isn't running (it's ${rule.status}).` };
  const res = webState(site).results.find((r) => r.ruleId === rule.id);
  const numbers = webNumbers(res);
  const decision = action === "ship" ? "shipped" : "stopped";
  try {
    endRule(rule.id, {
      decision,
      reason: `${action === "ship" ? "approved" : "stopped"} by the merchant${numbers ? `: ${numbers}` : ""}`,
      probabilityToBeat: res?.probabilityToBeat,
      lift: res?.lift,
      at: new Date().toISOString(),
      by: "manual",
    });
  } catch (err) {
    if (err instanceof WebRuleError) return { ok: false, text: err.message };
    throw err;
  }
  const who = whoOf(rule);
  return action === "ship"
    ? { ok: true, text: `Shipped “${rule.name}” on ${site}: it's live for ${who}.` }
    : { ok: true, text: `Stopped “${rule.name}” on ${site}: ${who} see the original page again.` };
}

/** Ship or stop one briefing item (the merchant said yes / no). Never throws for a bad id: ok is false instead. */
export async function actOnBriefing(itemId: string, action: BriefingAction): Promise<BriefingActResult> {
  if (action !== "ship" && action !== "stop") return { ok: false, text: 'The action must be "ship" or "stop".' };
  const [kind, ...rest] = String(itemId ?? "").split(":");
  if (rest.some((part) => !part)) return UNKNOWN;
  if (kind === "agent" && rest.length === 1) {
    const events = eventStore().all();
    const r = action === "ship" ? shipAgentTest(rest[0], events) : stopAgentTest(rest[0], events);
    if (!r.ok || !r.test) return { ok: r.ok, text: r.text };
    const label = LEVERS[r.test.lever].label;
    return {
      ok: true,
      text: action === "ship" ? `Shipped “${label}”: your store agent now pitches every buyer agent this way.` : `Stopped “${label}”: your store agent's pitch stays as it was.`,
    };
  }
  if (kind === "web" && rest.length === 2) return actOnWeb(rest[0], rest[1], action);
  if (kind === "loop" && rest.length === 1) return actOnLoop(rest[0], action);
  return UNKNOWN;
}

/** Darwin's public origin for console links: DARWIN_PUBLIC_URL, else the request's (forwarded) origin. */
export function briefingOrigin(req: Request): string {
  const configured = process.env.DARWIN_PUBLIC_URL?.trim();
  if (configured) return (/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}
