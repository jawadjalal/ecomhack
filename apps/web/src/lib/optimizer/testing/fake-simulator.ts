/**
 * A tiny, deterministic stand-in for the real simulator, used by the optimizer's tests.
 *
 * Each synthetic visitor is assigned a spec via `resolveSpecForVisitor` (so running experiments split
 * traffic exactly like production), walks the funnel with probabilities that depend on PageSpec knobs,
 * and emits properly attributed events via `track()`. Deliberately exaggerated effect sizes keep the
 * tests fast and stable.
 */
import type { AnalyticsEventInput, PageSpec } from "@/lib/contracts";
import type { SimulationOptions, SimulationResult } from "@/lib/simulator";
import { track } from "@/lib/analytics/store";
import { attributionProps, resolveSpecForVisitor } from "@/lib/spec/resolve";
import { mulberry32 } from "../util";

export interface HumanFunnel {
  browse: number;
  add: number;
  checkout: number;
  order: number;
}

export function fakeHumanFunnel(spec: PageSpec): HumanFunnel {
  const pp = spec.productPage;
  const browse = 0.7 + (spec.hero.showSocialProof ? 0.08 : 0) + (spec.productGrid.showRatings ? 0.03 : 0);
  let add =
    0.25 +
    (pp.ctaPosition === "sticky" ? 0.15 : pp.ctaPosition === "above-fold" ? 0.08 : 0) +
    (pp.showReviews ? 0.05 : 0) +
    (pp.showDeliveryEstimate ? 0.03 : 0) +
    (pp.showReturnsPolicy ? 0.02 : 0);
  if (pp.urgency === "low-stock") add -= 0.12; // the risky idea backfires in this world
  const checkout = 0.7 + (spec.cart.freeShippingThreshold !== null ? 0.05 : 0) - (spec.cart.upsell ? 0.1 : 0);
  const order =
    0.35 +
    (spec.cart.showShippingUpfront ? 0.35 : 0) +
    (spec.checkout.guestCheckout ? 0.1 : 0) +
    (spec.checkout.steps === 1 ? 0.05 : 0) +
    (spec.checkout.expressPay ? 0.03 : 0);
  return { browse: Math.min(browse, 0.95), add: Math.max(0.02, add), checkout, order: Math.min(order, 0.95) };
}

/**
 * Each agent's brief needs some facts (probability per field). If the agent surface hides one, the agent
 * reports it in `agent_request.properties.missing` (same names as agent-commerce) and usually abandons.
 */
export const AGENT_NEEDS = [
  { field: "deliveryEtaDays", p: 0.7, exposed: (s: PageSpec) => s.agentSurface.exposeDeliveryEta, reason: "no delivery ETA exposed" },
  { field: "returnPolicy", p: 0.35, exposed: (s: PageSpec) => s.agentSurface.exposeReturnPolicy, reason: "no return policy exposed" },
  { field: "stock", p: 0.3, exposed: (s: PageSpec) => s.agentSurface.exposeStock, reason: "no stock levels exposed" },
  { field: "landedPrice", p: 0.3, exposed: (s: PageSpec) => s.agentSurface.exposeLandedPrice, reason: "no landed price exposed" },
] as const;

/** Chance an agent whose brief is fully satisfiable completes the purchase. */
export function fakeAgentBuyRate(spec: PageSpec): number {
  return 0.6 + (spec.agentSurface.negotiation.enabled ? 0.1 : 0);
}

export function createFakeSimulator() {
  let calls = 0;
  return async function fakeSimulate(opts: SimulationOptions): Promise<SimulationResult> {
    calls += 1;
    const rng = mulberry32((opts.seed ?? 0) * 31 + calls);
    const batch = `${opts.seed ?? 0}_${calls}`;
    const events: AnalyticsEventInput[] = [];
    const byVariant: SimulationResult["byVariant"] = {};
    let orders = 0;
    let revenue = 0;

    const visit = (distinctId: string, kind: "human" | "agent") => {
      const resolved = resolveSpecForVisitor(distinctId);
      const base = {
        visitor_kind: kind,
        synthetic: true,
        $session_id: `s_${distinctId}`,
        ...attributionProps(resolved),
        ...(kind === "agent" ? { agent_name: "fake-shopper" } : {}),
      };
      const emit = (event: string, extra: Record<string, unknown> = {}) =>
        events.push({ event, distinct_id: distinctId, properties: { ...base, ...extra } });
      const variant = resolved.variant ?? "live";
      byVariant[variant] ??= { visitors: 0, orders: 0 };
      byVariant[variant].visitors += 1;

      let bought = false;
      if (kind === "human") {
        const f = fakeHumanFunnel(resolved.spec);
        emit("$pageview", { $pathname: "/store" });
        if (rng() < f.browse) {
          emit("product_viewed", { product_id: "p_aurora", price: 11500 });
          if (rng() < f.add) {
            emit("product_added", { product_id: "p_aurora", price: 11500, quantity: 1 });
            if (rng() < f.checkout) {
              emit("checkout_started");
              if (rng() < f.order) bought = true;
            }
          }
        }
      } else {
        const spec = resolved.spec;
        const missing = AGENT_NEEDS.filter((n) => rng() < n.p && !n.exposed(spec));
        emit("agent_request", { tool: "search_products", ok: true });
        emit("agent_request", {
          tool: "get_product",
          ok: true,
          product_id: "p_aurora",
          ...(missing.length ? { missing: missing.map((m) => m.field) } : {}),
        });
        if (missing.length && rng() < 0.9) {
          emit("agent_abandoned", { reason: `${missing[0].reason}; can't verify the brief` });
        } else if (rng() < fakeAgentBuyRate(spec)) {
          emit("product_viewed", { product_id: "p_aurora", price: 11500 });
          emit("product_added", { product_id: "p_aurora", price: 11500, quantity: 1 });
          emit("checkout_started");
          bought = true;
        } else {
          emit("agent_abandoned", { reason: "found a better match elsewhere" });
        }
      }
      if (bought) {
        emit("order_completed", { revenue: 11500 });
        orders += 1;
        revenue += 11500;
        byVariant[variant].orders += 1;
      }
    };

    for (let i = 0; i < opts.humans; i++) visit(`fh_${batch}_${i}`, "human");
    for (let i = 0; i < opts.agents; i++) visit(`fa_${batch}_${i}`, "agent");
    track(events);
    return { humans: opts.humans, agents: opts.agents, events: events.length, orders, revenue, byVariant };
  };
}
