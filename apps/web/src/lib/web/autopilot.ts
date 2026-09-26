/**
 * Web autopilot: the "improves itself" loop for any store with darwin.js.
 *
 * Each step, for one site:
 *   1. decide the running A/B tests: ship a winner to its audience, stop a loser (or one that can't
 *      decide), and write down why;
 *   2. start tests for the traffic sources with the biggest conversion gap that have no test running,
 *      at most MAX_RUNNING at once, one per source (so tests never overlap), never retrying an idea.
 * Autopilot publishes only copy the merchant's page backs up (claims.ts): an idea that needs a fact the page
 * doesn't state is left for the merchant, and any live rule (whoever wrote it) whose claims aren't on the page is
 * paused, with the reason in the decision log.
 * Steps are driven by the console (POST /api/web/autopilot/step) while autopilot is on.
 */
import type { PageElement, TrafficSource, WebAutopilotEntry, WebAutopilotState, WebRule, WebRuleResult } from "@/lib/contracts";
import { TRAFFIC_SOURCE_LABEL } from "@/lib/contracts";
import { kvGet, kvUpdate } from "@/lib/db/json-store";
import { eventStore } from "@/lib/analytics/store";
import { needsMerchant, readyToPublish, unbackedTexts } from "./claims";
import { ideaDraft, ideasFor, rankSources } from "./drafts";
import { pageFor } from "./pages";
import { computeSite } from "./results";
import { createRule, endRule, listRules } from "./store";

export const AUTOPILOT = {
  /** Visitors per arm before a test may be decided. */
  minPerArm: 300,
  /**
   * Orders across both arms before a test may be decided: low-converting sources (social at ~1%) need
   * far more than 300 visitors a side, or a couple of lucky orders decide the test.
   */
  minConversions: 30,
  /** Ship when P(change is better) reaches this. Stricter than 95%: autopilot checks every few seconds. */
  ship: 0.97,
  /** Stop when it falls to this. */
  stop: 0.1,
  /** Give up on a test that still can't decide at this many visitors per arm. */
  maxPerArm: 3000,
  /** Tests running at once (one per traffic source). */
  maxRunning: 3,
  /** A source needs this many visitors before autopilot spends a test on it. */
  minSourceVisitors: 30,
  maxLog: 60,
} as const;

const KEY = "web-autopilot";
type All = Record<string, WebAutopilotState>;

const fresh = (site: string): WebAutopilotState => ({ site, on: false, log: [], tried: [] });

export function getAutopilot(site: string): WebAutopilotState {
  return kvGet<All>(KEY, () => ({}))[site] ?? fresh(site);
}

function save(state: WebAutopilotState): WebAutopilotState {
  kvUpdate<All>(KEY, () => ({}), (all) => ({ ...all, [state.site]: { ...state, log: state.log.slice(0, AUTOPILOT.maxLog) } }));
  return getAutopilot(state.site);
}

const entry = (kind: WebAutopilotEntry["kind"], message: string, extra: Partial<WebAutopilotEntry> = {}): WebAutopilotEntry => ({
  at: new Date().toISOString(),
  kind,
  message,
  ...extra,
});

export function setAutopilot(site: string, on: boolean): WebAutopilotState {
  const state = getAutopilot(site);
  if (state.on === on) return state;
  const msg = on
    ? `Autopilot on: Darwin will test one idea per traffic source (up to ${AUTOPILOT.maxRunning} at once), ship winners and stop losers.`
    : "Autopilot off. Running tests keep running until you decide them.";
  return save({ ...state, on, log: [entry(on ? "on" : "off", msg), ...state.log] });
}

export function resetAutopilot(site?: string) {
  kvUpdate<All>(KEY, () => ({}), (all) => {
    if (!site) return {};
    const { [site]: _gone, ...rest } = all; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  });
}

const pct = (x: number | undefined, digits = 0) => (x === undefined ? "?" : `${(x * 100).toFixed(digits)}%`);
const signed = (x: number | undefined) => (x === undefined ? "" : `${x >= 0 ? "+" : ""}${pct(x)}`);
const who = (r: WebRule) => (r.audience.sources?.length ? r.audience.sources.map((s) => TRAFFIC_SOURCE_LABEL[s].split(" (")[0]).join(", ") : "everyone");

/** What to do with one running test, or undefined to keep it running. */
export function judge(res: WebRuleResult | undefined): { decision: "shipped" | "stopped"; reason: string } | undefined {
  if (!res || res.probabilityToBeat === undefined) return undefined;
  const n = Math.min(res.control.visitors, res.treatment.visitors);
  const p = res.probabilityToBeat;
  const data = `${pct(p)} chance better, ${signed(res.lift)} orders, ${res.control.visitors + res.treatment.visitors} visitors${res.synthetic ? " (simulated)" : ""}`;
  const enough = n >= AUTOPILOT.minPerArm && res.control.conversions + res.treatment.conversions >= AUTOPILOT.minConversions;
  if (enough && p >= AUTOPILOT.ship) return { decision: "shipped", reason: data };
  if (enough && p <= AUTOPILOT.stop) return { decision: "stopped", reason: `losing: ${data}` };
  if (n >= AUTOPILOT.maxPerArm) return { decision: "stopped", reason: `no clear winner: ${data}` };
  return undefined;
}

const short = (v: string) => (v.length > 80 ? `${v.slice(0, 79).trimEnd()}…` : v);

/**
 * Pause every live rule, whoever wrote it, whose copy states something the site's page doesn't (a rating, a
 * customer count, an offer, a delivery promise) or still has [bracketed] text for the merchant. Checked against
 * the outline just read, else the page Darwin last read; a page it has never read can't back anything up, so
 * only the [bracketed] check runs then (it doesn't guess).
 */
