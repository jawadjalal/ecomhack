/**
 * "Ship the winner" PR: title, branch and body for a PR that makes a winning PageSpec the
 * storefront's new baseline (`storefront.config.json`). Pure functions — no I/O.
 */
import type { ChangeProposal, Experiment, Insight, PageSpec, VariantStats } from "@/lib/contracts";
import { describeDiff } from "@/lib/spec/patch";

export const DEFAULT_CONFIG_PATH = "apps/web/storefront.config.json";

/** Events attributed to the experiment, and how many of them came from the simulator. */
export interface TrafficMix {
  events: number;
  synthetic: number;
}

export interface SpecPrInput {
  repo: string;
  /** The spec being shipped (becomes the file content). */
  spec: PageSpec;
  /** What the experiment's control arm served (the diff the experiment actually tested). */
  previous: PageSpec;
  /** What the config file in the repo contains now, if Darwin could read it. */
  current?: PageSpec | null;
  experiment?: Experiment;
  proposal?: ChangeProposal;
  insights?: Insight[];
  summary: string;
  traffic?: TrafficMix;
  configPath: string;
  generation?: number;
  mode: "live" | "dry-run" | "offline";
}

/* ------------------------------------------------------------------ formatting */

const int = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const signedPct = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;
const money = (pence: number) => {
  const [whole, frac] = (Math.abs(pence) / 100).toFixed(2).split(".");
  return `${pence < 0 ? "−" : ""}£${int(Number(whole))}.${frac}`;
};
const prob = (p: number) => (p >= 0.995 ? ">0.99" : p <= 0.005 ? "<0.01" : p.toFixed(2));
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (s: string) => `\`${cell(s)}\``;

function slugify(s: string, max = 40): string {
  const slug = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "") || "spec";
}

function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------------ naming */

const GEN_LABEL = /^\s*gen(?:eration)?\s*(\d+)\s*[:\-–—]\s*/i;

export function specGeneration(spec: PageSpec, generation?: number): number {
  if (generation !== undefined) return generation;
  const m = spec.label.match(GEN_LABEL);
  return m ? Number(m[1]) : spec.version;
}

/** What the change is, in a few words: "show shipping upfront". */
export function changeDescription(spec: PageSpec, experiment?: Experiment, proposal?: ChangeProposal): string {
  const fromLabel = spec.label.replace(GEN_LABEL, "").trim();
  const raw =
    (fromLabel && !/^baseline$/i.test(fromLabel) ? fromLabel : "") ||
    experiment?.name?.trim() ||
    proposal?.title?.trim() ||
    `promote spec v${spec.version}`;
  const text = lowerFirst(raw.replace(/\s+/g, " "));
  return text.length > 72 ? `${text.slice(0, 71).trimEnd()}…` : text;
}

export function specBranchName(spec: PageSpec, opts: { experiment?: Experiment; proposal?: ChangeProposal; generation?: number } = {}) {
  const gen = specGeneration(spec, opts.generation);
  return `darwin/gen-${gen}-${slugify(changeDescription(spec, opts.experiment, opts.proposal))}`;
}

export function specPrTitle(spec: PageSpec, opts: { experiment?: Experiment; proposal?: ChangeProposal; generation?: number } = {}) {
  const gen = specGeneration(spec, opts.generation);
  const desc = changeDescription(spec, opts.experiment, opts.proposal);
  const r = opts.experiment?.result;
  const stats = r ? ` (${signedPct(r.lift)} conversion, P=${prob(r.probabilityToBeat)})` : "";
  return `Darwin Gen ${gen}: ${desc}${stats}`;
}

/** Default PR summary when the caller doesn't provide one. */
export function defaultShipSummary(experiment?: Experiment, spec?: PageSpec): string {
  const r = experiment?.result;
  if (!experiment || !r) {
    return spec ? `Promotes storefront spec v${spec.version} (“${spec.label}”) to the committed baseline.` : "Promotes the live storefront spec to the committed baseline.";
  }
  const visitors = r.control.visitors + r.treatment.visitors;
  const agents = r.control.byKind.agent.visitors + r.treatment.byKind.agent.visitors;
  return (
    `Darwin A/B tested “${experiment.name}” on ${int(visitors)} visitors (${int(visitors - agents)} humans, ${int(agents)} AI agents). ` +
    `The treatment converted at ${pct(r.treatment.conversionRate, 2)} vs ${pct(r.control.conversionRate, 2)} for control ` +
    `(${signedPct(r.lift)}, P(better) = ${prob(r.probabilityToBeat)}).`
  );
}

