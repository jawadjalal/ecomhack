/**
 * "Ask Darwin about your shoppers": the Overview chat.
 *
 *   ask({ question, history })  → { answer, cards?, source }
 *
 * Builds a small, plain-number context from the public APIs of analytics, the optimizer, experiments and
 * agent commerce, then answers with the configured LLM. With no key (or on any LLM error) a heuristic
 * answers the obvious questions: conversion, agents vs people, best agent, the current test, the top
 * issue, what to do next, and why a named shopper left. Cards (inline result chips) always come from
 * the heuristic so the numbers shown are never invented by a model.
 */
import type { AgentSessionSummary, AnalyticsSummary, Experiment, LoopState } from "@/lib/contracts";
import { getAnalyticsSummary } from "@/lib/analytics/summary";
import { getLoopState, loopConfigFromEnv } from "@/lib/optimizer";
import { getExperiment } from "@/lib/experiments/store";
import { listAgentSessions } from "@/lib/agent-commerce";
import { generateText, llmAvailable } from "@/lib/llm/client";

/* ------------------------------------------------------------------ contract */

export interface AskCard {
  label: string;
  value: string;
}

export interface AskTurn {
  role: "user" | "darwin";
  text: string;
}

export interface AskRequest {
  question: string;
  history?: AskTurn[];
}

export interface AskResponse {
  answer: string;
  cards?: AskCard[];
  source: "llm" | "heuristic";
}

/* ------------------------------------------------------------------ context */

export interface AskSegment {
  shoppers: number;
  bought: number;
  rate: number;
}

export interface AskBrand extends AskSegment {
  name: string;
}

export interface AskTest {
  name: string;
  status: Experiment["status"];
  decision?: string;
  /** Whose conversion the decision is measured on. */
  audience: "all" | "human" | "agent";
  a: number;
  b: number;
  aShoppers: number;
  bShoppers: number;
  lift?: number;
  chance?: number;
  shipAt: number;
  agentsA?: number;
  agentsB?: number;
  peopleA?: number;
  peopleB?: number;
}

export interface AskIssue {
  n: number;
  title: string;
  stage: string;
  audience: string;
  detail: string;
  impact: number;
}

export interface AskContext {
  store: AskSegment;
  people: AskSegment;
  agents: AskSegment;
  /** Step-to-step rates, people vs agents: "Visit → view" … "Checkout → buy". */
  funnel: { step: string; people: number; agents: number }[];
  brands: AskBrand[];
  /** Recent agent sessions that left, with why (for "why did X leave?"). */
  leavers: { name: string; reason: string; brief?: string }[];
  test?: AskTest;
  issues: AskIssue[];
  phase: LoopState["phase"];
  generation: number;
  lastShipped?: string;
  autopilot: boolean;
  /** True when some or all of the numbers come from Darwin's simulated shoppers. */
  simulated: boolean;
}

const STEP_LABELS = ["Visit → view", "View → cart", "Cart → checkout", "Checkout → buy"];

/** Group agent names into the brands the console shows (Perplexity, ChatGPT, Claude, Gemini, Grok…). */
export function brandOf(agentName: string): string {
  const n = agentName.toLowerCase();
  if (/perplex/.test(n)) return "Perplexity";
  if (/chatgpt|openai|gpt|oai-/.test(n)) return "ChatGPT";
  if (/claude|anthropic/.test(n)) return "Claude";
  if (/gemini|google|bard/.test(n)) return "Gemini";
  if (/grok|xai/.test(n)) return "Grok";
  if (/copilot|bing|microsoft/.test(n)) return "Copilot";
  return agentName || "Other agent";
}

const seg = (k: { visitors: number; orders: number; conversionRate: number } | undefined): AskSegment => ({
  shoppers: k?.visitors ?? 0,
  bought: k?.orders ?? 0,
  rate: k?.conversionRate ?? 0,
});

