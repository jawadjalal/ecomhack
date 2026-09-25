/**
 * PostHog-compatible ingestion: decode what posthog-js / posthog-node send, map it to our
 * `AnalyticsEvent`, and build the responses the SDKs expect.
 *
 * Wire formats handled (verified against posthog-js 1.434.14, see docs/posthog-extraction.md):
 *   - gzip body (`?compression=gzip-js`, `Content-Encoding: gzip`, or just gzip magic bytes)
 *   - base64 form body `data=<urlencoded base64(utf8 json)>` (`?compression=base64`, sendBeacon)
 *   - plain JSON (`application/json` or `text/plain`)
 *   - GET `?data=<base64 json>` (legacy pixel)
 *   - payload shapes: `{api_key, batch:[...], sent_at}`, `[...]`, a single event object
 *
 * Pure functions only (no store access) so they are cheap to unit test.
 */
import { gunzipSync } from "node:zlib";
import type { AnalyticsEventInput, EventProperties } from "@/lib/contracts";
import { classifyUserAgent, classifyVisitor, type Classification } from "./classify";

export class IngestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

/** Events we accept but never store (too heavy / not behavioural). */
export const DROPPED_EVENTS = new Set(["$snapshot", "$snapshot_items", "$$heatmap", "$heatmap", "$performance_event"]);

export interface DecodeOptions {
  /** `compression` query param: "gzip-js" | "gzip" | "base64" | "lz64" | null. */
  compression?: string | null;
  contentType?: string | null;
}

const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
const looksLikeJson = (s: string) => {
  const c = s.trimStart()[0];
  return c === "{" || c === "[";
};

function base64ToUtf8(s: string): string {
  // Form decoding may have turned '+' into ' '; base64 never contains spaces. Node also accepts base64url.
  return Buffer.from(s.replace(/ /g, "+"), "base64").toString("utf8");
}

/** Value of `data` in an x-www-form-urlencoded body, or undefined. */
function formField(body: string, field: string): string | undefined {
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key !== field) continue;
    const raw = eq === -1 ? "" : pair.slice(eq + 1);
    try {
      return decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      throw new IngestError("malformed form body");
    }
  }
  return undefined;
}

/** Turn a `data` string (JSON, or base64 JSON) into a value. */
function parseDataString(data: string, compression?: string | null): unknown {
  const text = compression === "base64" || !looksLikeJson(data) ? base64ToUtf8(data) : data;
  try {
    return JSON.parse(text);
  } catch {
    throw new IngestError("data is not valid JSON");
  }
}

/** Decode a request body sent by any PostHog SDK. Throws `IngestError` on garbage. */
export function decodeBody(raw: Uint8Array, opts: DecodeOptions = {}): unknown {
  const compression = opts.compression?.toLowerCase() ?? null;
  if (compression === "lz64") throw new IngestError("lz64 compression is not supported; use gzip-js or base64");
  if (!raw.length) return undefined;

  // Sniff gzip by magic bytes rather than trusting `compression` / `Content-Encoding`: posthog-js falls
  // back to an uncompressed body when gzip fails, and posthog-node only sets the header.
  let bytes = raw;
  if (isGzip(bytes)) {
    try {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    } catch {
      throw new IngestError("invalid gzip body");
    }
  }

  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8");
  const isForm = opts.contentType?.includes("application/x-www-form-urlencoded") || /^data=/.test(text);
  if (isForm) {
    const data = formField(text, "data");
    if (data === undefined) throw new IngestError("form body without data field");
    return parseDataString(data, compression);
  }
  if (looksLikeJson(text)) {
    try {
      return JSON.parse(text);
    } catch {
      throw new IngestError("body is not valid JSON");
    }
  }
  // Bare base64 JSON (compression=base64 without the form wrapper).
  return parseDataString(text.trim(), "base64");
}

/** Decode a legacy GET `?data=` capture. */
export function decodeQueryData(data: string | null, compression?: string | null): unknown {
  if (!data) return undefined;
  return parseDataString(data, compression?.toLowerCase() === "base64" ? "base64" : null);
}

/* ------------------------------------------------------------------ payload → events */

export type PosthogRawEvent = {
  event?: unknown;
  distinct_id?: unknown;
  $distinct_id?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  offset?: unknown;
  sent_at?: unknown;
  properties?: unknown;
  $set?: unknown;
  $set_once?: unknown;
  [key: string]: unknown;
};

