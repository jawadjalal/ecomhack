/**
 * Tracking plans: what Darwin will record for a store, and why, from what the merchant said.
 *
 * - buildPlan(): automatic events (darwin.js records them with no code), the shopping funnel, events for
 *   the merchant's own goal ("checkout feels slow on mobile" → checkout steps and errors, by device), and
 *   Whop payments when Whop is connected. Dashboards follow from the events.
 * - amendPlan(): the merchant chats ("also track wishlist adds", "don't track clicks"); the LLM edits the
 *   plan when configured, else a small parser does.
 */
import { z } from "zod";
import type { DashboardSpec, TrackingEvent, TrackingPlan } from "@/lib/contracts";
import { generateJson, llmAvailable, llmLabel } from "@/lib/llm/client";

/* ------------------------------------------------------------------ the catalogue */

type Def = Omit<TrackingEvent, "enabled" | "snippet" | "fromPrompt">;

const snippetFor = (name: string, properties: string[] = []) =>
  `window.darwin?.capture("${name}"${properties.length ? `, { ${properties.map((p) => `${p}: …`).join(", ")} }` : ""});`;

export const AUTOMATIC: Def[] = [
  { name: "$pageview", label: "Page views", why: "Every visit and page, with where the visitor came from (ChatGPT, Google, Instagram, ads…) and what they searched for.", category: "automatic", automatic: true },
  { name: "$autocapture", label: "Clicks", why: "What people click on every page: powers the heatmap.", category: "automatic", automatic: true },
  { name: "$rageclick", label: "Rage clicks", why: "Three angry clicks on the same thing: broken or confusing UI.", category: "automatic", automatic: true },
  { name: "$pageleave", label: "Exits & time on page", why: "Where people give up.", category: "automatic", automatic: true },
  { name: "agent_visit", label: "AI shopping agents", why: "ChatGPT, Perplexity and other agents shopping your store, told apart from humans on the server.", category: "automatic", automatic: true },
];

export const FUNNEL: Def[] = [
  { name: "product_viewed", label: "Viewed a product", why: "The top of your funnel.", category: "funnel", automatic: false, properties: ["product_id", "price"] },
  { name: "product_added", label: "Added to cart", why: "Intent to buy.", category: "funnel", automatic: false, properties: ["product_id", "price", "quantity"] },
  { name: "checkout_started", label: "Started checkout", why: "Where carts turn into checkouts, or don't.", category: "funnel", automatic: false, properties: ["value"] },
  { name: "order_completed", label: "Placed an order", why: "The conversion every test is judged on.", category: "funnel", automatic: false, properties: ["revenue", "order_id"] },
];

/** Goal-specific events, picked from the merchant's own words. */
const GOALS: { match: RegExp; because: string; events: Def[]; dashboards?: DashboardSpec[] }[] = [
  {
    match: /checkout|payment|pay\b|abandon|slow|cart/,
    because: "checkout",
    events: [
      { name: "checkout_step_viewed", label: "Checkout step viewed", why: "Shows exactly which checkout step loses people.", category: "goal", automatic: false, properties: ["step", "step_name"] },
      { name: "checkout_error", label: "Checkout error", why: "Validation and payment errors that silently kill orders.", category: "goal", automatic: false, properties: ["step", "message"] },
    ],
  },
  {
    match: /mobile|phone|app\b|tablet/,
    because: "mobile",
    events: [],
    dashboards: [{ id: "devices", kind: "devices", title: "Mobile vs desktop", why: "Is mobile converting worse than desktop, and by how much?" }],
  },
  {
    match: /search/,
    because: "search",
    events: [{ name: "search_performed", label: "Searched the store", why: "What people look for, and searches that find nothing.", category: "goal", automatic: false, properties: ["query", "results"] }],
  },
  {
    match: /size|fit|sizing/,
    because: "sizing",
    events: [
      { name: "size_guide_opened", label: "Opened the size guide", why: "Sizing doubt is the #1 reason fashion carts stall.", category: "goal", automatic: false, properties: ["product_id"] },
      { name: "size_selected", label: "Picked a size", why: "Which sizes are chosen (and out of stock).", category: "goal", automatic: false, properties: ["product_id", "size"] },
    ],
  },
  {
    match: /newsletter|subscribe|sign.?up|email list|mailing/,
    because: "sign-ups",
    events: [{ name: "newsletter_signup", label: "Newsletter sign-up", why: "List growth, and whether the popup helps or hurts sales.", category: "goal", automatic: false, properties: ["placement"] }],
  },
  {
    match: /coupon|discount|promo|code/,
    because: "discounts",
    events: [{ name: "coupon_applied", label: "Coupon applied", why: "Which codes drive orders, and which only cut margin.", category: "goal", automatic: false, properties: ["code", "valid"] }],
  },
  {
    match: /wishlist|save for later|favou?rite/,
    because: "wishlists",
    events: [{ name: "wishlist_added", label: "Saved to wishlist", why: "Interest that isn't ready to buy yet.", category: "goal", automatic: false, properties: ["product_id"] }],
  },
  {
    match: /return|refund/,
    because: "returns",
    events: [{ name: "return_requested", label: "Return requested", why: "Which products come back, and why.", category: "goal", automatic: false, properties: ["order_id", "reason"] }],
  },
  {
    match: /subscription|membership|recurring|member/,
    because: "memberships",
    events: [{ name: "subscription_started", label: "Membership started", why: "Recurring revenue, the metric that compounds.", category: "goal", automatic: false, properties: ["plan", "price"] }],
  },
  {
    match: /review|rating|stars/,
    because: "reviews",
    events: [{ name: "reviews_viewed", label: "Read reviews", why: "Whether reading reviews leads to buying.", category: "goal", automatic: false, properties: ["product_id"] }],
  },
  {
    match: /shipping|delivery|dispatch/,
    because: "delivery",
    events: [{ name: "shipping_estimate_viewed", label: "Checked delivery", why: "Delivery cost and speed are why most carts are abandoned.", category: "goal", automatic: false, properties: ["country", "cost"] }],
  },
];

