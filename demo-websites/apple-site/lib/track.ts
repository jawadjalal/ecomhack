/**
 * Commerce events for Darwin. darwin.js (loaded by components/darwin-tag.tsx, or by Darwin's install PR)
 * records page views, clicks and rage clicks by itself; the funnel events below are ours:
 *
 *   product_viewed          { product_id, name, price }
 *   product_added           { product_id, name, price, quantity, colour, option, source }
 *   cart_viewed             { value, items }
 *   shipping_cost_revealed  { shipping, subtotal, where }        (Darwin's "shipping shock" signal)
 *   checkout_started        { value, items }
 *   checkout_step_viewed    { step, step_name, steps }
 *   checkout_step_completed { step, step_name, steps }
 *   checkout_abandoned      { step, step_name, reason }
 *   express_pay_clicked     { method }
 *   order_completed         { order_id, revenue, shipping, items, express }
 *
 * Money is integer pence. Calls made before darwin.js loads are queued on `window.darwin` (darwin.js
 * replays them). Every call is also kept on `window.orchardEvents` so you can inspect them in devtools.
 */

type Props = Record<string, unknown>;
type DarwinApi = { v?: number; capture: (event: string, props?: Props) => void; flush?: (beacon?: boolean) => void };
type DarwinWindow = Window & { darwin?: DarwinApi | [string, Props][]; orchardEvents?: { event: string; props: Props }[] };

let specVersion: number | undefined;

/** Remember which config version the page renders, so every event says which one the shopper saw. */
export function setSpecVersion(v: number) {
  specVersion = v;
}

export function track(event: string, props: Props = {}) {
  if (typeof window === "undefined") return;
  const w = window as DarwinWindow;
  const p: Props = { store: "orchard", orchard_config_version: specVersion, ...props };
  (w.orchardEvents ??= []).push({ event, props: p });
  if (w.orchardEvents.length > 200) w.orchardEvents.shift();
  const d = w.darwin;
  if (d && !Array.isArray(d) && typeof d.capture === "function") d.capture(event, p);
  else if (Array.isArray(d)) d.push([event, p]);
  else w.darwin = [[event, p]];
}

/** Send queued events now (e.g. before the tab closes). */
export function flush() {
  const d = (window as DarwinWindow).darwin;
  if (d && !Array.isArray(d)) d.flush?.(true);
}
