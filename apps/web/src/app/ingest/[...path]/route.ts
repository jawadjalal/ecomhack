/**
 * PostHog-compatible ingestion. Point posthog-js at it with `api_host: "/ingest"`.
 *
 *   POST /ingest/e | /ingest/i/v0/e | /ingest/batch | /ingest/capture   events → track()
 *   POST /ingest/s                                                       session replay: accepted, dropped
 *   POST /ingest/flags | /ingest/decide                                  no flags, replay off, remote config
 *   GET  /ingest/array/<token>/config(.js)                               remote config (JSON / script)
 *   POST /ingest/i/v1/logs | /ingest/i/v1/metrics                        accepted, dropped
 *   GET  /ingest/static/*                                                302 to PostHog's asset CDN (lazy SDK bundles)
 *
 * Every event is classified server-side (human vs agent) before it is stored.
 */
import { allowIngest, sanitizeClientEvents } from "@/lib/analytics/trust";
import type { NextRequest } from "next/server";
import { track } from "@/lib/analytics/store";
import { classifyRequest } from "@/lib/analytics/classify";
import {
  DEFAULT_POSTHOG_TOKEN,
  IngestError,
  decodeBody,
  decodeQueryData,
  extractEvents,
  flagsResponse,
  mapPosthogEvents,
  remoteConfig,
  remoteConfigScript,
} from "@/lib/analytics/ingest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const MAX_BODY_BYTES = 1024 * 1024;
/** Where lazy-loaded posthog-js bundles (surveys.js, recorder.js…) live, as in PostHog's reverse-proxy setup. */
const ASSET_HOST = (process.env.POSTHOG_ASSET_HOST || "https://us-assets.i.posthog.com").replace(/\/$/, "");
const CAPTURE_PATHS = new Set(["e", "i/v0/e", "batch", "capture", "track", "engage"]);
const DROP_PATHS = new Set(["s", "i/v1/logs", "i/v0/logs", "i/v1/metrics"]);
const EMPTY_LISTS: Record<string, object> = {
  "api/surveys": { surveys: [] },
  "api/web_experiments": { experiments: [] },
  "api/early_access_features": { earlyAccessFeatures: [] },
  "api/product_tours": { product_tours: [] },
};

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    ...(origin ? { "Access-Control-Allow-Credentials": "true", Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      req.headers.get("access-control-request-headers") ?? "Content-Type, Content-Encoding, X-Agent-Name",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
  };
}

function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

async function capture(req: NextRequest, payload: () => Promise<unknown> | unknown) {
  try {
    const { events, sentAt } = extractEvents(await payload());
    const mapped = mapPosthogEvents(events, {
      request: classifyRequest(req.headers),
      userAgent: req.headers.get("user-agent"),
      sentAt,
    });
    // Over the per-IP budget: answer OK (posthog-js retries errors) but keep nothing.
    if (mapped.length && allowIngest(req, mapped.length)) track(sanitizeClientEvents(mapped, "storefront"));
    return json(req, { status: 1 });
  } catch (err) {
    if (err instanceof IngestError) {
      return json(req, { type: "validation_error", code: "invalid_payload", detail: err.message }, err.status);
    }
    console.error("[ingest] failed", err);
    return json(req, { type: "server_error", code: "ingest_failed" }, 500);
  }
}

async function readBody(req: NextRequest): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new IngestError("payload too large", 413);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > MAX_BODY_BYTES) throw new IngestError("payload too large", 413);
  return buf;
}

function remoteConfigRoute(req: Request, path: string[]) {
  const token = path[1] || DEFAULT_POSTHOG_TOKEN;
  if (path[2] === "config.js") {
    return new Response(remoteConfigScript(token), {
      headers: { ...corsHeaders(req), "Content-Type": "application/javascript; charset=utf-8" },
    });
  }
  return json(req, remoteConfig(token));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const path = (await params).path;
  const key = path.join("/");
  const sp = req.nextUrl.searchParams;

  if (CAPTURE_PATHS.has(key)) {
    return capture(req, async () =>
      decodeBody(await readBody(req), { compression: sp.get("compression"), contentType: req.headers.get("content-type") }),
    );
  }
  if (key === "flags" || key === "decide") {
    return json(req, flagsResponse(sp.get("token") ?? DEFAULT_POSTHOG_TOKEN, key === "decide"));
  }
  if (DROP_PATHS.has(key)) return json(req, { status: 1 });
  if (path[0] === "array" && path.length === 3) return remoteConfigRoute(req, path);
  if (EMPTY_LISTS[key]) return json(req, EMPTY_LISTS[key]);
  return json(req, { type: "not_found", detail: `unknown ingest path /${key}` }, 404);
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const path = (await params).path;
  const key = path.join("/");
  const sp = req.nextUrl.searchParams;

  if (CAPTURE_PATHS.has(key)) return capture(req, () => decodeQueryData(sp.get("data"), sp.get("compression")));
  if (path[0] === "array" && path.length === 3) return remoteConfigRoute(req, path);
  if (key === "flags" || key === "decide") {
    return json(req, flagsResponse(sp.get("token") ?? DEFAULT_POSTHOG_TOKEN, key === "decide"));
  }
  if (EMPTY_LISTS[key]) return json(req, EMPTY_LISTS[key]);
  if (path[0] === "static" && path.length > 1) {
    // Our storefront disables every lazy-loaded feature; other posthog-js configs get PostHog's CDN.
    return Response.redirect(`${ASSET_HOST}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, 302);
  }
  return json(req, { type: "not_found", detail: `unknown ingest path /${key}` }, 404);
}

export function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