const WHOP: Def[] = [
  { name: "whop_payment", label: "Whop payments", why: "Payments from your Whop business, straight into the funnel (webhook, no code).", category: "revenue", automatic: true },
  { name: "order_refunded", label: "Refunds", why: "Refunds from Whop, so revenue is net.", category: "revenue", automatic: true },
];

const enable = (d: Def, fromPrompt = false): TrackingEvent => ({
  ...d,
  enabled: true,
  ...(d.automatic ? {} : { snippet: snippetFor(d.name, d.properties) }),
  ...(fromPrompt ? { fromPrompt: true } : {}),
});

/* ------------------------------------------------------------------ dashboards */

/** The dashboards a plan implies, in the order they're shown. */
export function dashboardsFor(plan: Pick<TrackingPlan, "events" | "whop" | "prompt">, extra: DashboardSpec[] = []): DashboardSpec[] {
  const on = (name: string) => plan.events.some((e) => e.name === name && e.enabled);
  const out: DashboardSpec[] = [{ id: "kpis", kind: "kpis", title: "Today at a glance", why: "Visitors, orders, conversion and revenue, live." }];
  const steps = ["$pageview", ...FUNNEL.map((f) => f.name).filter(on)];
  if (steps.length > 1) out.push({ id: "funnel", kind: "funnel", title: "Conversion funnel", why: "Where shoppers drop off between landing and ordering.", events: steps });
  // Errors aren't a step people pass through, so they're charted under "Your goals", not in the funnel.
  const checkout = ["checkout_started", "checkout_step_viewed", "order_completed"].filter(on);
  if (on("checkout_step_viewed")) out.push({ id: "checkout", kind: "funnel", title: "Checkout drop-off", why: "Which checkout step loses people.", events: checkout });
  if (on("$pageview")) out.push({ id: "sources", kind: "sources", title: "Where shoppers come from", why: "ChatGPT vs Google vs Instagram vs ads: who converts, who doesn't." });
  out.push(...extra);
  if (on("agent_visit")) out.push({ id: "humans-agents", kind: "humans-agents", title: "Humans vs AI agents", why: "AI agents shop differently: are they buying?" });
  if (on("$autocapture")) out.push({ id: "heatmap", kind: "heatmap", title: "Click heatmap", why: "What people click, and rage-click, on your pages." });
  out.push({ id: "experiments", kind: "experiments", title: "Darwin's experiments", why: "Every change Darwin tests, and what it did to orders." });
  if (on("order_completed") || plan.whop) out.push({ id: "revenue", kind: "revenue", title: "Revenue", why: plan.whop ? "Store orders and Whop payments, minute by minute." : "Orders and revenue, minute by minute." });
  const goals = plan.events.filter((e) => e.enabled && e.category === "goal").map((e) => e.name);
  if (goals.length) out.push({ id: "goals", kind: "events", title: "Your goals", why: "The events you asked for, as they happen.", events: goals });
  return out;
}

