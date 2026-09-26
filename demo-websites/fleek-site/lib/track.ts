/**
 * Commerce events for Darwin, sent through darwin.js (`window.darwin.capture`). Calls made before the
 * tag has loaded are queued in `window.darwin = [[event, props]]`, which darwin.js replays on load.
 *
 * Event names and properties follow Darwin's analytics contract (money in pence). darwin.js adds
 * page, session, device and site; Darwin classifies the visitor (human vs AI agent) server-side.
 * `config_version` / `config_label` say which storefront.config.json the shopper saw, so traffic
 * before and after a Darwin PR can be told apart.
 */
"use client";

type Props = Record<string, unknown>;
type DarwinApi = { capture: (event: string, props?: Props) => void };

declare global {
  interface Window {
    darwin?: DarwinApi | [string, Props | undefined][];
    __rackdSpec?: { version: number; label: string };
  }
}

export const EVENTS = {
  productViewed: "product_viewed",
  productAdded: "product_added",
  cartViewed: "cart_viewed",
  checkoutStarted: "checkout_started",
  checkoutStepCompleted: "checkout_step_completed",
  shippingRevealed: "shipping_cost_revealed",
  checkoutAbandoned: "checkout_abandoned",
  orderCompleted: "order_completed",
} as const;

export function track(event: string, props: Props = {}) {
  if (typeof window === "undefined") return;
  const spec = window.__rackdSpec;
  const all: Props = { currency: "GBP", ...(spec ? { config_version: spec.version, config_label: spec.label } : {}), ...props };
  const d = window.darwin;
  if (d && !Array.isArray(d) && typeof d.capture === "function") d.capture(event, all);
  else {
    const q = Array.isArray(d) ? d : [];
    q.push([event, all]);
    window.darwin = q;
  }
}
