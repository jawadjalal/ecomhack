/**
 * Contracts for the self-improvement loop: insights, proposals, experiments, loop state.
 */
import type { PageSpec, SpecPatch } from "./page-spec";
import type { VisitorKind } from "./events";

/* ------------------------------------------------------------------ insights */

export type Audience = VisitorKind | "all";

export interface Insight {
  id: string;
  /** Short title, e.g. "62% of carts die when shipping is revealed". */
  title: string;
  audience: Audience;
  severity: "low" | "medium" | "high";
  /** Where in the funnel. Free text, e.g. "checkout", "product page", "agent: catalog". */
  stage: string;
  /** Plain-language explanation, 1-3 sentences, citing numbers. */
  detail: string;
  /** The numbers backing the insight. Rendered as chips in the console. */
  evidence: { label: string; value: string }[];
  /** Estimated conversions lost per 1,000 sessions. Used for ranking. */
  impactScore: number;
}

/* ------------------------------------------------------------------ proposals */

export interface ChangeProposal {
  id: string;
  createdAt: string;
  /** Which insight(s) this addresses. */
  insightIds: string[];
  /** One-line summary, e.g. "Show shipping cost in cart + free shipping over £60". */
  title: string;
  /** Why we believe this will work. Shown in the console and the PR body. */
  hypothesis: string;
  /** The change itself. Validated against PageSpecSchema after applying. */
  patch: SpecPatch;
  /** Human-readable list of what changes, e.g. ["cart.showShippingUpfront: false → true"]. */
  diff: string[];
  /** Expected relative lift on the primary metric, e.g. 0.12 = +12%. */
  expectedLift: number;
  /** "llm:grok-…", "llm:claude-…" or "heuristic". Shown for honesty in the demo. */
  source: string;
}

/* ------------------------------------------------------------------ experiments */

export interface VariantStats {
  variant: string;
  /** Unique visitors exposed. */
  visitors: number;
  conversions: number;
  revenue: number;
  /** conversions / visitors. */
  conversionRate: number;
  byKind: Record<VisitorKind, { visitors: number; conversions: number; conversionRate: number }>;
}

export interface ExperimentResult {
  control: VariantStats;
  treatment: VariantStats;
  /** (treatment CR - control CR) / control CR. */
  lift: number;
  /** Bayesian P(treatment > control). */
  probabilityToBeat: number;
  /** 95% credible interval on lift. */
  liftInterval: [number, number];
  decision: "running" | "ship" | "reject" | "inconclusive";
  /**
   * Visitors that lift / probabilityToBeat / liftInterval are computed on. "all" (default) or a single
   * audience when the change can only affect it (agentSurface-only patches are measured on agents).
   */
  audience?: Audience;
}

export interface Experiment {
  id: string;
  name: string;
  status: "running" | "completed" | "stopped";
  createdAt: string;
  completedAt?: string;
  proposalId: string;
  /** Live spec version the control arm serves. */
  controlVersion: number;
  /** The fully-resolved spec served to the treatment arm. */
  treatmentSpec: PageSpec;
  /** Share of traffic in treatment, 0..1. */
  allocation: number;
  primaryMetric: "order_completed";
  result?: ExperimentResult;
}

/* ------------------------------------------------------------------ loop */

export type LoopPhase =
  | "idle"
  | "observe" // collecting baseline behaviour
  | "diagnose" // turning analytics into insights
  | "propose" // generating a spec change
  | "experiment" // A/B testing the change
  | "decide" // reading the result
  | "ship"; // promoting the winner + opening a PR

export interface LoopLogEntry {
  at: string;
  phase: LoopPhase;
  /** Who is speaking in the activity feed. */
  actor: "observer" | "analyst" | "designer" | "experimenter" | "shipper" | "system";
  message: string;
  /** Optional structured payload the console can render (insight, proposal, PR…). */
  data?: unknown;
}

export interface GenerationRecord {
  generation: number;
  specVersion: number;
  label: string;
  /** Conversion rates measured for this generation's live spec. */
  humanConversionRate: number;
  agentConversionRate: number;
  overallConversionRate: number;
  /** Sample sizes behind the rates above (lets later measurements be pooled in). */
  humanVisitors?: number;
  agentVisitors?: number;
  /** Result of the experiment that produced this generation (absent for Gen 0). */
  experimentId?: string;
  lift?: number;
  prUrl?: string;
  shippedAt: string;
}

export interface LoopState {
  phase: LoopPhase;
  /** True while the loop auto-advances through phases. */
  autopilot: boolean;
  generation: number;
  liveSpec: PageSpec;
  insights: Insight[];
  proposal?: ChangeProposal;
  experimentId?: string;
  history: GenerationRecord[];
  log: LoopLogEntry[];
  updatedAt: string;
}