/** Recompute a plan's dashboards after its events changed, keeping goal extras and the merchant's own charts. */
function rebuild<T extends Pick<TrackingPlan, "events" | "whop" | "prompt">>(next: T, prev: Pick<TrackingPlan, "dashboards">): T & { dashboards: DashboardSpec[] } {
  const custom = prev.dashboards.filter((d) => d.custom);
  return { ...next, dashboards: [...dashboardsFor(next, prev.dashboards.filter((d) => d.kind === "devices" && !d.custom)), ...custom] };
}

/* ------------------------------------------------------------------ build */

export interface PlanInput {
  site: string;
  prompt?: string;
  repo?: string;
  /** No GitHub: the store's URL (darwin.js goes in with a script tag). */
  siteUrl?: string;
  framework?: string;
  whop?: string;
  /** Analytics found in the repo. */
  analytics?: string[];
  /** Whether the repo could actually be read (else framework is assumed). Default true. */
  repoRead?: boolean;
}

export function heuristicPlan(input: PlanInput): TrackingPlan {
  const words = ` ${(input.prompt ?? "").toLowerCase()} `;
  const events: TrackingEvent[] = [...AUTOMATIC.map((d) => enable(d)), ...FUNNEL.map((d) => enable(d))];
  const extra: DashboardSpec[] = [];
  const goals: string[] = [];
  for (const g of GOALS) {
    if (!g.match.test(words)) continue;
    goals.push(g.because);
    for (const d of g.events) if (!events.some((e) => e.name === d.name)) events.push(enable({ ...d, why: `${d.why} (you mentioned ${g.because})` }, true));
    extra.push(...(g.dashboards ?? []));
  }
  if (input.whop) events.push(...WHOP.map((d) => enable(d)));
  const now = new Date().toISOString();
  const base = { site: input.site, repo: input.repo, siteUrl: input.siteUrl, framework: input.framework, prompt: input.prompt, whop: input.whop, goals, existingAnalytics: input.repoRead === false ? undefined : input.analytics, repoRead: input.repoRead ?? true, events };
  return { ...base, dashboards: dashboardsFor(base, extra), author: "heuristic", createdAt: now, updatedAt: now };
}

const IdeasSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        label: z.string().max(60),
        why: z.string().max(200),
        properties: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).max(6).default([]),
      }),
    )
    .max(4)
    .default([]),
});

/**
 * The plan for a store: the heuristic plan, plus (when an LLM is configured and the merchant said
 * something) up to 4 events specific to their store that the keyword list can't know about.
 */
export async function buildPlan(input: PlanInput): Promise<TrackingPlan> {
  const plan = heuristicPlan(input);
  if (!llmAvailable() || !input.prompt?.trim()) return plan;
  try {
    const out = await generateJson({
      system:
        "You plan ecommerce analytics. Given a store description and the events already planned, suggest up to 4 MORE custom events that matter for this particular store and the merchant's stated worry. " +
        'Return JSON {"events":[{"name":"snake_case","label":"Short label","why":"one sentence tied to what they said","properties":["prop"]}]}. Return an empty list if nothing important is missing.',
      prompt: `Store: ${JSON.stringify(input.prompt)}\nFramework: ${input.framework ?? "unknown"}\nAlready planned: ${plan.events.map((e) => e.name).join(", ")}`,
      schema: IdeasSchema,
      maxTokens: 700,
    });
    const extra = out.events
      .filter((e) => !plan.events.some((p) => p.name === e.name))
      .map((e) => enable({ ...e, category: "goal", automatic: false }, true));
    if (!extra.length) return plan;
    const next = { ...plan, events: [...plan.events, ...extra], author: llmLabel() };
    return rebuild(next, plan);
  } catch {
    return plan;
  }
}

