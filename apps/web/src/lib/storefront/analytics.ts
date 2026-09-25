"use client";
/**
 * Storefront → analytics bridge. Uses only the public API of `@/lib/analytics/browser`.
 * Previews (console iframes) never send events.
 */
import { capture, flush, initAnalytics } from "@/lib/analytics/browser";
import type { EventProperties } from "@/lib/contracts";

export interface StoreAnalyticsConfig {
  enabled: boolean;
  distinctId: string;
  props: EventProperties;
}

let initialisedWith = "";

function ensureInit(cfg: StoreAnalyticsConfig) {
  const key = JSON.stringify([cfg.distinctId, cfg.props]);
  if (key === initialisedWith) return;
  initialisedWith = key;
  initAnalytics({ distinctId: cfg.distinctId, props: cfg.props });
}

export function trackWith(cfg: StoreAnalyticsConfig, event: string, props: EventProperties = {}) {
  if (!cfg.enabled || typeof window === "undefined") return;
  ensureInit(cfg);
  capture(event, props);
}

/** Send anything queued right now (e.g. from a pagehide handler). */
export function flushNow(cfg: StoreAnalyticsConfig) {
  if (!cfg.enabled) return;
  flush();
}
