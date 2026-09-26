/**
 * The audit itself: fetch a store's agent-facing pages safely, then score them with ./checks.
 */
import type {
  CertificateTrial,
  CertificateTrialStep,
  ReadinessReport,
} from "@/lib/contracts";
import {
  evaluate,
  pickProductUrl,
  type Artifacts,
  type Fetched,
} from "./checks";
import { assertPublicUrl, BlockedUrlError, safeFetch } from "./fetcher";
import { parseRobots } from "./robots";

/** Normalise user input ("shop.com", "https://shop.com/store/") to a URL. Throws BlockedUrlError. */
export function normaliseStoreUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 500)
    throw new BlockedUrlError("Enter your store's URL.");
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
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
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      timeoutMs: 6000,
    });
  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "darwin-readiness", version: "1.0" },
    },
  });
  const parse = (f: Fetched): Record<string, unknown> | undefined => {
    const text = f.body.trim();
    const json = text.startsWith("{")
      ? text
      : text.match(/^data:\s*(\{.*\})\s*$/m)?.[1];
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
  const list = parse(
    await post(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      init.headers["mcp-session-id"],
    ),
  );
  const tools = (
    (list?.result as { tools?: { name?: string }[] } | undefined)?.tools ?? []
  )
    .map((t) => String(t.name ?? ""))
    .filter(Boolean);
  return { ok: true, status: init.status, tools };
}

export async function auditStore(input: string): Promise<ReadinessReport> {
  return (await auditWithArtifacts(input)).report;
}

/**
 * Live progress of an audit + agent trial, in the order things really happen (GET /api/readiness/stream).
 * `fetch`: one page came back. `audit`: the scored report. `trial`: the agent starts. `turn`: one agent tool
 * call and the store's answer. `read`: the agent read the page text. `judged`: the trial's verdict.
 */
export type ReadinessProgress =
  | {
      type: "fetch";
      id: string;
      label: string;
      url: string;
      status: number;
      ms: number;
      tools?: string[];
    }
  | { type: "audit"; report: ReadinessReport }
  | {
      type: "trial";
      agent: string;
      mode: "mcp" | "page" | "none";
      tools?: string[];
      note?: string;
    }
  | { type: "turn"; step: CertificateTrialStep }
  | { type: "read"; url: string; chars: number }
  | { type: "judged"; trial: CertificateTrial };

export type OnProgress = (e: ReadinessProgress) => void;

/** The audit plus the raw pages it fetched (the certificate reuses them instead of fetching again). */
export async function auditWithArtifacts(
  input: string,
  onProgress?: OnProgress,
): Promise<{ report: ReadinessReport; artifacts: Artifacts }> {
  const started = Date.now();
  const url = normaliseStoreUrl(input);
  await assertPublicUrl(url);
  const origin = new URL(url).origin;
  const host = new URL(url).host;
  /** Report each page the moment it comes back (never throws: progress is best-effort). */
  const track = <
    T extends { status: number; url?: string; tools?: string[] } | undefined,
  >(
    id: string,
    label: string,
    at: string,
    p: Promise<T>,
  ): Promise<T> => {
    if (!onProgress) return p;
    const t0 = Date.now();
    return p.then((r) => {
      try {
        onProgress({
          type: "fetch",
          id,
          label,
          url: r?.url || at,
          status: r?.status ?? 0,
          ms: Date.now() - t0,
          ...(r?.tools ? { tools: r.tools.slice(0, 20) } : {}),
        });
      } catch {
        /* ignore */
      }
      return r;
    });
  };

  const [home, robots, llms, agentCard, mcp, productsJson, ucp] =
    await Promise.all([
      track("home", `Opening ${host}`, url, safeFetch(url)),
      track(
        "robots",
        "Reading your robots.txt (who may visit)",
        `${origin}/robots.txt`,
        safeFetch(`${origin}/robots.txt`, { timeoutMs: 5000 }),
      ),
      track(
        "llms",
        "Looking for llms.txt (a guide written for AI)",
        `${origin}/llms.txt`,
        safeFetch(`${origin}/llms.txt`, { timeoutMs: 5000 }),
      ),
      track(
        "agent-card",
        "Looking for an agent card (a store agent to talk to)",
        `${origin}/.well-known/agent-card.json`,
        safeFetch(`${origin}/.well-known/agent-card.json`, {
          timeoutMs: 5000,
        }).then((f) =>
          f.status === 404
            ? safeFetch(`${origin}/.well-known/agent.json`, { timeoutMs: 5000 })
            : f,
        ),
      ),
      track(
        "mcp",
        "Asking if your store has tools agents can use",
        `${origin}/api/mcp`,
        probeMcp(origin),
      ),
      track(
        "products",
        "Asking your store for prices and stock",
        `${origin}/products.json`,
        safeFetch(`${origin}/products.json?limit=12`, { timeoutMs: 5000 }),
      ),
      track(
        "ucp",
        "Checking for an agent checkout",
        `${origin}/.well-known/ucp`,
        safeFetch(`${origin}/.well-known/ucp`, { timeoutMs: 5000 }),
      ),
    ]);

  const sitemapUrl =
    (robots.status === 200 && parseRobots(robots.body).sitemaps[0]) ||
    `${origin}/sitemap.xml`;
  const sitemap = await track(
    "sitemap",
    "Reading your sitemap (the list of pages)",
    sitemapUrl,
    safeFetch(sitemapUrl, { timeoutMs: 5000 }),
  );

  const artifacts: Artifacts = {
    url,
    home,
    robots,
    llms,
    agentCard,
    mcp,
    productsJson,
    ucp,
    sitemap,
  };
  const productUrl = pickProductUrl(artifacts);
  if (productUrl)
    artifacts.product = await track(
      "product",
      "Reading one of your product pages",
      productUrl,
      safeFetch(productUrl),
    );

  const report: ReadinessReport = {
    ...evaluate(artifacts),
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
  try {
    onProgress?.({ type: "audit", report });
  } catch {
    /* ignore */
  }
  return { report, artifacts };
}
