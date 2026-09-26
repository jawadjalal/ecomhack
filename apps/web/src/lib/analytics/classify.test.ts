import { describe, expect, it } from "vitest";
import { classifyRequest, classifyUserAgent, classifyVisitor, POSTHOG_BLOCKED_UA_STRS } from "./classify";

const HUMANS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  // Phones whose model names contain "bot" must not be flagged (why PostHog doesn't block bare "bot").
  "Mozilla/5.0 (Linux; Android 9; CUBOT P30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  // Pinterest in-app browser is a real user.
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15D100 [Pinterest/iOS]",
];

const AGENTS: [ua: string, category: string, name: string][] = [
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)", "ai_agent", "ChatGPT-User"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "ai_agent", "Claude-User"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "ai_agent", "Perplexity-User"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", "ai_crawler", "GPTBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ai_crawler", "ClaudeBot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "ai_crawler", "PerplexityBot"],
  ["Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)", "ai_crawler", "OAI-SearchBot"],
  ["CCBot/2.0 (https://commoncrawl.org/faq/)", "ai_crawler", "CCBot"],
  ["Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)", "ai_crawler", "Bytespider"],
  ["meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", "ai_crawler", "Meta-ExternalAgent"],
  ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36", "automation", "HeadlessChrome"],
  ["Mozilla/5.0 (X11; Linux x86_64) Playwright/1.56", "automation", "Playwright"],
  ["curl/8.5.0", "http_client", "curl"],
  ["python-requests/2.32.3", "http_client", "python-requests"],
  ["axios/1.7.2", "http_client", "axios"],
  ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "bot", "Googlebot"],
  ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "bot", "bingbot"],
  ["Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)", "bot", "AhrefsBot"],
  ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "bot", "Slackbot-LinkExpanding"],
  ["darwin buyer agent/1.0", "ai_agent", "darwin buyer agent/1.0"],
];

describe("classifyUserAgent", () => {
  it.each(HUMANS)("human: %s", (ua) => {
    expect(classifyUserAgent(ua)).toEqual({ kind: "human" });
  });

  it.each(AGENTS)("agent: %s → %s", (ua, category, name) => {
    expect(classifyUserAgent(ua)).toEqual({ kind: "agent", category, agentName: name });
  });

  it("treats missing UAs as human (server-side SDK calls are classified per event)", () => {
    expect(classifyUserAgent(undefined)).toEqual({ kind: "human" });
    expect(classifyUserAgent("")).toEqual({ kind: "human" });
  });

  it("every entry of PostHog's list is caught", () => {
    for (const s of POSTHOG_BLOCKED_UA_STRS) expect(classifyUserAgent(`Mozilla/5.0 (compatible; ${s} x)`).kind).toBe("agent");
  });
});

describe("classifyVisitor / classifyRequest", () => {
  it("declared agent header wins", () => {
    expect(classifyVisitor({ userAgent: HUMANS[0], declaredAgent: "grok-shopper" })).toEqual({
      kind: "agent",
      agentName: "grok-shopper",
      category: "declared",
    });
  });

  it("Web Bot Auth signature-agent header (ChatGPT agent uses a normal Chrome UA)", () => {
    expect(classifyVisitor({ userAgent: HUMANS[0], signatureAgent: '"https://chatgpt.com"' })).toEqual({
      kind: "agent",
      agentName: "chatgpt.com",
      category: "ai_agent",
    });
  });

  it("posthog-js client hint (navigator.webdriver) marks automation", () => {
    expect(classifyVisitor({ userAgent: HUMANS[0], clientBotHint: true })).toMatchObject({ kind: "agent", category: "automation" });
  });

  it("reads all signals from request headers", () => {
    const h = new Headers({ "user-agent": HUMANS[0], "x-darwin-agent": "claude-shopper" });
    expect(classifyRequest(h)).toMatchObject({ kind: "agent", agentName: "claude-shopper" });
    expect(classifyRequest(new Headers({ "user-agent": HUMANS[1] }))).toEqual({ kind: "human" });
  });
});
