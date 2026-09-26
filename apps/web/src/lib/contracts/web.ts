/**
 * Web personalization & experiments: change any page that runs darwin.js, per traffic source and
 * search query, as an A/B test or for everyone in the audience. Rules live in lib/web; the browser
 * runtime is served from GET /api/web/runtime.js?site=… (loaded by darwin.js).
 */

/** Where a visitor came from (first touch of the session). */
export type TrafficSource = "ai" | "search" | "social" | "paid" | "email" | "referral" | "direct";

export const TRAFFIC_SOURCES: readonly TrafficSource[] = ["ai", "search", "social", "paid", "email", "referral", "direct"];

export const TRAFFIC_SOURCE_LABEL: Record<TrafficSource, string> = {
  ai: "AI assistants (ChatGPT, Perplexity, Claude, Gemini)",
  search: "Search engines",
  social: "Social",
  paid: "Paid ads",
  email: "Email",
  referral: "Other websites",
  direct: "Direct",
};

/**
 * One DOM change. Values are always plain text (set with textContent, never innerHTML).
 * `{query}` in a value is replaced by the visitor's search query (title case), when there is one.
 */
export interface WebChange {
  action: "text" | "banner" | "badge" | "hide" | "style";
  /** CSS selector of the element(s) to change. Ignored for `banner` (always the top of the page). */
  selector?: string;
  /** text / banner / badge: the text. style: CSS declarations ("color: #b00; font-weight: 700"). */
  value?: string;
}

export interface WebAudience {
  /** Empty or missing = every source. */
  sources?: TrafficSource[];
  /** Only visitors whose search query contains one of these words (case-insensitive). */
  queryIncludes?: string[];
  /** Only these path prefixes ("/products/"). Missing = every page. */
  paths?: string[];
}

export type WebRuleStatus = "draft" | "running" | "paused" | "shipped";

export interface WebRule {
  id: string;
  /** darwin.js `data-darwin-site`. */
  site: string;
  name: string;
  /** Why this should help, in one sentence. */
  hypothesis?: string;
  audience: WebAudience;
  changes: WebChange[];
  /** test = A/B against the unchanged page; always = personalization, everyone in the audience sees it. */
  mode: "test" | "always";
  /** Share of the audience that gets the change while testing (0–1). */
  allocation: number;
  status: WebRuleStatus;
  /** Conversion event the test is judged on. */
  metric: string;
  /** Who wrote it: "manual", "heuristic", "llm:<model>". */
  author: string;
  prompt?: string;
  createdAt: string;
  updatedAt: string;
  /** When it first went live. Exposures before this don't count. */
  startedAt?: string;
  /** When it was shipped to the whole audience. A/B results only count exposures before this. */
  shippedAt?: string;
  /** Why a test ended (set when it's shipped or stopped on a result). */
  outcome?: WebRuleOutcome;
}

export interface WebRuleOutcome {
  decision: "shipped" | "stopped";
  /** One line: "97% chance better, +41% orders". */
  reason: string;
  probabilityToBeat?: number;
  lift?: number;
  at: string;
  by: "autopilot" | "manual";
}

/** One thing autopilot did, for the console's decision log. */
export interface WebAutopilotEntry {
  at: string;
  kind: "on" | "off" | "started" | "shipped" | "stopped" | "waiting";
  message: string;
  ruleId?: string;
  source?: TrafficSource;
}

/**
 * Autopilot runs the loop on its own for a site: one A/B test per traffic source (biggest conversion gap
 * first), ships winners, stops losers, then tries that source's next idea.
 */
export interface WebAutopilotState {
  site: string;
  on: boolean;
  /** Newest first. */
  log: WebAutopilotEntry[];
  /** Playbook ideas already tried ("ai:0"), so a stopped idea is never retried. */
  tried: string[];
  lastStepAt?: string;
}

/** A rule as drafted (from a prompt or the playbook), before it's saved. */
export type WebRuleDraft = Pick<WebRule, "site" | "name" | "hypothesis" | "audience" | "changes" | "mode" | "allocation" | "metric" | "author" | "prompt">;