/** The first thing Darwin says about the plan. */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function planIntro(plan: TrackingPlan): string {
  const added = [
    ...plan.events.filter((e) => e.fromPrompt).map((e) => e.label.toLowerCase()),
    ...plan.dashboards.filter((d) => d.kind === "devices").map((d) => `a ${d.title.toLowerCase()} dashboard`),
  ];
  const custom = plan.events.filter((e) => !e.automatic && e.enabled).length;
  const auto = plan.events.filter((e) => e.automatic && e.enabled).length;
  const read = !plan.repo
    ? plan.siteUrl
      ? `No GitHub needed: darwin.js goes on ${hostOf(plan.siteUrl)} with one script tag. `
      : ""
    : plan.repoRead === false
      ? `I couldn't read ${plan.repo} yet, so I assumed ${plan.framework ?? "a typical store"}. `
      : `I read ${plan.repo}${plan.framework ? ` (${plan.framework})` : ""}. `;
  const heard = plan.goals?.length || added.length ? `${plan.goals?.length ? `You mentioned ${list(plan.goals)}, so` : "From what you said,"} I added ${list(added)}. ` : "";
  const others = (plan.existingAnalytics ?? []).filter((a) => !a.startsWith("Darwin"));
  const already = (plan.existingAnalytics ?? []).some((a) => a.startsWith("Darwin")) ? "darwin.js is already installed, so the pull request only adds the plan. " : "";
  const alongside = others.length ? `You already use ${list(others)}: darwin.js runs alongside, nothing is replaced. ` : "";
  return `${read}${alongside}${already}${heard}Here's the plan: ${auto} things darwin.js records on its own, ${custom} events your store sends with one line each, and ${plan.dashboards.length} dashboards built from them. Turn anything off, or tell me what else to track.`;
}

/* ------------------------------------------------------------------ amend (chat) */

const toEventName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(when|whenever|every time|how many|how often|people|users|customers|shoppers|visitors|someone|they|the|a|an|on|of|clicks?|click|track|tracking|also|please|and|too|to)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

const titleize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The event a phrase refers to: exact label or name first, then the longest label it contains. */
function findEvent(plan: TrackingPlan, phrase: string): TrackingEvent | undefined {
  const p = phrase.toLowerCase().trim();
  const name = toEventName(phrase);
  const score = (e: TrackingEvent) => {
    const label = e.label.toLowerCase();
    if (label === p || e.name === name || e.name === p) return 100;
    if (label.includes(p)) return 50;
    if (p.includes(label)) return 10 + label.length;
    if (name && e.name.replace(/^\$/, "").includes(name)) return 5;
    return 0;
  };
  const best = plan.events.map((e) => ({ e, s: score(e) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s > 0 ? best.e : undefined;
}

/** A chat message → an edited plan and a one-line reply, without an LLM. */
export function heuristicAmend(plan: TrackingPlan, message: string): { plan: TrackingPlan; reply: string } {
  const m = message.trim();
  const off = m.match(/^(?:don'?t|do not|stop|no|remove|drop|skip|turn off)\s+(?:track(?:ing)?\s+)?(.+)$/i);
  const now = new Date().toISOString();
  if (off) {
    const hit = findEvent(plan, off[1]);
    if (!hit) return { plan, reply: `I'm not tracking anything like "${off[1]}" yet.` };
    const events = plan.events.map((e) => (e === hit ? { ...e, enabled: false } : e));
    const next = { ...plan, events, updatedAt: now };
    return { plan: rebuild(next, plan), reply: `Done: I won't record ${hit.label.toLowerCase()}.` };
  }
  const phrase = m.replace(/^(?:(?:can you|could you|please|also|and)\s+)*(?:track|record|measure|log|add|count|capture)\s+/i, "").replace(/[.!?]+$/, "");
  const existing = findEvent(plan, phrase);
  if (existing) {
    const events = plan.events.map((e) => (e === existing ? { ...e, enabled: true } : e));
    const next = { ...plan, events, updatedAt: now };
    return { plan: rebuild(next, plan), reply: `${existing.label} is in the plan${existing.enabled ? " already" : " again"}.` };
  }
  const name = toEventName(phrase);
  if (!name) return { plan, reply: `Tell me what to track, e.g. "also track wishlist adds".` };
  const ev = enable({ name, label: titleize(name), why: `You asked for it: "${phrase}".`, category: "goal", automatic: false, properties: [] }, true);
  const next = { ...plan, events: [...plan.events, ev], updatedAt: now };
  return {
    plan: rebuild(next, plan),
    reply: `Added ${name}. Your store sends it with one line: ${ev.snippet}`,
  };
}

const AmendSchema = z.object({
  reply: z.string().max(400),
  add: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), label: z.string().max(60), why: z.string().max(200), properties: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,30}$/)).max(6).default([]) })).max(5).default([]),
  disable: z.array(z.string()).max(10).default([]),
});