/* ------------------------------------------------------------------ diff table */

const SETTING_LABELS: Record<string, string> = {
  "hero.headline": "Hero headline",
  "hero.subheadline": "Hero subheadline",
  "hero.ctaText": "Hero button text",
  "hero.layout": "Hero layout",
  "hero.showSocialProof": "Social proof strip under the hero",
  "announcement.enabled": "Announcement bar",
  "announcement.text": "Announcement bar text",
  "productGrid.columns": "Product grid columns",
  "productGrid.showRatings": "Star ratings on product cards",
  "productGrid.showQuickAdd": "Quick add on product cards",
  "productGrid.sort": "Default product sort",
  "productPage.ctaText": "Add-to-cart button text",
  "productPage.ctaPosition": "Add-to-cart button position",
  "productPage.showReviews": "Reviews on product pages",
  "productPage.showSizeGuide": "Size guide on product pages",
  "productPage.showDeliveryEstimate": "Delivery estimate on product pages",
  "productPage.showReturnsPolicy": "Returns policy on product pages",
  "productPage.urgency": "Urgency messaging",
  "productPage.trustBadges": "Trust badges",
  "cart.showShippingUpfront": "Shipping cost shown in the cart",
  "cart.freeShippingThreshold": "Free shipping threshold",
  "cart.upsell": "Cross-sell in the cart",
  "checkout.steps": "Checkout steps",
  "checkout.guestCheckout": "Guest checkout",
  "checkout.expressPay": "Express pay buttons",
  "theme.accent": "Accent colour",
  "theme.radius": "Corner radius",
  "agentSurface.structuredData": "Agents: schema.org Product JSON-LD",
  "agentSurface.exposeStock": "Agents: per-size stock levels",
  "agentSurface.exposeDeliveryEta": "Agents: delivery ETA",
  "agentSurface.exposeReturnPolicy": "Agents: return policy",
  "agentSurface.exposeLandedPrice": "Agents: landed price incl. shipping",
  "agentSurface.negotiation.enabled": "Agents: price negotiation",
  "agentSurface.negotiation.maxDiscountPct": "Agents: max negotiated discount (%)",
};

export interface DiffRow {
  path: string;
  before: string;
  after: string;
}

/** Structured rows from `describeDiff` lines ("cart.showShippingUpfront: false → true"). */
export function diffRows(before: PageSpec, after: PageSpec): DiffRow[] {
  return describeDiff(before, after).map((line) => {
    const m = line.match(/^([^:]+): (.*) → (.*)$/);
    return m ? { path: m[1], before: m[2], after: m[3] } : { path: line, before: "", after: "" };
  });
}

function renderValue(path: string, json: string): string {
  if (json === "" || json === "undefined") return "—";
  const moneyish = /Threshold$/.test(path) && /^\d+$/.test(json);
  return `${code(json)}${moneyish ? ` (${money(Number(json))})` : ""}`;
}

function diffTable(rows: DiffRow[]): string[] {
  const out = ["| Setting | Before | After |", "|---|---|---|"];
  for (const r of rows) {
    const label = SETTING_LABELS[r.path];
    out.push(`| ${label ? `${cell(label)}<br>${code(r.path)}` : code(r.path)} | ${renderValue(r.path, r.before)} | ${renderValue(r.path, r.after)} |`);
  }
  return out;
}

/* ------------------------------------------------------------------ results */

function audienceCell(s: { visitors: number; conversions: number; conversionRate: number }) {
  return s.visitors ? `${pct(s.conversionRate, 2)} (${int(s.conversions)} / ${int(s.visitors)})` : "—";
}