/** Pure: everything the chat may cite, from the modules' public data. */
export function buildContext(input: {
  summary: AnalyticsSummary;
  loop: LoopState;
  experiment?: Experiment;
  sessions: AgentSessionSummary[];
  shipThreshold: number;
  realShoppers?: number;
}): AskContext {
  const { summary, loop, experiment, sessions, shipThreshold } = input;
  const byBrand = new Map<string, AskBrand>();
  for (const s of sessions) {
    if (s.outcome === "in_progress") continue;
    const name = brandOf(s.agentName);
    const b = byBrand.get(name) ?? { name, shoppers: 0, bought: 0, rate: 0 };
    b.shoppers += 1;
    if (s.outcome === "purchased") b.bought += 1;
    b.rate = b.bought / b.shoppers;
    byBrand.set(name, b);
  }
  const brands = [...byBrand.values()].sort((x, y) => y.rate - x.rate || y.shoppers - x.shoppers);

  const funnel = STEP_LABELS.map((step, i) => ({
    step,
    people: summary.byKind.human?.funnel[i + 1]?.rateFromPrevious ?? 0,
    agents: summary.byKind.agent?.funnel[i + 1]?.rateFromPrevious ?? 0,
  }));

  let test: AskTest | undefined;
  const r = experiment?.result;
  if (experiment && r) {
    const audience = r.audience ?? "all";
    const rate = (v: typeof r.control) => (audience === "all" ? v.conversionRate : v.byKind[audience]?.conversionRate ?? 0);
    const shoppers = (v: typeof r.control) => (audience === "all" ? v.visitors : v.byKind[audience]?.visitors ?? 0);
    test = {
      name: experiment.name,
      status: experiment.status,
      decision: r.decision,
      audience,
      a: rate(r.control),
      b: rate(r.treatment),
      aShoppers: shoppers(r.control),
      bShoppers: shoppers(r.treatment),
      lift: Number.isFinite(r.lift) ? r.lift : undefined,
      chance: r.probabilityToBeat,
      shipAt: shipThreshold,
      agentsA: r.control.byKind.agent?.conversionRate,
      agentsB: r.treatment.byKind.agent?.conversionRate,
      peopleA: r.control.byKind.human?.conversionRate,
      peopleB: r.treatment.byKind.human?.conversionRate,
    };
  }

  const issues = [...loop.insights]
    .map((i, idx) => ({ n: idx + 1, title: i.title, stage: i.stage, audience: i.audience, detail: i.detail, impact: i.impactScore }))
    .sort((x, y) => y.impact - x.impact);

  // Most recent leaver per agent name (sessions are newest first).
  const leavers: AskContext["leavers"] = [];
  for (const s of sessions) {
    if (s.outcome !== "abandoned" || !s.reason || leavers.some((l) => l.name === s.agentName)) continue;
    leavers.push({ name: s.agentName, reason: s.reason, brief: s.goal?.brief });
    if (leavers.length >= 12) break;
  }

  const shipped = [...loop.history].reverse().find((h) => h.generation > 0);
  return {
    store: seg(summary.overall),
    people: seg(summary.byKind.human),
    agents: seg(summary.byKind.agent),
    funnel,
    brands,
    leavers,
    test,
    issues,
    phase: loop.phase,
    generation: loop.generation,
    lastShipped: shipped?.label,
    autopilot: loop.autopilot,
    simulated: input.realShoppers === undefined ? true : input.realShoppers < summary.overall.visitors,
  };
}

/* ------------------------------------------------------------------ heuristic */

