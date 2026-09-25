"use client";
/**
 * Browser analytics helper used by storefront components. Public API (stable):
 *
 *   initAnalytics({ distinctId, props })   once per page (repeat calls just update attribution)
 *   capture("product_added", { product_id, price })
 *   flush()
 *
 * Default path — posthog-js: `initAnalytics()` lazy-loads posthog-js pointed at our PostHog-compatible
 * `/ingest` endpoint (src/app/ingest), bootstrapped with the server's `distinctId`, with autocapture,
 * rage clicks and `$pageview`/`$pageleave` (incl. client-side navigations) on and session recording off.
 * `props` (experiment_id, variant, spec_version…) are registered as super properties, so every event —
 * autocaptured or not — carries attribution. `capture()` goes through posthog.
 * `capture("$pageview" | "$pageleave")` is IGNORED in this mode because posthog already captures them;
 * that is what keeps pageviews from being double counted.
 *
 * Fallback — `/api/capture`: if posthog-js fails to load (or `NEXT_PUBLIC_DARWIN_POSTHOG=0`), events are
 * batched to `/api/capture` exactly as before, and explicit `$pageview`s are sent as-is.
 *
 * Events captured before `initAnalytics()` / while posthog-js loads are held and replayed with their
 * original timestamps, so child components can capture before the provider's effect runs.
 */
import type { PostHog } from "posthog-js";
import type { AnalyticsEventInput, EventProperties } from "@/lib/contracts";

const INGEST_PATH = "/ingest";
const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_KEY || "phc_darwin_local";
const POSTHOG_ENABLED = process.env.NEXT_PUBLIC_DARWIN_POSTHOG !== "0";
const LOAD_TIMEOUT_MS = 5000;
/** Captured automatically by posthog-js; explicit calls are dropped in posthog mode. */
const AUTO_EVENTS = new Set(["$pageview", "$pageleave"]);
/** Attribution keys that must not outlive the experiment that set them (posthog persists super props). */
const ATTRIBUTION_KEYS = ["experiment_id", "variant", "spec_version"];

type Mode = "idle" | "loading" | "posthog" | "fallback";
interface Held {
  event: string;
  props: EventProperties;
  at: Date;
  page: { $current_url: string; $pathname: string; $referrer?: string };
}

let mode: Mode = "idle";
let ph: PostHog | undefined;
let base: EventProperties = {};
let distinctId = "anonymous";
let registered = new Set<string>();
let held: Held[] = [];
let heldTimer: ReturnType<typeof setTimeout> | undefined;
let queue: AnalyticsEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

const isBrowser = () => typeof window !== "undefined";

function sessionId() {
  try {
    let sid = sessionStorage.getItem("darwin_sid");
    if (!sid) {
      sid = `s_${crypto.randomUUID()}`;
      sessionStorage.setItem("darwin_sid", sid);
    }
    return sid;
  } catch {
    return "s_unknown";
  }
}

function pageContext(): Held["page"] {
  return {
    $current_url: window.location.href,
    $pathname: window.location.pathname,
    $referrer: document.referrer || undefined,
  };
}

/** Avoid Next.js' trailing-slash 308 on every SDK request: `/ingest/e/?…` → `/ingest/e?…`. */
function stripTrailingSlash(url: URL): URL {
  if (url.pathname.startsWith(`${INGEST_PATH}/`) && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url;
}

function superProps(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined));
}

type SuperPropsApi = Pick<PostHog, "register" | "unregister" | "get_distinct_id">;

function syncPosthog(inst: SuperPropsApi) {
  const next = superProps();
  for (const key of new Set([...registered, ...ATTRIBUTION_KEYS])) if (!(key in next)) inst.unregister(key);
  inst.register(next);
  registered = new Set(Object.keys(next));
  if (inst.get_distinct_id() !== distinctId) inst.register({ distinct_id: distinctId, $device_id: distinctId });
}

