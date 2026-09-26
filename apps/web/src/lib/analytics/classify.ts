/**
 * Human vs AI-agent classification (server side).
 *
 * Signals, strongest first:
 *   1. A declared agent header (`x-agent-name` / `x-darwin-agent`): our own buyer agents and MCP clients.
 *   2. A Web Bot Auth `signature-agent` header (e.g. ChatGPT agent sends `"https://chatgpt.com"`).
 *   3. The user agent string, matched against:
 *        - AI agents acting for a person (ChatGPT-User, Claude-User, Perplexity-User…)
 *        - AI / LLM crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot, Bytespider…)
 *        - browser automation (HeadlessChrome, Playwright, Puppeteer, Selenium…)
 *        - programmatic HTTP clients (curl, python-requests, axios…)
 *        - PostHog's generic bot/crawler list (search engines, SEO tools, uptime monitors…)
 *   4. posthog-js's client-side hint `$browser_type === "bot"` (it also checks `navigator.webdriver`).
 *
 * `VisitorKind` is only `human | agent`, so every non-human is `agent`; `category` says which kind of
 * non-human it is so the console/optimizer can separate shopping agents from crawlers if needed.
 */
import type { VisitorKind } from "@/lib/contracts";

export type AgentCategory =
  | "declared" // told us who it is via header or event property
  | "ai_agent" // an AI assistant/agent fetching on behalf of a person
  | "ai_crawler" // LLM training / AI search crawler
  | "automation" // headless / webdriver-driven browser
  | "http_client" // curl, python-requests, axios… (scripts and tool-calling agents)
  | "bot"; // generic crawler / monitor from PostHog's list

export interface ClassifyInput {
  userAgent?: string | null;
  /** Value of an `x-agent-name` / `x-darwin-agent` header if present. */
  declaredAgent?: string | null;
  /** Value of a Web Bot Auth `signature-agent` header if present. */
  signatureAgent?: string | null;
  /** posthog-js client hint: `properties.$browser_type === "bot"` (UA list + navigator.webdriver). */
  clientBotHint?: boolean;
}

export interface Classification {
  kind: VisitorKind;
  agentName?: string;
  category?: AgentCategory;
}

type Rule = readonly [needle: string, name: string];

/** AI assistants / agents fetching on behalf of a user. Checked before crawlers. */
const AI_AGENT_UAS: readonly Rule[] = [
  ["chatgpt-user", "ChatGPT-User"],
  ["chatgpt agent", "ChatGPT Agent"],
  ["claude-user", "Claude-User"],
  ["claude-code", "Claude Code"],
  ["perplexity-user", "Perplexity-User"],
  ["mistralai-user", "MistralAI-User"],
  ["meta-externalfetcher", "Meta-ExternalFetcher"],
  ["duckassistbot", "DuckAssistBot"],
  ["gemini-deep-research", "Gemini Deep Research"],
  ["novaact", "Amazon Nova Act"],
  ["grok", "Grok"],
  ["xai-", "xAI"],
  ["browser-use", "browser-use"],
  ["browserbase", "Browserbase"],
  ["mcp-client", "MCP client"],
  ["shopping-agent", "shopping-agent"],
  ["buyer-agent", "buyer-agent"],
];

/** LLM training and AI search crawlers. */
const AI_CRAWLER_UAS: readonly Rule[] = [
  ["gptbot", "GPTBot"],
  ["oai-searchbot", "OAI-SearchBot"],
  ["claudebot", "ClaudeBot"],
  ["claude-searchbot", "Claude-SearchBot"],
  ["claude-web", "Claude-Web"],
  ["anthropic-ai", "anthropic-ai"],
  ["perplexitybot", "PerplexityBot"],
  ["google-extended", "Google-Extended"],
  ["google-cloudvertexbot", "Google-CloudVertexBot"],
  ["googleother", "GoogleOther"],
  ["applebot-extended", "Applebot-Extended"],
  ["meta-externalagent", "Meta-ExternalAgent"],
  ["facebookbot", "FacebookBot"],
  ["bytespider", "Bytespider"],
  ["ccbot", "CCBot"],
  ["cohere-training-data-crawler", "cohere-training-data-crawler"],
  ["cohere-ai", "cohere-ai"],
  ["amazonbot", "Amazonbot"],
  ["ai2bot", "AI2Bot"],
  ["diffbot", "Diffbot"],
  ["youbot", "YouBot"],
  ["deepseekbot", "DeepSeekBot"],
  ["timpibot", "Timpibot"],
  ["omgili", "Omgili"],
  ["imagesiftbot", "ImagesiftBot"],
  ["petalbot", "PetalBot"],
  ["kangaroo bot", "Kangaroo Bot"],
  ["iaskspider", "iAskSpider"],
  ["panscient", "Panscient"],
  ["velenpublicwebcrawler", "VelenPublicWebCrawler"],
];