export const pctText = (x: number | undefined) => {
  if (x === undefined || !Number.isFinite(x)) return "–";
  const v = x * 100;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
};
const liftText = (x: number | undefined) =>
  x === undefined || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`;
const countText = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));
/** The ship bar with up to one decimal ("97.5%"). */
const barText = (x: number) => `${Math.round(x * 1000) / 10}%`;
const SIM_NOTE = " These are Darwin’s simulated shoppers.";
const whom = (a: AskTest["audience"]) => (a === "human" ? "people" : a === "agent" ? "agents" : "shoppers");

export type AskIntent = "leaver" | "test" | "next" | "issue" | "best-agent" | "versus" | "conversion" | "overview";

/** Which question is this? Order matters: specific intents first. */
export function intentOf(question: string, ctx?: Pick<AskContext, "leavers">): AskIntent {
  const q = question.toLowerCase();
  if (ctx?.leavers.some((l) => q.includes(l.name.toLowerCase())) && /why|leave|left|what happened|abandon/.test(q)) return "leaver";
  if (/\b(next|should|recommend|advice|priorit|focus|do now|todo|to do)\b/.test(q) && !/\btest b\b/.test(q)) return "next";
  if (/\b(test|experiment|a\/b|variant|ship|safe|winning|b\b)/.test(q)) return "test";
  if (/\b(issue|problem|leak|wrong|drop|losing|lose|friction|broken|why)\b/.test(q)) return "issue";
  if (/\b(which|best|top|worst)\b.*\b(agent|ai|bot|model|llm)s?\b|\b(agent|ai|model)s?\b.*\b(best|most|top)\b/.test(q)) return "best-agent";
  if (/(agents?|ai|bots?).*(people|humans?)|(people|humans?).*(agents?|ai|bots?)|\bvs\b|versus|compare/.test(q)) return "versus";
  if (/\b(convert|conversion|rate|buy|bought|orders?|sales|shoppers?|traffic|visitors?)\b/.test(q)) return "conversion";
  return "overview";
}

function testCards(t: AskTest): AskCard[] {
  return [
    { label: "A", value: pctText(t.a) },
    { label: "B", value: pctText(t.b) },
    { label: "Chance B wins", value: pctText(t.chance) },
  ];
}

function answerTest(ctx: AskContext): AskResponse {
  const t = ctx.test;
  if (!t) {
    return {
      source: "heuristic",
      answer:
        ctx.phase === "propose" || ctx.phase === "diagnose"
          ? "No test is running yet. Darwin is still working out the next change to try; it starts an A/B test as soon as a fix is ready."
          : "No test is running right now. Let Darwin run and it will pick the biggest issue, design a fix and test it against your current store.",
    };
  }
  const chance = t.chance ?? 0;
  const lift = t.lift ?? 0;
  const n = countText(t.aShoppers + t.bShoppers);
  const on = t.audience === "all" ? "" : ` (measured on ${whom(t.audience)}, the only shoppers this change can affect)`;
  let answer: string;
  if (t.status !== "running") {
    answer = `“${t.name}” has finished: ${t.decision === "ship" ? "B won and shipped" : t.decision === "reject" ? "B lost, so the store kept A" : "it was too close to call, so the store kept A"}. A converted ${pctText(t.a)} and B ${pctText(t.b)}${on}.`;
  } else if (chance >= t.shipAt) {
    answer = `Yes. B has a ${pctText(chance)} chance of beating A after ${n} ${whom(t.audience)}, past the ${barText(t.shipAt)} bar Darwin needs to ship. B converts ${pctText(t.b)} against ${pctText(t.a)} for A (${liftText(lift)})${on}.`;
  } else if (lift > 0 && chance >= 0.8) {
    answer = `Nearly. B has a ${pctText(chance)} chance of beating A after ${n} ${whom(t.audience)}: ${pctText(t.b)} against ${pctText(t.a)} (${liftText(lift)})${on}. Darwin ships at ${barText(t.shipAt)}, so I’d let it run another round.`;
  } else if (lift < 0 && chance <= 0.2) {
    answer = `Not yet, and probably not at all. B converts ${pctText(t.b)} against ${pctText(t.a)} for A (${liftText(lift)}), so B only has a ${pctText(chance)} chance of winning${on}. Darwin will likely keep A.`;
  } else {
    answer = `Too early to say. After ${n} ${whom(t.audience)}, B converts ${pctText(t.b)} and A ${pctText(t.a)} (${liftText(lift)}), a ${pctText(chance)} chance B wins${on}. Darwin needs ${barText(t.shipAt)} to ship.`;
  }
  if (t.agentsA !== undefined && t.agentsB !== undefined && t.audience !== "human" && Math.abs(t.agentsB - t.agentsA) >= 0.03) {
    answer += ` Agents buy at ${pctText(t.agentsB)} in B and ${pctText(t.agentsA)} in A.`;
  }
  return { source: "heuristic", answer, cards: testCards(t) };
}

function answerConversion(ctx: AskContext): AskResponse {
  const { store, people, agents } = ctx;
  if (!store.shoppers) {
    return { source: "heuristic", answer: "No shoppers yet. Turn on traffic or let Darwin run, and I’ll have numbers within a few seconds." };
  }
  let answer = `Your store converts ${pctText(store.rate)} of shoppers: ${countText(store.bought)} of ${countText(store.shoppers)} bought.`;
  if (people.shoppers && agents.shoppers) answer += ` People buy at ${pctText(people.rate)} and AI agents at ${pctText(agents.rate)}.`;
  if (ctx.test && ctx.test.status === "running" && (ctx.test.lift ?? 0) > 0) answer += ` If test B ships, ${whom(ctx.test.audience)} in B convert at ${pctText(ctx.test.b)}.`;
  return {
    source: "heuristic",
    answer,
    cards: [
      { label: "Converts", value: pctText(store.rate) },
      { label: "Shoppers", value: countText(store.shoppers) },
      { label: "Bought", value: countText(store.bought) },
    ],
  };
}

function answerVersus(ctx: AskContext): AskResponse {
  const { people, agents } = ctx;
  if (!people.shoppers || !agents.shoppers) {
    return { source: "heuristic", answer: `I’ve only seen ${people.shoppers ? "people" : agents.shoppers ? "agents" : "nobody"} so far, so there’s nothing to compare yet.` };
  }
  const gap = [...ctx.funnel].sort((x, y) => Math.abs(y.agents - y.people) - Math.abs(x.agents - x.people))[0];
  const ratio = people.rate > 0 ? agents.rate / people.rate : undefined;
  let answer = `AI agents buy at ${pctText(agents.rate)} and people at ${pctText(people.rate)}${ratio && ratio >= 1.5 ? `, about ${Math.round(ratio)}× better` : ""}.`;
  if (gap) answer += ` The biggest difference is ${gap.step.toLowerCase()}: ${pctText(gap.people)} of people move on against ${pctText(gap.agents)} of agents.`;
  return {
    source: "heuristic",
    answer,
    cards: [
      { label: "People buy", value: pctText(people.rate) },
      { label: "Agents buy", value: pctText(agents.rate) },
      ...(gap ? [{ label: gap.step, value: `${pctText(gap.people)} vs ${pctText(gap.agents)}` }] : []),
    ],
  };
}

function answerBestAgent(ctx: AskContext): AskResponse {
  const ranked = ctx.brands.filter((b) => b.shoppers >= 2);
  if (!ranked.length) return { source: "heuristic", answer: "No AI shoppers have finished a visit yet. Once a few have, I’ll rank them by how often they buy." };
  const best = ranked[0];
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  let answer = `${best.name} buys most often: ${best.bought} of its last ${best.shoppers} visits ended in an order (${pctText(best.rate)}).`;
  if (worst && worst.name !== best.name) answer += ` ${worst.name} buys least, at ${pctText(worst.rate)}.`;
  const why = ctx.leavers[0];
  if (why) answer += ` The most recent agent that left said: “${why.reason}”.`;
  return { source: "heuristic", answer, cards: ranked.slice(0, 3).map((b) => ({ label: b.name, value: pctText(b.rate) })) };
}

function answerIssue(ctx: AskContext): AskResponse {
  const top = ctx.issues[0];
  if (!top) {
    return {
      source: "heuristic",
      answer: ctx.phase === "idle" || ctx.phase === "observe" ? "Darwin hasn’t found any issues yet: it’s still watching shoppers. Give it a moment." : "No open issues right now.",
    };
  }
  const next = ctx.issues[1];
  let answer = `The biggest leak is issue ${top.n}: ${top.title}. It costs about ${Math.round(top.impact * 10) / 10} orders per 1,000 visits at the ${top.stage.replace(/^agent:\s*/, "agent ")} step.`;
  if (next) answer += ` Next is issue ${next.n}: ${next.title}.`;
  return {
    source: "heuristic",
    answer,
    cards: [
      { label: `Issue ${top.n}`, value: `−${Math.round(top.impact * 10) / 10} per 1,000` },
      ...(next ? [{ label: `Issue ${next.n}`, value: `−${Math.round(next.impact * 10) / 10} per 1,000` }] : []),
    ],
  };
}

function answerNext(ctx: AskContext): AskResponse {
  const t = ctx.test;
  const top = ctx.issues[0];
  if (t && t.status === "running") {
    const chance = t.chance ?? 0;
    if (chance >= t.shipAt) return { ...answerTest(ctx), answer: `Ship B. ${answerTest(ctx).answer}` };
    if ((t.lift ?? 0) < 0 && chance <= 0.2) {
      return {
        source: "heuristic",
        answer: `Let test “${t.name}” finish: B is behind (${liftText(t.lift)}) and Darwin will drop it on its own.${top ? ` After that, the biggest open leak is issue ${top.n}: ${top.title}.` : ""}`,
        cards: testCards(t),
      };
    }
    return {
      source: "heuristic",
      answer: `Keep test “${t.name}” running: B has a ${pctText(chance)} chance of winning and Darwin needs ${barText(t.shipAt)}.${top ? ` Next in line is issue ${top.n}: ${top.title}.` : ""}`,
      cards: testCards(t),
    };
  }
  if (top) {
    return {
      source: "heuristic",
      answer: `Fix issue ${top.n} next: ${top.title}. ${ctx.autopilot ? "Darwin is already on it and will test a fix." : "Let Darwin run and it will design a fix and A/B test it."}`,
      cards: [{ label: `Issue ${top.n}`, value: `−${Math.round(top.impact * 10) / 10} per 1,000` }],
    };
  }
  return { source: "heuristic", answer: "Let Darwin keep watching shoppers. It needs a bit more traffic before it can point at the next fix." };
}

function answerLeaver(question: string, ctx: AskContext): AskResponse {
  const q = question.toLowerCase();
  const l = ctx.leavers.find((x) => q.includes(x.name.toLowerCase()));
  if (!l) return answerIssue(ctx);
  const issue = ctx.issues.find((i) => i.audience !== "human" && keywords(i.title).some((k) => l.reason.toLowerCase().includes(k)));
  return {
    source: "heuristic",
    answer: `${l.name}${l.brief ? ` wanted “${l.brief}”. It` : ""} left because ${l.reason.replace(/\.$/, "")}.${issue ? ` That’s issue ${issue.n}: ${issue.title}.` : ""}`,
    cards: issue ? [{ label: `Issue ${issue.n}`, value: `−${Math.round(issue.impact * 10) / 10} per 1,000` }] : undefined,
  };
}

/** Words that tie a leaver's reason to an issue title. */
function keywords(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (/deliver|eta/.test(t)) out.push("delivery");
  if (/return/.test(t)) out.push("return");
  if (/landed|shipping|total/.test(t)) out.push("shipping", "landed", "total");
  if (/negotiat/.test(t)) out.push("negotiat");
  if (/stock|size/.test(t)) out.push("stock", "size");
  return out;
}

function answerOverview(ctx: AskContext): AskResponse {
  const conv = answerConversion(ctx);
  const parts = [conv.answer];
  if (ctx.test?.status === "running") parts.push(`Test “${ctx.test.name}” is running: B has a ${pctText(ctx.test.chance)} chance of winning.`);
  else if (ctx.issues[0]) parts.push(`The biggest leak is issue ${ctx.issues[0].n}: ${ctx.issues[0].title}.`);
  parts.push("Ask me about agents vs people, the best agent, the current test or what to do next.");
  return { source: "heuristic", answer: parts.join(" "), cards: conv.cards };
}

const CITES_COUNTS: AskIntent[] = ["test", "conversion", "versus", "best-agent", "overview"];

/** Pure: answer from the context alone. Says once when the numbers come from simulated shoppers. */
export function heuristicAnswer(question: string, ctx: AskContext): AskResponse {
  const intent = intentOf(question, ctx);
  const res = answerFor(intent, question, ctx);
  if (ctx.simulated && res.cards?.length && CITES_COUNTS.includes(intent)) return { ...res, answer: res.answer + SIM_NOTE };
  return res;
}

function answerFor(intent: AskIntent, question: string, ctx: AskContext): AskResponse {
  switch (intent) {
    case "leaver":
      return answerLeaver(question, ctx);
    case "test":
      return answerTest(ctx);
    case "next":
      return answerNext(ctx);
    case "issue":
      return answerIssue(ctx);
    case "best-agent":
      return answerBestAgent(ctx);
    case "versus":
      return answerVersus(ctx);
    case "conversion":
      return answerConversion(ctx);
    default:
      return answerOverview(ctx);
  }
}

/* ------------------------------------------------------------------ llm */

const SYSTEM = `You are Darwin, an assistant that watches a running-shoe store's human and AI-agent shoppers, finds where they drop off, A/B tests fixes and ships winners as pull requests.
Answer the merchant's question in plain, friendly English: 1 to 3 short sentences, no headings, no bullet lists, no markdown.
Use ONLY numbers from the JSON context. Never invent numbers. If the context can't answer, say what Darwin would need.
Rates are fractions (0.052 = 5.2%). "simulated": true means the shoppers are Darwin's simulated traffic: mention it once when you cite counts.
In tests, A is the current store and B is the change. Darwin ships B only when "chance" reaches "shipAt".`;

function contextForPrompt(ctx: AskContext) {
  const r = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 1000) / 1000);
  return {
    ...ctx,
    store: { ...ctx.store, rate: r(ctx.store.rate) },
    people: { ...ctx.people, rate: r(ctx.people.rate) },
    agents: { ...ctx.agents, rate: r(ctx.agents.rate) },
    funnel: ctx.funnel.map((f) => ({ step: f.step, people: r(f.people), agents: r(f.agents) })),
    brands: ctx.brands.slice(0, 6).map((b) => ({ ...b, rate: r(b.rate) })),
    leavers: ctx.leavers.slice(0, 6),
    issues: ctx.issues.slice(0, 6).map((i) => ({ ...i, impact: Math.round(i.impact * 10) / 10 })),
  };
}

export async function answerWithLlm(req: AskRequest, ctx: AskContext): Promise<string> {
  const history = (req.history ?? [])
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Merchant" : "Darwin"}: ${t.text.slice(0, 600)}`)
    .join("\n");
  const prompt = `Context (JSON):\n${JSON.stringify(contextForPrompt(ctx))}\n\n${history ? `Conversation so far:\n${history}\n\n` : ""}Merchant: ${req.question}\nDarwin:`;
  const text = await generateText({ system: SYSTEM, prompt, maxTokens: 400 });
  return text.replace(/^\s*Darwin:\s*/i, "").replace(/\*\*/g, "").trim();
}

/* ------------------------------------------------------------------ entry point */

export function currentContext(): AskContext {
  const loop = getLoopState();
  const summary = getAnalyticsSummary();
  const realShoppers = getAnalyticsSummary({ includeSynthetic: false }).overall.visitors;
  const experiment = loop.experimentId ? getExperiment(loop.experimentId) : undefined;
  return buildContext({
    summary,
    loop,
    experiment,
    sessions: listAgentSessions(120),
    shipThreshold: loopConfigFromEnv().shipThreshold,
    realShoppers,
  });
}

export async function ask(req: AskRequest, ctx: AskContext = currentContext()): Promise<AskResponse> {
  const fallback = heuristicAnswer(req.question, ctx);
  if (!llmAvailable()) return fallback;
  try {
    const answer = await answerWithLlm(req, ctx);
    if (!answer) return fallback;
    return { answer, cards: fallback.cards, source: "llm" };
  } catch (err) {
    console.warn("[ask] LLM failed, answering with the heuristic:", String(err).slice(0, 200));
    return fallback;
  }
}
