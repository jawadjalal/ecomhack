"use client";
/**
 * Browser analytics helper used by storefront components.
 *
 *   capture("product_added", { product_id, price })
 *
 * Events are batched and POSTed to /api/capture. Attribution (experiment, variant, spec_version)
 * is set once via `initAnalytics()` from the server-resolved visitor.
 * TODO(analytics): optionally route through posthog-js (autocapture, rage clicks, replay).
 */
import type { AnalyticsEventInput, EventProperties } from "@/lib/contracts";

let base: EventProperties = {};
let distinctId = "anonymous";
let queue: AnalyticsEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

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

export function initAnalytics(opts: { distinctId: string; props: EventProperties }) {
  distinctId = opts.distinctId;
  base = { visitor_kind: "human", ...opts.props };
}

export function capture(event: string, props: EventProperties = {}) {
  if (typeof window === "undefined") return;
  queue.push({
    event,
    distinct_id: distinctId,
    timestamp: new Date().toISOString(),
    properties: {
      ...base,
      $session_id: sessionId(),
      $current_url: window.location.href,
      $pathname: window.location.pathname,
      $referrer: document.referrer || undefined,
      $device_type: window.innerWidth < 768 ? "Mobile" : "Desktop",
      ...props,
    },
  });
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue });
  queue = [];
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/capture", new Blob([body], { type: "application/json" }));
  } else {
    void fetch("/api/capture", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
}