export interface ExtractedBatch {
  events: PosthogRawEvent[];
  sentAt?: string;
  apiKey?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Normalize the payload shapes PostHog SDKs send into a flat list of raw events. */
export function extractEvents(payload: unknown): ExtractedBatch {
  if (Array.isArray(payload)) return { events: payload.filter(isObj) };
  if (!isObj(payload)) return { events: [] };
  const sentAt = typeof payload.sent_at === "string" ? payload.sent_at : undefined;
  const apiKey = typeof payload.api_key === "string" ? payload.api_key : undefined;
  if (Array.isArray(payload.batch)) return { events: payload.batch.filter(isObj), sentAt, apiKey };
  if (Array.isArray(payload.data)) return { events: payload.data.filter(isObj), sentAt, apiKey };
  if (typeof payload.event === "string") return { events: [payload], sentAt, apiKey };
  return { events: [], sentAt, apiKey };
}

export interface MapContext {
  /** Request-level classification (headers). */
  request: Classification;
  /** Request user agent (fallback for `$user_agent`). */
  userAgent?: string | null;
  /** Batch-level `sent_at` for clock-skew correction. */
  sentAt?: string;
  /** Server receive time (injectable for tests). */
  now?: number;
}

const toStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.length ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;

/**
 * PostHog's server-side timestamp rule: trust the client's relative time, not its clock.
 *   timestamp + sent_at → now - (sent_at - timestamp);  offset → now - offset;  else now.
 */
export function resolveTimestamp(ev: PosthogRawEvent, batchSentAt: string | undefined, now: number): string {
  const ts = toStr(ev.timestamp);
  const tsMs = ts ? Date.parse(ts) : NaN;
  let ms = now;
  if (Number.isFinite(tsMs)) {
    const sentAt = toStr(ev.sent_at) ?? batchSentAt;
    const sentMs = sentAt ? Date.parse(sentAt) : NaN;
    ms = Number.isFinite(sentMs) ? now - (sentMs - tsMs) : tsMs;
  } else if (typeof ev.offset === "number" && Number.isFinite(ev.offset)) {
    ms = now - ev.offset;
  }
  if (ms > now) ms = now; // never in the future
  return new Date(ms).toISOString();
}

/** Map raw PostHog events to our contract. Drops heavy/non-behavioural events. */
export function mapPosthogEvents(raw: PosthogRawEvent[], ctx: MapContext): AnalyticsEventInput[] {
  const now = ctx.now ?? Date.now();
  const out: AnalyticsEventInput[] = [];
  for (const ev of raw) {
    const name = toStr(ev.event);
    if (!name || DROPPED_EVENTS.has(name)) continue;

    const props: EventProperties = isObj(ev.properties) ? { ...(ev.properties as EventProperties) } : {};
    if (isObj(ev.$set)) props.$set = { ...(isObj(props.$set) ? props.$set : {}), ...ev.$set };
    if (isObj(ev.$set_once)) props.$set_once = { ...(isObj(props.$set_once) ? props.$set_once : {}), ...ev.$set_once };

    const distinctId =
      toStr(ev.distinct_id) ?? toStr(props.distinct_id) ?? toStr(ev.$distinct_id) ?? toStr(props.$device_id) ?? "anonymous";

    const eventUa = toStr(props.$raw_user_agent) ?? toStr(props.$user_agent);
    if (!props.$user_agent) props.$user_agent = eventUa ?? ctx.userAgent ?? undefined;

    const c = classifyEvent(ctx.request, eventUa, props);
    props.visitor_kind = c.kind;
    if (c.kind === "agent") {
      props.agent_name = c.agentName;
      if (c.category) props.agent_category = c.category;
    } else {
      delete props.agent_name;
      delete props.agent_category;
    }

    const uuid = toStr(ev.uuid);
    out.push({
      ...(uuid && uuid.length <= 64 ? { uuid } : {}),
      event: name,
      distinct_id: distinctId,
      timestamp: resolveTimestamp(ev, ctx.sentAt, now),
      properties: props,
    });
  }
  return out;
}

/**
 * Per-event classification. Claims of being an agent are believed (agents self-identify);
 * claims of being human are verified against every signal we have.
 */
function classifyEvent(request: Classification, eventUa: string | undefined, props: EventProperties): Classification {
  const declaredName = toStr(props.agent_name);
  if (request.kind === "agent") {
    return request.category === "declared" ? request : { ...request, agentName: declaredName ?? request.agentName };
  }
  const byEventUa = classifyUserAgent(eventUa);
  if (byEventUa.kind === "agent") return { ...byEventUa, agentName: declaredName ?? byEventUa.agentName };
  const hinted = classifyVisitor({ clientBotHint: props.$browser_type === "bot" });
  if (hinted.kind === "agent") return { ...hinted, agentName: declaredName ?? hinted.agentName };
  if (props.visitor_kind === "agent") return { kind: "agent", agentName: declaredName ?? "self-declared", category: "declared" };
  return request;
}

/* ------------------------------------------------------------------ SDK responses */

/** Public project token the storefront uses. Not a secret; we don't validate it. */
export const DEFAULT_POSTHOG_TOKEN = "phc_darwin_local";

/**
 * Remote config (`/array/<token>/config` and merged into `/flags`, `/decide`).
 * `autocapture_opt_out: false` matters: without it posthog-js keeps autocapture (and rage clicks) OFF.
 */
export function remoteConfig(token: string) {
  return {
    token,
    supportedCompression: ["gzip-js", "base64"],
    hasFeatureFlags: false,
    autocapture_opt_out: false,
    autocaptureExceptions: false,
    capturePerformance: false,
    captureDeadClicks: false,
    elementsChainAsString: true,
    errorTracking: { autocaptureExceptions: false, suppressionRules: [] },
    logs: { captureConsoleLogs: false },
    sessionRecording: false,
    heatmaps: false,
    surveys: false,
    productTours: false,
    conversations: false,
    defaultIdentifiedOnly: true,
    toolbarParams: {},
    toolbarVersion: "toolbar",
    isAuthenticated: false,
    siteApps: [],
  };
}

/** `/flags/?v=2` (and legacy `/decide/`) response: no flags, recordings off, config included. */
export function flagsResponse(token: string, legacyDecide = false) {
  return {
    ...remoteConfig(token),
    ...(legacyDecide ? { config: { enable_collect_everything: true }, editorParams: {} } : {}),
    flags: {},
    featureFlags: {},
    featureFlagPayloads: {},
    errorsWhileComputingFlags: false,
    quotaLimited: [],
    requestId: crypto.randomUUID(),
    evaluatedAt: Date.now(),
  };
}

/** `/array/<token>/config.js`: the script form posthog-js loads first. */
export function remoteConfigScript(token: string): string {
  const t = JSON.stringify(token);
  return (
    "(function(){window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};" +
    `window._POSTHOG_REMOTE_CONFIG[${t}]={config:${JSON.stringify(remoteConfig(token))},siteApps:[]};})();`
  );
}