function audienceLift(c: { visitors: number; conversionRate: number }, t: { visitors: number; conversionRate: number }) {
  if (!c.visitors || !t.visitors) return "—";
  if (c.conversionRate === 0) return t.conversionRate > 0 ? "new conversions" : "—";
  return signedPct((t.conversionRate - c.conversionRate) / c.conversionRate);
}

function resultsSection(exp: Experiment, specVersion: number): string[] {
  const r = exp.result!;
  const arm = (name: string, spec: string, v: VariantStats) =>
    `| ${name} | ${spec} | ${int(v.visitors)} | ${int(v.conversions)} | **${pct(v.conversionRate, 2)}** | ${money(v.revenue)} |`;
  return [
    "## Results",
    "",
    `**Conversion ${signedPct(r.lift)}** (95% credible interval ${signedPct(r.liftInterval[0])} to ${signedPct(r.liftInterval[1])}) · ` +
      `**P(treatment beats control) = ${prob(r.probabilityToBeat)}** · decision: **${r.decision}**`,
    "",
    "| Arm | Spec | Visitors | Orders | Conversion rate | Revenue |",
    "|---|---|---:|---:|---:|---:|",
    arm("Control", `v${exp.controlVersion} (live)`, r.control),
    arm("Treatment", `v${specVersion} (this PR)`, r.treatment),
    "",
    "**By audience** — Darwin optimises for human shoppers and AI shopping agents separately:",
    "",
    "| Audience | Control | Treatment | Lift |",
    "|---|---:|---:|---:|",
    `| Humans | ${audienceCell(r.control.byKind.human)} | ${audienceCell(r.treatment.byKind.human)} | ${audienceLift(r.control.byKind.human, r.treatment.byKind.human)} |`,
    `| AI agents | ${audienceCell(r.control.byKind.agent)} | ${audienceCell(r.treatment.byKind.agent)} | ${audienceLift(r.control.byKind.agent, r.treatment.byKind.agent)} |`,
    "",
  ];
}

function trafficNote(t?: TrafficMix): string[] {
  if (!t || t.events === 0) return [];
  if (t.synthetic >= t.events) {
    return [
      "> [!WARNING]",
      `> **Simulated traffic.** All ${int(t.events)} events in this experiment were generated by Darwin's traffic simulator (\`properties.synthetic = true\`).`,
      "> The result demonstrates the loop end to end; confirm the lift on real traffic before relying on it.",
      "",
    ];
  }
  if (t.synthetic > 0) {
    return [
      "> [!NOTE]",
      `> **Mixed traffic.** ${int(t.synthetic)} of ${int(t.events)} events (${pct(t.synthetic / t.events)}) in this experiment were simulated (\`properties.synthetic = true\`); the rest came from real visitors.`,
      "",
    ];
  }
  return [`All ${int(t.events)} events in this experiment came from real visitors.`, ""];
}