function takeDown(site: string, outline: PageElement[]): WebAutopilotEntry[] {
  const page = pageFor(site, outline);
  const out: WebAutopilotEntry[] = [];
  for (const rule of listRules(site).filter((r) => r.status === "running" || r.status === "shipped")) {
    const unbacked = page.length ? unbackedTexts(rule.changes, page).map((u) => u.value) : [];
    const pending = rule.changes.flatMap((c) => (needsMerchant(c.value) ? [c.value!] : []));
    if (!unbacked.length && !pending.length) continue;
    const why = unbacked.length
      ? `it claimed ${unbacked.map((v) => `“${short(v)}”`).join(" and ")} and nothing on your site backs that up`
      : `it still shows ${pending.map((v) => `“${short(v)}”`).join(" and ")}, which only you can fill in`;
    endRule(rule.id, { decision: "stopped", reason: `Paused: ${why}`, at: new Date().toISOString(), by: "autopilot" }, { outline: page });
    out.push(
      entry("stopped", `Paused “${rule.name}” for ${who(rule)}: ${why}. Darwin only publishes what your page already says.`, {
        ruleId: rule.id,
        source: rule.audience.sources?.[0],
      }),
    );
  }
  return out;
}

/**
 * Pause live copy the page doesn't back up (any author), and log why. Runs on every autopilot step, when autopilot
 * is switched on or off, and whenever the site's rules are loaded (webState, runtime.js), so copy an older Darwin
 * (or anyone) made up leaves the live page even while autopilot is off. `outline` defaults to the page Darwin last read.
 */
export function retractUnbackedCopy(site: string, outline: PageElement[] = []): WebAutopilotState {
  const taken = takeDown(site, outline);
  const state = getAutopilot(site);
  return taken.length ? save({ ...state, log: [...taken].reverse().concat(state.log) }) : state;
}

/** One autopilot step for a site. Runs even when autopilot is off (the console only calls it when on). */
export function stepAutopilot(site: string, read: PageElement[] = []): { state: WebAutopilotState; actions: WebAutopilotEntry[] } {
  // The page just read, else the one Darwin last read: every claim autopilot publishes must be on it.
  const outline = pageFor(site, read);
  const state = getAutopilot(site);
  const actions: WebAutopilotEntry[] = [];
  const tried = new Set(state.tried);
  let rules = listRules(site);
  const { overview, results } = computeSite(site, rules, eventStore().all());

  // 0. Pause live copy that states something the page doesn't (e.g. an old "★ 4.8/5" badge), whoever wrote it.
  actions.push(...takeDown(site, outline));
  rules = listRules(site);

  // 1. Decide running tests.
  for (const rule of rules.filter((r) => r.status === "running" && r.mode === "test")) {
    const verdict = judge(results.find((r) => r.ruleId === rule.id));
    if (!verdict) continue;
    // Never ship copy the page can't back up (page unreadable right now): leave it running until it is.
    if (verdict.decision === "shipped" && !readyToPublish(rule, outline)) continue;
    const res = results.find((r) => r.ruleId === rule.id)!;
    endRule(rule.id, { ...verdict, probabilityToBeat: res.probabilityToBeat, lift: res.lift, at: new Date().toISOString(), by: "autopilot" }, { outline });
    actions.push(
      entry(
        verdict.decision,
        verdict.decision === "shipped"
          ? `Shipped “${rule.name}” to ${who(rule)}: ${verdict.reason}.`
          : `Stopped “${rule.name}” for ${who(rule)}, ${verdict.reason}.`,
        { ruleId: rule.id, source: rule.audience.sources?.[0] },
      ),
    );
  }

  // 2. Start tests where the gap is biggest.
  rules = listRules(site);
  const running = rules.filter((r) => r.status === "running" && r.mode === "test");
  const busy = new Set<TrafficSource>(running.flatMap((r) => r.audience.sources ?? []));
  let slots = AUTOPILOT.maxRunning - running.length;
  for (const source of rankSources(overview)) {
    if (slots <= 0) break;
    if (busy.has(source) || overview.bySource[source].visitors < AUTOPILOT.minSourceVisitors) continue;
    // The first untried idea autopilot can publish on its own: one that needs the merchant's facts waits for them.
    let index = -1;
    let draft: ReturnType<typeof ideaDraft>;
    for (let i = 0; i < ideasFor(source).length && index < 0; i++) {
      if (tried.has(`${source}:${i}`)) continue;
      const d = ideaDraft(site, source, i, overview, outline);
      if (d && readyToPublish(d, outline)) [index, draft] = [i, d];
    }
    if (index < 0 || !draft) continue;
    tried.add(`${source}:${index}`);
    const rule = createRule({ ...draft, author: "autopilot" }, "running", { outline });
    slots--;
    actions.push(entry("started", `Started A/B test “${rule.name}” for ${who(rule)}. ${draft.hypothesis ?? ""}`.trim(), { ruleId: rule.id, source }));
  }

  if (!actions.length && !running.length) {
    const why = overview.visitors
      ? "Every source with enough traffic has been tested. Waiting for more visitors or new ideas."
      : "Waiting for visitors: install darwin.js, or send test traffic.";
    if (state.log[0]?.message !== why) actions.push(entry("waiting", why));
  }

  const next = save({ ...state, tried: [...tried], lastStepAt: new Date().toISOString(), log: [...actions].reverse().concat(state.log) });
  return { state: next, actions };
}