/** An element worth changing, found on the site's page (for drafting). */
export interface PageElement {
  selector: string;
  tag: string;
  text: string;
}

/** What the browser runtime needs (no prompts or authorship). */
export type WebRuntimeRule = Pick<WebRule, "id" | "audience" | "changes" | "mode" | "allocation" | "status">;

export interface WebArmStats {
  visitors: number;
  conversions: number;
  conversionRate: number;
}

export interface WebRuleResult {
  ruleId: string;
  control: WebArmStats;
  treatment: WebArmStats;
  /** P(treatment converts better), when both arms have visitors. */
  probabilityToBeat?: number;
  /** Posterior median relative lift. */
  lift?: number;
  bySource: Partial<Record<TrafficSource, { control: WebArmStats; treatment: WebArmStats }>>;
  /** True when every visitor counted was simulated. */
  synthetic: boolean;
}

export interface WebSiteOverview {
  site: string;
  /** Latest page seen on this site (used for previews). */
  url?: string;
  visitors: number;
  conversions: number;
  conversionRate: number;
  /** Visitors and conversions per traffic source (source = the visitor's first page view). */
  bySource: Record<TrafficSource, WebArmStats>;
  /** How many of the visitors were simulated. */
  syntheticVisitors: number;
}

export interface WebSiteSummary {
  site: string;
  url?: string;
  visitors: number;
  rules: number;
}

export interface WebRulesResponse {
  site: string;
  rules: WebRule[];
  results: WebRuleResult[];
  overview: WebSiteOverview;
  sites: WebSiteSummary[];
  autopilot: WebAutopilotState;
}

export interface WebDraftResponse {
  rule: WebRuleDraft;
  source: "llm" | "heuristic";
  /** Elements found on the page, when it could be fetched. */
  outline: PageElement[];
}

/** One clicked element on a page (from darwin.js `$autocapture` / `$rageclick`). */
export interface HeatmapElement {
  /** The selector darwin.js recorded: valid CSS, so the console can find the element again. */
  selector: string;
  tag: string;
  /** Most common visible text. */
  text: string;
  clicks: number;
  rageClicks: number;
  visitors: number;
  /** Share of all clicks on the page. */
  share: number;
}

export interface WebHeatmap {
  site: string;
  /** Page path the clicks are from ("/demo/north-trail"); all pages when missing. */
  path?: string;
  /** Only visitors from this source; all when missing. */
  source?: TrafficSource;
  clicks: number;
  rageClicks: number;
  visitors: number;
  /** How many of the clicks were simulated. */
  syntheticClicks: number;
  /** Most clicked first. */
  elements: HeatmapElement[];
}

// GET  /api/web/runtime.js?site=…            → JS (public; darwin.js loads it)
// GET  /api/web/rules?site=…                  → WebRulesResponse                                (admin)
// POST /api/web/rules { rule: WebRuleDraft, status? } → { rule }                               (admin)
// PATCH /api/web/rules/:id { status?, name?, changes?, … } → { rule }                          (admin)
// DELETE /api/web/rules/:id                   → { ok }                                          (admin)
// POST /api/web/draft { site, prompt, url? }  → WebDraftResponse (LLM or heuristic, not saved)  (admin)
// POST /api/web/suggest { site }              → { rules: WebRuleDraft[] } playbook per source   (admin)
// POST /api/web/simulate { site, visitors }   → WebSimulateResponse, synthetic traffic          (admin)
// GET  /api/web/heatmap?site=…&path=…&source=… → WebHeatmap                                   (admin)
// POST /api/web/autopilot { site, on }        → WebAutopilotState                               (admin)
// POST /api/web/autopilot/step { site }       → { state: WebAutopilotState, actions }          (admin)

export interface WebSimulateResponse {
  site: string;
  visitors: number;
  orders: number;
  /** Always true: these visitors are generated, and their events carry properties.synthetic = true. */
  synthetic: true;
}