function duration(from: string, to?: string): string | undefined {
  if (!to) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 120) return `${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

/* ------------------------------------------------------------------ body */

export function buildSpecPrBody(input: SpecPrInput): string {
  const { spec, previous, current, experiment: exp, proposal, insights, configPath } = input;
  const gen = specGeneration(spec, input.generation);
  const out: string[] = [];

  if (input.mode === "offline") {
    out.push(
      "> [!NOTE]",
      "> **Dry run — preview only.** No `GITHUB_TOKEN` is configured, so no branch or PR was created. The diff below is against the previous spec Darwin served.",
      "",
    );
  } else if (input.mode === "dry-run") {
    out.push("> [!NOTE]", "> **Dry run — preview only** (`DARWIN_GITHUB_DRY_RUN=1`). No branch or PR was created.", "");
  }

  out.push(
    "## Summary",
    "",
    input.summary.trim(),
    "",
    `Merging this PR updates \`${configPath}\` so **Gen ${gen}** (spec v${spec.version}) becomes the storefront's committed baseline on the next deploy. ` +
      "The storefront renders from this declarative spec, so no application code changes.",
    "",
  );

  if (proposal?.hypothesis) {
    out.push("## Hypothesis", "", proposal.hypothesis.trim(), "");
    if (proposal.expectedLift) out.push(`Expected lift before testing: ${signedPct(proposal.expectedLift)}.`, "");
  }

  if (exp?.result) {
    out.push(...resultsSection(exp, spec.version));
    out.push(...trafficNote(input.traffic));
  } else {
    out.push("## Results", "", "No experiment results are attached to this change: it was promoted without an A/B test.", "");
  }

  // What this experiment changed vs what this PR changes in the file (may include unmerged earlier gens).
  const tested = diffRows(previous, spec);
  const testedPaths = new Set(tested.map((r) => r.path));
  const carried = current ? diffRows(current, spec).filter((r) => !testedPaths.has(r.path)) : [];
  out.push("## What changes", "");
  if (tested.length) out.push(...diffTable(tested), "");
  else out.push("No setting differs from the control arm (label/version bump only).", "");
  if (carried.length) {
    out.push(
      `**Also in this PR** — earlier Darwin generations that are live but not yet merged into \`${configPath}\`:`,
      "",
      ...diffTable(carried),
      "",
    );
  }
  out.push("Every change is a declarative patch validated against `PageSpecSchema`; nothing outside the config file is touched.", "");

  out.push("## How Darwin decided", "");
  const steps: string[] = [];
  if (exp?.result) {
    const r = exp.result;
    const humans = r.control.byKind.human.visitors + r.treatment.byKind.human.visitors;
    const agents = r.control.byKind.agent.visitors + r.treatment.byKind.agent.visitors;
    steps.push(`**Observe** — tracked ${int(humans)} human shoppers and ${int(agents)} AI agents through the funnel on spec v${exp.controlVersion}.`);
  } else {
    steps.push("**Observe** — tracked human shoppers and AI agents through the funnel.");
  }
  const relevant = (insights ?? []).filter((i) => !proposal || proposal.insightIds.includes(i.id));
  if (relevant.length) {
    steps.push(
      "**Diagnose** — found the friction this change targets:" +
        relevant
          .slice(0, 3)
          .map((i) => {
            const evidence = i.evidence.length ? ` (${i.evidence.map((e) => `${e.label}: ${e.value}`).join(", ")})` : "";
            return `\n   - **${i.title}** — ${i.audience === "all" ? "all visitors" : i.audience === "agent" ? "AI agents" : "humans"}, ${i.severity} severity${evidence}. ${i.detail}`;
          })
          .join(""),
    );
  }
  if (proposal) {
    const by = proposal.source === "heuristic" ? "Darwin's heuristic engine" : `\`${proposal.source}\``;
    steps.push(`**Propose** — ${by} proposed “${proposal.title}” as a declarative spec patch.`);
  }
  if (exp) {
    const took = duration(exp.createdAt, exp.completedAt);
    steps.push(
      `**Experiment** — ${Math.round(exp.allocation * 100)}% of visitors saw the treatment, ${Math.round((1 - exp.allocation) * 100)}% the control, ` +
        `with sticky assignment on \`distinct_id\`; primary metric \`${exp.primaryMetric}\`${took ? `; ran for ${took}` : ""}.`,
    );
  }
  if (exp?.result) {
    const r = exp.result;
    steps.push(
      `**Decide** — Bayesian comparison of conversion rates: P(treatment > control) = ${prob(r.probabilityToBeat)}, ` +
        `95% credible interval on lift ${signedPct(r.liftInterval[0])} to ${signedPct(r.liftInterval[1])} → **${r.decision}**.`,
    );
  }
  steps.push(`**Ship** — opened this PR. Nothing reaches production until a human merges it.`);
  steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
  out.push("");

  const restored = current ?? previous;
  out.push(
    "## Rollback",
    "",
    `Revert this PR to restore spec v${restored.version} (“${restored.label}”) on the next deploy. Darwin keeps the full spec history, so any generation can be restored.`,
    "",
    "---",
    `<sub>Opened by Darwin · ${[
      exp ? `experiment \`${exp.id}\`` : null,
      proposal ? `proposal \`${proposal.id}\`` : null,
      `spec v${previous.version} → v${spec.version}`,
    ]
      .filter(Boolean)
      .join(" · ")}</sub>`,
  );
  return out.join("\n");
}