/** Headless / scripted browsers. Agentic browsers usually run on these. */
const AUTOMATION_UAS: readonly Rule[] = [
  ["headlesschrome", "HeadlessChrome"],
  ["headless", "Headless browser"],
  ["playwright", "Playwright"],
  ["puppeteer", "Puppeteer"],
  ["selenium", "Selenium"],
  ["webdriver", "WebDriver"],
  ["phantomjs", "PhantomJS"],
  ["cypress", "Cypress"],
  ["lighthouse", "Lighthouse"],
];

/** Programmatic HTTP clients: tool-calling agents and scripts hitting the store directly. */
const HTTP_CLIENT_UAS: readonly Rule[] = [
  ["python-requests", "python-requests"],
  ["python-httpx", "python-httpx"],
  ["python-urllib", "python-urllib"],
  ["aiohttp", "aiohttp"],
  ["axios", "axios"],
  ["node-fetch", "node-fetch"],
  ["undici", "undici"],
  ["got (", "got"],
  ["curl/", "curl"],
  ["wget/", "Wget"],
  ["go-http-client", "Go-http-client"],
  ["okhttp", "okhttp"],
  ["java/", "Java"],
  ["libwww-perl", "libwww-perl"],
  ["httpie", "HTTPie"],
  ["postmanruntime", "PostmanRuntime"],
  ["insomnia", "Insomnia"],
];

/**
 * Generic bots. Ported from PostHog's `DEFAULT_BLOCKED_UA_STRS`
 * (posthog-js, packages/core/src/utils/bot-detection.ts @ 1.434.14).
 *
 * MIT License — Copyright (c) 2020-2025 PostHog, Inc.
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files, to deal in the Software without restriction, subject to the
 * condition that the above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY.
 *
 * AI crawlers and headless browsers from that list are handled by the more specific lists above.
 */
export const POSTHOG_BLOCKED_UA_STRS: readonly string[] = [
  // Random assortment of bots
  "amazonbot",
  "amazonproductbot",
  "app.hypefactors.com",
  "applebot",
  "archive.org_bot",
  "awariobot",
  "backlinksextendedbot",
  "baiduspider",
  "bingbot",
  "bingpreview",
  "chrome-lighthouse",
  "dataforseobot",
  "deepscan",
  "duckduckbot",
  "facebookexternal",
  "facebookcatalog",
  "http://yandex.com/bots",
  "hubspot",
  "ia_archiver",
  "leikibot",
  "linkedinbot",
  "meta-externalagent",
  "mj12bot",
  "msnbot",
  "nessus",
  "petalbot",
  "pinterestbot",
  "prerender",
  "rogerbot",
  "screaming frog",
  "sebot-wa",
  "sitebulb",
  "slackbot",
  "slurp",
  "trendictionbot",
  "turnitin",
  "twitterbot",
  "vercel-screenshot",
  "vercelbot",
  "yahoo! slurp",
  "yandexbot",
  "zoombot",
  // Bot-like words
  "bot.htm",
  "bot.php",
  "(bot;",
  "bot/",
  "crawler",
  // Ahrefs
  "ahrefsbot",
  "ahrefssiteaudit",
  // Semrush
  "semrushbot",
  "siteauditbot",
  "splitsignalbot",
  // AI crawlers
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "perplexitybot",
  // Uptime-like stuff
  "better uptime bot",
  "sentryuptimebot",
  "uptimerobot",
  // Headless browsers
  "headlesschrome",
  "cypress",
  // Google crawlers
  "google-hoteladsverifier",
  "adsbot-google",
  "apis-google",
  "duplexweb-google",
  "feedfetcher-google",
  "google favicon",
  "google web preview",
  "google-read-aloud",
  "googlebot",
  "googleother",
  "google-cloudvertexbot",
  "googleweblight",
  "mediapartners-google",
  "storebot-google",
  "google-inspectiontool",
  "bytespider",
];

