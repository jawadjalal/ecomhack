/**
 * Agent readiness audit (merchant tooling): can AI shopping agents find, understand and buy from a store?
 *
 *   const report = await auditStore("https://shop.example.com");
 *
 * Fetches a handful of pages in parallel (homepage, robots.txt, sitemap, llms.txt, agent card, MCP,
 * Shopify catalog, one product page), then scores them with the pure checks in ./checks.
 */
import type { ReadinessReport } from "@/lib/contracts";
import { evaluate, pickProductUrl, type Artifacts, type Fetched } from "./checks";
import { assertPublicUrl, BlockedUrlError, safeFetch } from "./fetcher";
import { parseRobots } from "./robots";

export { BlockedUrlError } from "./fetcher";
export { evaluate, score, draftLlmsTxt, type Artifacts, type Fetched } from "./checks";

/** Normalise user input ("shop.com", "https://shop.com/store/") to a URL. Throws BlockedUrlError. */
export function normaliseStoreUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 500) throw new BlockedUrlError("Enter your store's URL.");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    u.hash = "";
    return u.href;
  } catch {
    throw new BlockedUrlError("That doesn't look like a URL.");
  }
}

async function probeMcp(origin: string): Promise<Artifacts["mcp"]> {
  const post = (body: object, sessionId?: string) =>
    safeFetch(`${origin}/api/mcp`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      timeoutMs: 6000,
    });
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "darwin-readiness", version: "1.0" } } });
  const parse = (f: Fetched): Record<string, unknown> | undefined => {
    const text = f.body.trim();
    const json = text.startsWith("{") ? text : text.match(/^data:\s*(\{.*\})\s*$/m)?.[1];
    try {
      return json ? (JSON.parse(json) as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const initBody = parse(init);
  if (!initBody || initBody.jsonrpc !== "2.0" || !("result" in initBody)) {
    return { ok: false, status: init.status, tools: [], error: init.error };
  }
  const list = parse(await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, init.headers["mcp-session-id"]));
  const tools = ((list?.result as { tools?: { name?: string }[] } | undefined)?.tools ?? []).map((t) => String(t.name ?? "")).filter(Boolean);
  return { ok: true, status: init.status, tools };
}

export async function auditStore(input: string): Promise<ReadinessReport> {
  const started = Date.now();
  const url = normaliseStoreUrl(input);
  await assertPublicUrl(url);
  const origin = new URL(url).origin;

  const [home, robots, llms, agentCard, mcp, productsJson, ucp] = await Promise.all([
    safeFetch(url),
    safeFetch(`${origin}/robots.txt`, { timeoutMs: 5000 }),
    safeFetch(`${origin}/llms.txt`, { timeoutMs: 5000 }),
    safeFetch(`${origin}/.well-known/agent-card.json`, { timeoutMs: 5000 }).then((f) =>
      f.status === 404 ? safeFetch(`${origin}/.well-known/agent.json`, { timeoutMs: 5000 }) : f,
    ),
    probeMcp(origin),
    safeFetch(`${origin}/products.json?limit=12`, { timeoutMs: 5000 }),
    safeFetch(`${origin}/.well-known/ucp`, { timeoutMs: 5000 }),
  ]);

  const sitemapUrl = (robots.status === 200 && parseRobots(robots.body).sitemaps[0]) || `${origin}/sitemap.xml`;
  const sitemap = await safeFetch(sitemapUrl, { timeoutMs: 5000 });

  const artifacts: Artifacts = { url, home, robots, llms, agentCard, mcp, productsJson, ucp, sitemap };
  const productUrl = pickProductUrl(artifacts);
  if (productUrl) artifacts.product = await safeFetch(productUrl);

  return { ...evaluate(artifacts), checkedAt: new Date().toISOString(), durationMs: Date.now() - started };
}
