/**
 * Minimal Tavily client (https://docs.tavily.com): /search and /extract over fetch, with timeouts.
 * No SDK, no new dependency. `tavilyAvailable()` is false without TAVILY_API_KEY.
 */

const BASE = "https://api.tavily.com";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface TavilySearchResponse {
  answer?: string;
  results: TavilyResult[];
}

export interface TavilyExtractResult {
  url: string;
  raw_content: string;
}

export function tavilyAvailable(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

export class TavilyError extends Error {}

async function post<T>(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new TavilyError("TAVILY_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new TavilyError(
      name === "TimeoutError" || name === "AbortError"
        ? `Tavily ${path} timed out`
        : `Couldn't reach Tavily (${(e as Error).message})`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TavilyError(
      `Tavily ${path} failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

const isHttp = (u: unknown): u is string =>
  typeof u === "string" && /^https?:\/\//i.test(u);

export async function tavilySearch(
  query: string,
  opts: {
    maxResults?: number;
    depth?: "basic" | "advanced";
    includeAnswer?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<TavilySearchResponse> {
  const raw = await post<{ answer?: unknown; results?: unknown[] }>(
    "/search",
    {
      query: query.slice(0, 400),
      search_depth: opts.depth ?? "basic",
      max_results: opts.maxResults ?? 8,
      include_answer: opts.includeAnswer ?? false,
    },
    opts.timeoutMs ?? 15_000,
  );
  const results = (Array.isArray(raw.results) ? raw.results : [])
    .map((r) => r as Record<string, unknown>)
    .filter((r) => isHttp(r.url))
    .map((r) => ({
      title: String(r.title ?? r.url).slice(0, 200),
      url: String(r.url),
      content: String(r.content ?? "").slice(0, 2000),
      score: typeof r.score === "number" ? r.score : undefined,
    }));
  return {
    answer: typeof raw.answer === "string" ? raw.answer : undefined,
    results,
  };
}

export async function tavilyExtract(
  urls: string[],
  opts: { timeoutMs?: number } = {},
): Promise<TavilyExtractResult[]> {
  const list = urls.filter(isHttp).slice(0, 20);
  if (!list.length) return [];
  const raw = await post<{ results?: unknown[] }>(
    "/extract",
    { urls: list },
    opts.timeoutMs ?? 20_000,
  );
  return (Array.isArray(raw.results) ? raw.results : [])
    .map((r) => r as Record<string, unknown>)
    .filter((r) => isHttp(r.url) && typeof r.raw_content === "string")
    .map((r) => ({
      url: String(r.url),
      raw_content: String(r.raw_content).slice(0, 20_000),
    }));
}