function loadPosthog() {
  mode = "loading";
  const giveUp = setTimeout(() => fallBack("posthog-js load timed out"), LOAD_TIMEOUT_MS);
  import("posthog-js")
    .then(({ default: posthog }) => {
      clearTimeout(giveUp);
      if (mode !== "loading") return;
      if (!posthog.__loaded) {
        posthog.init(POSTHOG_TOKEN, {
          api_host: INGEST_PATH,
          rewriteRequestPath: stripTrailingSlash,
          bootstrap: { distinctID: distinctId },
          person_profiles: "identified_only",
          autocapture: true,
          rageclick: true,
          capture_pageview: "history_change",
          capture_pageleave: true,
          // Capture bots and headless browsers too: the server classifies humans vs agents.
          opt_out_useragent_filter: true,
          disable_session_recording: true,
          disable_surveys: true,
          disable_product_tours: true,
          disable_conversations: true,
          disable_web_experiments: true,
          capture_dead_clicks: false,
          capture_heatmaps: false,
          capture_exceptions: false,
          capture_performance: false,
          advanced_disable_toolbar_metrics: true,
          request_queue_config: { flush_interval_ms: 1000 },
          // Runs before the initial $pageview, so it already carries attribution.
          loaded: (inst) => syncPosthog(inst),
        });
      } else {
        syncPosthog(posthog);
      }
      ph = posthog;
      mode = "posthog";
      drainHeld();
    })
    .catch((err) => {
      clearTimeout(giveUp);
      fallBack(err);
    });
}

function fallBack(reason: unknown) {
  if (mode === "posthog" || mode === "fallback") return;
  if (process.env.NODE_ENV !== "production") console.warn("[analytics] posthog-js unavailable, using /api/capture:", reason);
  mode = "fallback";
  drainHeld();
}

function drainHeld() {
  clearTimeout(heldTimer);
  heldTimer = undefined;
  const items = held;
  held = [];
  for (const h of items) send(h);
}

function send(h: Held) {
  if (mode === "posthog" && ph) {
    if (AUTO_EVENTS.has(h.event)) return;
    ph.capture(h.event, { ...h.page, ...h.props }, { timestamp: h.at });
    return;
  }
  queue.push({
    event: h.event,
    distinct_id: distinctId,
    timestamp: h.at.toISOString(),
    properties: {
      ...base,
      $session_id: sessionId(),
      ...h.page,
      $device_type: window.innerWidth < 768 ? "Mobile" : "Desktop",
      ...h.props,
    },
  });
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export function initAnalytics(opts: { distinctId: string; props: EventProperties }) {
  if (!isBrowser()) return;
  distinctId = opts.distinctId;
  base = { visitor_kind: "human", ...opts.props };
  if (mode === "posthog" && ph) return syncPosthog(ph);
  if (mode !== "idle") return; // loading: applied on load; fallback: `base` is read per event
  if (POSTHOG_ENABLED) loadPosthog();
  else fallBack("disabled by NEXT_PUBLIC_DARWIN_POSTHOG=0");
}

export function capture(event: string, props: EventProperties = {}) {
  if (!isBrowser()) return;
  const h: Held = { event, props, at: new Date(), page: pageContext() };
  if (mode === "posthog" || mode === "fallback") return send(h);
  held.push(h);
  // Nobody called initAnalytics(): don't hold events forever.
  if (mode === "idle" && !heldTimer) {
    heldTimer = setTimeout(() => {
      if (mode === "idle") fallBack("initAnalytics() not called");
    }, LOAD_TIMEOUT_MS);
  }
}

/** Send any `/api/capture` batch now. (posthog-js flushes itself every second and on pagehide.) */
export function flush() {
  if (!isBrowser()) return;
  clearTimeout(timer);
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/capture", new Blob([body], { type: "application/json" }));
  } else {
    void fetch("/api/capture", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
  }
}

function onPageHide() {
  // Leaving before posthog-js loaded: deliver held events the simple way rather than lose them.
  if (held.length && mode !== "posthog") {
    mode = "fallback";
    drainHeld();
  }
  flush();
}

if (isBrowser()) {
  window.addEventListener("pagehide", onPageHide);
}
