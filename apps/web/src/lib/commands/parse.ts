/**
 * Deterministic natural-language → plan parser: the fallback when no LLM is configured (and the offline
 * fallback in the browser). Regexes for the common phrasings; anything else becomes a question for Darwin.
 *
 *   parseCommand("send 200 shoppers then step the loop") →
 *     { steps: [{ simulate_traffic { humans: 200, agents: 0 } }, { step_loop { times: 1 } }], say, source: "heuristic" }
 *
 * Pure: no I/O. Every step it returns is validated against the registry's zod schemas.
 */
import { roadmapFor, roadmapSearch } from "@/lib/status/roadmap";
import { MAX_SIM_AGENTS, MAX_SIM_HUMANS, pageOf, sayFor, validateStep, type AgentLever, type PageKey } from "./specs";
import type { CommandName, CommandSites, PlanStep } from "./types";

export interface ParseContext {
  /** Current page path + search, e.g. "/console/dashboards?site=trail-shop-co-uk". */
  page?: string;
  sites?: Partial<CommandSites>;
}

export interface ParsedPlan {
  steps: PlanStep[];
  say: string;
  source: "heuristic";
}

/* ------------------------------------------------------------------ helpers */

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20,
  fifty: 50,
  hundred: 100,
  "a hundred": 100,
  "one hundred": 100,
  "a thousand": 1000,
  "one thousand": 1000,
};
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?\s*k?|a hundred|one hundred|a thousand|one thousand|twenty|fifty|ten|five|two|three)`;

function toNumber(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s in WORD_NUMBERS) return WORD_NUMBERS[s];
  const k = /k$/.test(s);
  const n = Number(s.replace(/k$/, "").replace(/,/g, "").trim());
  return Math.round(k ? n * 1000 : n);
}

const ORDINALS: Record<string, number> = { first: 1, top: 1, biggest: 1, worst: 1, main: 1, largest: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

/** Strip greetings and politeness: "hey darwin, can you please step the loop." → "step the loop". */
function clean(s: string): string {
  let t = s.trim();
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/^(?:ok(?:ay)?|hey|hi|yo|so)\b[\s,!:]*/i, "")
      .replace(/^darwin\b[\s,!:]*/i, "")
      .replace(/^(?:please|pls|can you|could you|would you|will you|i want you to|i'd like you to|i want to|i'd like to|let's|lets)\s+/i, "")
      .replace(/^please\s+/i, "")
      .trim();
  }
  return t.replace(/[.!]+$/, "").trim();
}

const QUESTION = /^(why|what|how|which|who|when|where|is|are|do|does|did|should|can i|could i|will|would)\b|\?$/i;

/** "Trail-Shop.co.uk" → "trail-shop-co-uk" (the onboarding site id rule). */
export function siteSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Match loose words to a known site: exact, then slug, then prefix/contains. */
export function resolveSite(raw: string | undefined, known: string[] = []): string | undefined {
  if (!raw) return undefined;
  const r = raw.trim();
  if (known.includes(r)) return r;
  const slug = siteSlug(r);
  if (!slug) return undefined;
  const hit =
    known.find((k) => k === slug) ??
    known.find((k) => k.startsWith(slug) || slug.startsWith(k)) ??
    known.find((k) => k.includes(slug) || slug.includes(k));
  return hit ?? slug;
}

function siteFromPage(page: string | undefined): string | undefined {
  if (!page) return undefined;
  const q = page.split("?")[1];
  if (!q) return undefined;
  const site = new URLSearchParams(q).get("site") ?? undefined;
  return site && /^[\w.-]{1,64}$/.test(site) ? site : undefined;
}

/** A word that names a site: a known one (fuzzy), or anything shaped like a site id ("north-trail", "shop.com"). */
function asSite(word: string, known: string[]): string | undefined {
  const slug = siteSlug(word);
  if (!slug) return undefined;
  const hit = known.find((k) => k === slug || k.startsWith(slug) || (slug.length > 3 && slug.startsWith(k)));
  if (hit) return hit;
  return /[-.]/.test(word) ? slug : undefined;
}

/** A trailing "…for trail-shop" / "on north-trail store": the site words and the text before them. */
function splitSite(text: string, known: string[]): { rest: string; site?: string } {
  const m = /^(.*?)[\s,]+(?:for|on|in|at|from)\s+(?:the\s+)?([a-z0-9][\w.-]*)(?:\s+(?:site|store|shop|website))?\s*$/i.exec(text);
  if (m) {
    const site = asSite(m[2], known);
    if (site) return { rest: m[1].trim(), site };
  }
  return { rest: text };
}

/* ------------------------------------------------------------------ rules */

type Rule = (clause: string, ctx: ParseContext & { question: boolean }) => { command: CommandName; input: Record<string, unknown> } | null;

const PAGE_WORDS: [RegExp, PageKey][] = [
  [/^(?:overview|home|console|mission control|start page)$/i, "overview"],
  [/^(?:issues?|problems?|leaks?)$/i, "issues"],
  [/^(?:fix(?:es)?|proposals?)$/i, "fixes"],
  [/^(?:experiments?|tests?|a\/b tests?)$/i, "experiments"],
  [/^(?:changes|shipped changes|history|generations?|pull requests|prs)$/i, "changes"],
  [/^(?:settings|preferences|config(?:uration)?)$/i, "settings"],
  [/^(?:store agent|agents?|agent page|a2a)$/i, "agents"],
  [/^(?:dashboards?|charts?)$/i, "dashboards"],
  [/^(?:personali[sz]e|personali[sz]ation)$/i, "personalize"],
  [/^(?:traffic|traffic sources|sources)$/i, "traffic"],
  [/^(?:onboarding|set ?up(?: a store)?|connect a store)$/i, "onboarding"],
  [/^(?:readiness|agent readiness)$/i, "readiness"],
];

const navigate: Rule = (c, ctx) => {
  const m = /^(?:(?:go|navigate|jump|switch|head|take me|bring me|move)(?: over| back)? to|open(?: up)?|show(?: me)?|view|see|visit|bring up)?\s*(?:the\s+|my\s+)?(.+?)(?:\s+(?:page|tab|screen|view))?(?:\s+(?:for|on|of)\s+([\w.-]+))?$/i.exec(c);
  if (!m) return null;
  const page = PAGE_WORDS.find(([re]) => re.test(m[1].trim()))?.[1];
  if (!page) return null;
  const site = m[2] ? resolveSite(m[2], page === "personalize" ? ctx.sites?.web : ctx.sites?.tracking) : undefined;
  return { command: "navigate", input: { page, ...(site ? { site } : {}) } };
};

const rollback: Rule = (c) => {
  const m =
    /\b(?:roll(?:\s|-)?back|revert|go back|restore|undo)\b.*?\b(?:gen(?:eration)?|version|v)\.?\s*#?\s*(\d+)\b/i.exec(c) ??
    /\b(?:roll(?:\s|-)?back|revert)\s+to\s+#?(\d+)\b/i.exec(c);
  return m ? { command: "rollback", input: { generation: Number(m[1]) } } : null;
};

const startDemo: Rule = (c) =>
  /\b(?:watch (?:darwin|it) (?:improve|work on|optimi[sz]e)|(?:start|run|launch|begin|try|play)\s+(?:the\s+)?demo(?:\s+(?:store|mode))?|demo mode|explore (?:with )?the demo store|show me how (?:it|darwin) works)\b/i.test(c)
    ? { command: "start_demo", input: {} }
    : null;

const watchFix: Rule = (c) => (/\bwatch\s+(?:darwin\s+|it\s+)?(?:fix|fixing|repair)\b|\bwatch\s+(?:the|a)\s+fix\b/i.test(c) ? { command: "watch_fix", input: {} } : null);

const URL_RE = /\b(https?:\/\/[^\s,;]+|(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;]*)?)/i;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/;
const urlIn = (c: string) => URL_RE.exec(c.replace(EMAIL_RE, " "))?.[1]?.replace(/[?.!]+$/, "");

const checkInstall: Rule = (c) => {
  const hit =
    /\b(?:test|check|verify|confirm)\s+(?:my\s+|the\s+)?(?:install(?:ation)?|darwin\.?js|tag|snippet|script)\b/i.test(c) ||
    /\b(?:is|did)\s+(?:darwin(?:\.?js)?|the (?:tag|snippet|script))\s+(?:installed|working|live|set up)\b/i.test(c) ||
    /\bdid (?:the|my) install work\b/i.test(c);
  if (!hit) return null;
  const url = urlIn(c.replace(/\bdarwin\.js\b/gi, " "));
  return { command: "check_install", input: url ? { url } : {} };
};

const saveSetup: Rule = (c, ctx) => {
  if (!/\b(?:save|keep|remember)\s+(?:my\s+|the\s+)?(?:setup|set-up|progress|account|store|work)\b/i.test(c)) return null;
  const email = EMAIL_RE.exec(c)?.[0];
  const { site } = splitSite(c.replace(EMAIL_RE, " ").replace(/\s+(?:as|under|with|to)\s*$/i, "").trim(), ctx.sites?.tracking ?? []);
  return { command: "save_setup", input: { ...(email ? { email } : {}), ...(site ? { site } : {}) } };
};

const whichStore: Rule = (c) =>
  /\b(?:which|what)\s+(?:store|site|shop)\b(?!.*\bplatform\b)|\bis (?:this|it) (?:the demo(?: store)?|my (?:store|site|shop)|real)\b|\bam i (?:on|looking at) (?:the demo|my (?:store|site))\b/i.test(c)
    ? { command: "which_store", input: {} }
    : null;

const detectPlatform: Rule = (c) => {
  const hit =
    /\b(?:detect|identify|check)\s+(?:the\s+)?platform\b|\b(?:what|which)\s+platform\b|\bwhat (?:is|does)\s+\S+\s+(?:run|built|made)\s+(?:on|with)\b|\b(?:is|runs?)\s+\S+\s+(?:on\s+)?(?:shopify|webflow|wordpress|squarespace|wix|bigcommerce)\b/i.test(c);
  if (!hit) return null;
  const url = urlIn(c);
  return url ? { command: "detect_platform", input: { url } } : null;
};

const research: Rule = (c) => {
  if (!/\bcompetit(?:or|ors|ion|ive)\b/i.test(c)) return null;
  if (!/\b(?:research|analy[sz]e|look (?:at|into)|find|who are|study|scan|compare|check (?:out)?)\b/i.test(c)) return null;
  const m = /\bcompetit\w*\s+(?:for|in|of|selling|on|around|about)\s+(.{2,})$/i.exec(c);
  const query = (m?.[1] ?? c).trim().slice(0, 500);
  return { command: "research_competitors", input: { query } };
};

const whatsLeft: Rule = (c, ctx) => {
  const hit =
    /\b(?:what'?s|what is|what are|anything|is there anything)\b.*\b(?:left|remaining|missing|still to do|to do|todo|unfinished|planned)\b/i.test(c) ||
    /\b(?:roadmap|to-?do list|left to do|what'?s next (?:for|on|in)|limitations of|next ideas)\b/i.test(c);
  if (!hit) return null;
  const onThisPage = /\b(?:this page|this screen|here)\b/i.test(c);
  const named = onThisPage ? undefined : roadmapSearch(c.replace(/\b(?:what'?s|left|to do|todo|next|on|for|in|the|is|there|anything|still)\b/gi, " "));
  const area = named ?? (ctx.page ? roadmapFor(ctx.page) : undefined);
  return { command: "whats_left", input: area ? { area: area.key } : {} };
};

const OFF = /\b(?:off|pause|paused|stop|disable|halt|kill|turn off|switch off)\b/i;

const agentAutopilot: Rule = (c) => {
  if (!/\bautopilot\b/i.test(c)) return null;
  if (!/\b(?:store[\s-]?agent|agent'?s|pitch|a2a|the agent)\b/i.test(c)) return null;
  return { command: "set_agent_autopilot", input: { on: !OFF.test(c) } };
};

const autopilot: Rule = (c, ctx) => {
  if (ctx.question) return null;
  if (/\bautopilot\b/i.test(c)) return { command: "set_autopilot", input: { on: !OFF.test(c) } };
  if (/^(?:let darwin (?:run|drive|work|take over|loose)|run on (?:its|your) own|keep going)$/i.test(c)) return { command: "set_autopilot", input: { on: true } };
  if (/^(?:pause|stop|halt) darwin$/i.test(c)) return { command: "set_autopilot", input: { on: false } };
  if (/^(?:resume|start|unpause) darwin$/i.test(c)) return { command: "set_autopilot", input: { on: true } };
  return null;
};

const actOnBriefing: Rule = (c, ctx) => {
  if (ctx.question) return null;
  if (/^(?:yes[,!.]?\s*)?ship\s+(?:it|that|this|the (?:winner|winning (?:test|change|variant)|test|change|headline|banner))\b/i.test(c) || /^(?:yes[,!.]?\s*)?ship it$/i.test(c)) {
    return { command: "act_on_briefing", input: { action: "ship" } };
  }
  if (/^(?:stop|end|kill|cancel)\s+(?:the|that|this)\s+(?:test|experiment)$/i.test(c)) return { command: "act_on_briefing", input: { action: "stop" } };
  return null;
};

const DEFAULT_BRIEF = "Trail shoes, UK 10, under £140, delivered by Friday";

const sendShopper: Rule = (c, ctx) => {
  if (ctx.question) return null;
  const m = /\bsend\s+(?:an?|one|a single|1)\s+(?:ai\s+|buyer\s+|test\s+|simulated\s+|shopping\s+)*(?:shopper|agent|buyer|bot|customer)\b\s*(.*)$/i.exec(c);
  if (!m) return null;
  let rest = m[1];
  const a2a = /\b(?:over|via|using|through|with)\s+a2a\b/i.test(rest) || /\ba2a\b/i.test(rest);
  rest = rest
    .replace(/\b(?:over|via|using|through|with)\s+(?:a2a|the tools?|mcp)\b/gi, " ")
    .replace(/^\s*(?:to|who|that|with (?:the )?brief|with|:|—|-)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const brief = rest.length >= 3 ? rest : DEFAULT_BRIEF;
  return { command: "send_shopper", input: { brief, via: a2a ? "a2a" : "tools" } };
};

const LEVER_WORDS: [RegExp, AgentLever][] = [
  [/\bfacts?(?: up front)?\b/i, "facts"],
  [/\b(?:one|single|best)[\s-]+(?:best\s+)?pick\b|\bone recommendation\b/i, "one-pick"],
  [/\bstructured\b|\bbuy instructions\b/i, "structured"],
  [/\bupsell|\byearly(?: plan)?\b/i, "upsell"],
];

const agentTest: Rule = (c, ctx) => {
  if (ctx.question) return null;
  if (!/\b(?:test|try|a\/b|experiment with|start)\b/i.test(c)) return null;
  const lever = LEVER_WORDS.find(([re]) => re.test(c))?.[1];
  if (!lever) return null;
  if (lever === "facts" && !/\b(?:agent|pitch|lever)\b/i.test(c)) return null;
  const b = new RegExp(`${NUM}\\s*(?:simulated\\s+)?(?:buyers?|buyer agents?|conversations?)\\b`, "i").exec(c);
  const buyers = b ? Math.min(500, Math.max(1, toNumber(b[1]))) : undefined;
  return { command: "start_agent_test", input: { lever, ...(buyers ? { buyers } : {}) } };
};

const step: Rule = (c, ctx) => {
  if (ctx.question) return null;
  const hit =
    /^(?:step|advance|tick|nudge)\b/i.test(c) ||
    /\b(?:step|advance|move)\s+(?:the\s+)?(?:loop|darwin)\b/i.test(c) ||
    /^(?:next (?:step|phase)|run (?:the )?(?:loop|next phase|one (?:step|phase|round)))\b/i.test(c);
  if (!hit) return null;
  const t = /(\d+)\s*(?:times|x|steps|phases)\b/i.exec(c);
  const times = t ? Number(t[1]) : /\btwice\b/i.test(c) ? 2 : /\bthree times\b/i.test(c) ? 3 : 1;
  return { command: "step_loop", input: { times: Math.min(10, Math.max(1, times)) } };
};

const simulate: Rule = (c, ctx) => {
  if (ctx.question) return null;
  const verb = /\b(?:simulate|send|add|generate|fire|push|throw|drive|bring|spawn|pump|run)\b/i.test(c);
  if (!verb) return null;
  const agentRe = new RegExp(`${NUM}\\s+(?:more\\s+)?(?:simulated\\s+|synthetic\\s+|fake\\s+|test\\s+)?(?:ai\\s+(?:shopping\\s+)?(?:agents?|shoppers?|bots?|buyers?)|(?:shopping\\s+)?agents?|bots?)\\b`, "i");
  const a = agentRe.exec(c);
  const rest = a ? c.replace(a[0], " ") : c;
  const humanRe = new RegExp(`${NUM}\\s+(?:more\\s+)?(?:simulated\\s+|synthetic\\s+|fake\\s+|test\\s+)?(?:human\\s+)?(?:shoppers?|people|persons|visitors?|humans?|users?|customers?|visits?|sessions?)\\b`, "i");
  const h = humanRe.exec(rest);
  if (!a && !h) {
    if (/\b(?:simulate|simulated)\b.*\b(?:traffic|shoppers|visitors|people)\b|\b(?:send|add|generate|run)\s+(?:some\s+)?(?:simulated\s+)?(?:traffic|shoppers)\b/i.test(c)) {
      return { command: "simulate_traffic", input: {} };
    }
    return null;
  }
  const humans = h ? Math.min(MAX_SIM_HUMANS, toNumber(h[1])) : 0;
  const agents = a ? Math.min(MAX_SIM_AGENTS, toNumber(a[1])) : 0;
  return { command: "simulate_traffic", input: { humans, agents } };
};

const dashboard: Rule = (c, ctx) => {
  if (ctx.question && !/^(?:can i|could i)\b/i.test(c)) return null;
  const chartWord = /\b(?:dashboards?|charts?|graphs?|plots?|visuali[sz]e|visuali[sz]ation)\b/i;
  const leadVerb = /^(?:chart|plot|graph|visuali[sz]e|track)\b/i.test(c);
  if (!chartWord.test(c) && !leadVerb) return null;
  if (!leadVerb && !/\b(?:build|make|create|add|show|give|draw|plot|chart|graph|want|need|new|get|set up)\b/i.test(c)) return null;
  const known = ctx.sites?.tracking ?? [];
  const { rest, site: named } = splitSite(c, known);
  let request = rest;
  for (let i = 0; i < 3; i++) {
    request = request
      .replace(/^(?:can i|could i|i want|i'd like|i need|please)\s+(?:to\s+)?(?:see|have|get)?\s*/i, "")
      .replace(/^(?:build|make|create|add|show(?:\s+me)?|give\s+me|draw|plot|chart|graph|visuali[sz]e|track|get\s+me|set\s+up)\s+/i, "")
      .replace(/^(?:me\s+)?(?:a|an|the|another|new|one)\s+/i, "")
      .replace(/^(?:new\s+)?(?:dashboards?|charts?|graphs?|plots?|visuali[sz]ations?)\b\s*/i, "")
      .replace(/^(?:of|for|with|showing|that shows|about|on|tracking|to track|to show)\s+/i, "")
      .trim();
  }
  const site = named ?? siteFromPage(ctx.page) ?? (known.length === 1 ? known[0] : undefined);
  if (request.length < 2) return { command: "navigate", input: { page: "dashboards", ...(site ? { site } : {}) } };
  return { command: "build_dashboard", input: { request, ...(site ? { site } : {}) } };
};

const personalize: Rule = (c, ctx) => {
  if (ctx.question) return null;
  const hit =
    /\bpersonali[sz]/i.test(c) ||
    /\b(?:for|to)\s+(?:visitors|people|shoppers|traffic|users)\s+(?:from|coming from|who come from|arriving from|searching)\b/i.test(c) ||
    /\b(?:show|add|put)\b.*\bbanner\b/i.test(c);
  if (!hit) return null;
  const known = ctx.sites?.web ?? [];
  let site: string | undefined;
  let prompt = c.replace(/^(?:draft\s+)?(?:a\s+)?personali[sz](?:e|ation)\b\s*(?:to\s+)?/i, "");
  // "personalize north-trail: …" / "draft a personalization for north-trail: …"
  const head = /^(?:(?:for|on)\s+)?([\w.-]+)\s*[:,—]\s*(.+)$/i.exec(prompt);
  const headSite = head ? asSite(head[1], known) : undefined;
  if (head && headSite) {
    site = headSite;
    prompt = head[2];
  } else {
    prompt = prompt.replace(/^[:,—-]\s*/, "");
    const m = /\s+(?:on|for|at)\s+([a-z0-9][\w.-]*)(?:\s+(?:site|store|shop))?\s*$/i.exec(prompt);
    const tail = m ? asSite(m[1], known) : undefined;
    if (m && tail) {
      site = tail;
      prompt = prompt.slice(0, m.index);
    }
  }
  site ??= siteFromPage(ctx.page) ?? (known.length === 1 ? known[0] : undefined);
  prompt = prompt.trim();
  if (prompt.length < 3) return { command: "navigate", input: { page: "personalize", ...(site ? { site } : {}) } };
  return { command: "draft_personalization", input: { prompt, ...(site ? { site } : {}) } };
};

const openIssue: Rule = (c, ctx) => {
  if (ctx.question) return null;
  const id = /\bissue\s+(ins_[\w-]+)\b/i.exec(c);
  if (id) return { command: "open_issue", input: { id: id[1] } };
  const n = /\bissue\s*(?:#|number|no\.?)?\s*(\d+)\b/i.exec(c) ?? /#(\d+)\s+issue\b/i.exec(c);
  if (n) return { command: "open_issue", input: { rank: Number(n[1]) } };
  const o = /\b(first|top|biggest|worst|main|largest|second|third|fourth|fifth)\b(?:\s+\w+)?\s+(?:issue|problem|leak)\b/i.exec(c);
  if (o) return { command: "open_issue", input: { rank: ORDINALS[o[1].toLowerCase()] } };
  return null;
};

const briefing: Rule = (c) =>
  /\b(?:brief(?:ing)?|catch me up|status update|daily update|morning update|digest|sitrep|what happened(?: today)?)\b/i.test(c) ? { command: "briefing", input: {} } : null;

const RULES: Rule[] = [navigate, rollback, startDemo, watchFix, checkInstall, saveSetup, detectPlatform, whichStore, research, whatsLeft, agentAutopilot, autopilot, actOnBriefing, sendShopper, agentTest, step, simulate, dashboard, personalize, openIssue, briefing];

/** One clause → one validated step, or null when no rule matches. */
function parseClause(raw: string, ctx: ParseContext): PlanStep | null {
  const clause = clean(raw);
  if (!clause) return null;
  const question = QUESTION.test(clause);
  for (const rule of RULES) {
    const hit = rule(clause, { ...ctx, question });
    if (!hit) continue;
    const v = validateStep(hit.command, hit.input);
    if (v.ok) return v.step;
  }
  return null;
}

function askStep(text: string): PlanStep | null {
  const v = validateStep("ask_darwin", { question: text.trim().slice(0, 500) });
  return v.ok ? v.step : null;
}

const VERBS =
  /^(?:go|open|show|take|navigate|jump|switch|view|see|send|simulate|add|generate|run|step|advance|turn|enable|disable|start|stop|pause|resume|let|put|build|make|create|chart|plot|draft|personali[sz]e|roll|rollback|revert|restore|ask|tell|explain|ship|brief|give|test|try|what|why|how|watch|check|verify|save|detect|research|which)\b/i;

/** Split on "then", ";", "after that" and sentence breaks. */
const STRONG = /\s*(?:;|\.\s+(?=[a-z])|,?\s+and\s+then\s+|,?\s+then\s+|,?\s+after that,?\s+|\s+followed by\s+)\s*/i;
/** Split on "," and "and" only when every piece is its own command. */
const WEAK = /\s*,\s*(?:and\s+)?|\s+and\s+/i;

function splitWeak(clause: string): string[] {
  const parts = clause.split(WEAK).filter(Boolean);
  const out: string[] = [];
  const seps = clause.match(new RegExp(WEAK.source, "gi")) ?? [];
  parts.forEach((p, i) => {
    if (i > 0 && !VERBS.test(clean(p)) && out.length) out[out.length - 1] += `${seps[i - 1] ?? " and "}${p}`;
    else out.push(p);
  });
  return out;
}

/** Natural language → plan. Unmatched text becomes a question for Darwin (ask_darwin). */
export function parseCommand(text: string, ctx: ParseContext = {}): ParsedPlan {
  const steps: PlanStep[] = [];
  for (const clause of text.split(STRONG).map((s) => s.trim()).filter(Boolean)) {
    const pieces = splitWeak(clause);
    if (pieces.length > 1) {
      const parsed = pieces.map((p) => parseClause(p, ctx));
      if (parsed.every((p): p is PlanStep => !!p)) {
        steps.push(...parsed);
        continue;
      }
    }
    const one = parseClause(clause, ctx) ?? askStep(clean(clause) || clause);
    if (one) steps.push(one);
  }
  const capped = steps.slice(0, 6);
  return { steps: capped, say: sayFor(capped), source: "heuristic" };
}

/** Page-aware helper for callers: the current page key, if the path is a console page. */
export { pageOf };