/** Word-boundary fallbacks for self-describing agents ("darwin buyer agent/1.0") and spiders. */
const GENERIC_AGENT = /\b(?:ai[-_ ]?agent|agent|mcp)\b/;
const GENERIC_BOT = /spider|scraper/;
const BROWSER_TOKENS = /^(mozilla|applewebkit|chrome|chromium|safari|gecko|firefox|version|mobile|khtml|like|compatible|windows|linux|macintosh|intel|mac|os|x|nt|win64|x64)$/i;

function matchRules(ua: string, rules: readonly Rule[]): string | undefined {
  for (const [needle, name] of rules) if (ua.includes(needle)) return name;
  return undefined;
}

const cache = new Map<string, Classification>();
const CACHE_MAX = 2000;

/** Classify a user agent string alone. Cached; safe to call per event. */
export function classifyUserAgent(userAgent: string | null | undefined): Classification {
  if (!userAgent) return { kind: "human" };
  const hit = cache.get(userAgent);
  if (hit) return hit;

  const ua = userAgent.toLowerCase();
  let result: Classification = { kind: "human" };
  let name: string | undefined;
  if ((name = matchRules(ua, AI_AGENT_UAS))) result = { kind: "agent", agentName: name, category: "ai_agent" };
  else if ((name = matchRules(ua, AI_CRAWLER_UAS))) result = { kind: "agent", agentName: name, category: "ai_crawler" };
  else if ((name = matchRules(ua, AUTOMATION_UAS))) result = { kind: "agent", agentName: name, category: "automation" };
  else if ((name = matchRules(ua, HTTP_CLIENT_UAS))) result = { kind: "agent", agentName: name, category: "http_client" };
  else if (GENERIC_AGENT.test(ua)) result = { kind: "agent", agentName: shortName(userAgent), category: "ai_agent" };
  else {
    // Longest match names the bot best ("googlebot" over the generic "bot.htm").
    let blocked: string | undefined;
    for (const s of POSTHOG_BLOCKED_UA_STRS) if (ua.includes(s) && s.length > (blocked?.length ?? 0)) blocked = s;
    if (blocked) result = { kind: "agent", agentName: shortName(userAgent, blocked), category: "bot" };
    else if (GENERIC_BOT.test(ua)) result = { kind: "agent", agentName: shortName(userAgent), category: "bot" };
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(userAgent, Object.freeze(result));
  return result;
}

/** Best-effort product name, e.g. "Mozilla/5.0 (compatible; Googlebot/2.1; …)" → "Googlebot". */
function shortName(ua: string, needle?: string): string {
  const tokens = ua.match(/[A-Za-z][\w.-]*/g) ?? [];
  const core = needle?.replace(/[^a-z0-9.\- ]/g, "").trim();
  if (core) {
    const t = tokens.find((tok) => tok.toLowerCase().includes(core));
    if (t) return t;
  }
  if (ua.length <= 60) return ua.trim();
  const products = ua.match(/[A-Za-z][\w.-]*(?=\/\d)/g) ?? [];
  return products.find((t) => !BROWSER_TOKENS.test(t)) ?? tokens.find((t) => !BROWSER_TOKENS.test(t)) ?? ua.slice(0, 40);
}

/**
 * Classify a visitor from request/event signals. Signature kept stable for other modules;
 * `category` and the extra inputs are additive.
 */
export function classifyVisitor({ userAgent, declaredAgent, signatureAgent, clientBotHint }: ClassifyInput): Classification {
  if (declaredAgent) return { kind: "agent", agentName: declaredAgent, category: "declared" };
  const byUa = classifyUserAgent(userAgent);
  if (byUa.kind === "agent") return byUa;
  if (signatureAgent) {
    const name = signatureAgent.replace(/^"|"$/g, "").replace(/^https?:\/\//, "");
    return { kind: "agent", agentName: name || "signed-agent", category: "ai_agent" };
  }
  if (clientBotHint) return { kind: "agent", agentName: "webdriver", category: "automation" };
  return { kind: "human" };
}

/** Pull every classification signal from a request's headers. */
export function classifyRequest(headers: Headers): Classification {
  return classifyVisitor({
    userAgent: headers.get("user-agent"),
    declaredAgent: headers.get("x-agent-name") ?? headers.get("x-darwin-agent"),
    signatureAgent: headers.get("signature-agent"),
  });
}