/** A chat message → an edited plan: the LLM when configured, else heuristicAmend. */
export async function amendPlan(plan: TrackingPlan, message: string): Promise<{ plan: TrackingPlan; reply: string }> {
  if (llmAvailable()) {
    try {
      const out = await generateJson({
        system:
          "You maintain an ecommerce analytics tracking plan. Given the current events and the merchant's message, return JSON {reply, add, disable}. " +
          "add: new custom events (snake_case names, a short label, why it matters for this store, up to 6 property names). disable: names of existing events to stop recording. " +
          "reply: one friendly sentence saying what changed. Never invent events the merchant didn't ask for.",
        prompt: `Store: ${plan.prompt ?? "(no description)"}\nCurrent events: ${plan.events.map((e) => `${e.name}${e.enabled ? "" : " (off)"}`).join(", ")}\nMerchant: ${JSON.stringify(message)}`,
        schema: AmendSchema,
        maxTokens: 800,
      });
      const now = new Date().toISOString();
      let events = plan.events.map((e) => (out.disable.includes(e.name) ? { ...e, enabled: false } : e));
      for (const a of out.add) {
        if (events.some((e) => e.name === a.name)) events = events.map((e) => (e.name === a.name ? { ...e, enabled: true } : e));
        else events.push(enable({ ...a, category: "goal", automatic: false }, true));
      }
      const next = { ...plan, events, author: llmLabel(), updatedAt: now };
      return { plan: rebuild(next, plan), reply: out.reply };
    } catch {
      /* fall through */
    }
  }
  return heuristicAmend(plan, message);
}

/** Apply the merchant's toggles (only `enabled` can change) and rebuild the dashboards. */
export function applyToggles(plan: TrackingPlan, enabled: Record<string, boolean>): TrackingPlan {
  const events = plan.events.map((e) => (e.name in enabled ? { ...e, enabled: !!enabled[e.name] } : e));
  const next = { ...plan, events, updatedAt: new Date().toISOString() };
  return rebuild(next, plan);
}

/* ------------------------------------------------------------------ for the install PR */

/** A few lines for the install PR body. */
export function trackingSummary(plan: TrackingPlan): string {
  const on = plan.events.filter((e) => e.enabled);
  const auto = on.filter((e) => e.automatic).map((e) => e.label.toLowerCase());
  const custom = on.filter((e) => !e.automatic).map((e) => `\`${e.name}\``);
  return [
    plan.prompt ? `You told Darwin: _${plan.prompt.replace(/\n/g, " ").slice(0, 300)}_` : "",
    `- **Automatic, no code:** ${auto.join(", ")}.`,
    custom.length ? `- **Your store sends (one line each):** ${custom.join(", ")}.` : "",
    `- **Dashboards Darwin builds:** ${plan.dashboards.map((d) => d.title).join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** DARWIN_TRACKING.md: the plan, committed with the install PR so the team can see (and review) what's recorded. */
export function trackingDoc(plan: TrackingPlan): string {
  const on = plan.events.filter((e) => e.enabled);
  const auto = on.filter((e) => e.automatic);
  const custom = on.filter((e) => !e.automatic);
  return `# What Darwin records

${plan.prompt ? `> ${plan.prompt.replace(/\n/g, " ")}\n\n` : ""}Site id: \`${plan.site}\`${plan.framework ? ` · ${plan.framework}` : ""}

## Automatic (no code)

${auto.map((e) => `- **${e.label}** (\`${e.name}\`): ${e.why}`).join("\n")}

## Events your store sends

Add each line where it happens (after darwin.js has loaded; calls made before it loads are queued).

| Event | When | Properties |
|---|---|---|
${custom.map((e) => `| \`${e.name}\` | ${e.label}. ${e.why} | ${(e.properties ?? []).map((p) => `\`${p}\``).join(", ") || "none"} |`).join("\n")}

\`\`\`js
${custom.map((e) => e.snippet).join("\n")}
\`\`\`

## Dashboards Darwin builds from this

${plan.dashboards.map((d) => `- **${d.title}**: ${d.why}`).join("\n")}

No personal data: darwin.js never reads form fields, and honours Global Privacy Control.
`;
}
