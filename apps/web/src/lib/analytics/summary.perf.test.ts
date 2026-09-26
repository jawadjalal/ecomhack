import { describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";
import { compareVariants, summarize } from "./summary";

/** 200k realistic events: ~17k humans (autocapture, funnels, pageleaves) and ~4k agents (tool calls). */
function generate(n: number): AnalyticsEvent[] {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const products = ["aurora-daily-trainer", "trailblazer", "tempo-racer", "summit-gtx", "stride-socks"];
  const tools = ["search_products", "get_product", "check_availability", "add_to_cart", "checkout"];
  const events: AnalyticsEvent[] = [];
  const t0 = Date.parse("2026-09-26T09:00:00.000Z");
  let i = 0;
  const push = (event: string, id: string, props: Record<string, unknown>) =>
    events.push({ uuid: `e${i}`, event, distinct_id: id, timestamp: new Date(t0 + i++ * 20).toISOString(), properties: props });

  let v = 0;
  while (events.length < n) {
    const agent = rnd() < 0.2;
    const id = `${agent ? "a" : "h"}_${v++}`;
    const variant = rnd() < 0.5 ? "control" : "treatment";
    const base = { visitor_kind: agent ? "agent" : "human", experiment_id: "exp_perf", variant, spec_version: 3, synthetic: true, $session_id: `s_${id}` };
    const product = products[Math.floor(rnd() * products.length)];
    const pdp = { ...base, $pathname: `/store/products/${product}`, $current_url: `http://localhost:3000/store/products/${product}` };
    if (agent) {
      const calls = 3 + Math.floor(rnd() * 8);
      for (let c = 0; c < calls; c++) {
        const tool = tools[Math.floor(rnd() * tools.length)];
        push("agent_request", id, { ...base, tool, ok: rnd() > 0.05, missing: rnd() < 0.4 ? ["delivery_eta"] : [] });
      }
      if (rnd() < 0.3) push("order_completed", id, { ...base, revenue: 11500 });
      else push("agent_abandoned", id, { ...base, reason: rnd() < 0.5 ? "no delivery ETA" : "over budget" });
    } else {
      push("$pageview", id, { ...base, $pathname: "/store" });
      push("product_viewed", id, { ...pdp, product_id: product });
      const clicks = Math.floor(rnd() * 5);
      for (let c = 0; c < clicks; c++) {
        push("$autocapture", id, {
          ...pdp,
          $event_type: "click",
          $elements_chain: `button.px-4.py-2.rounded:attr__class="px-4 py-2 rounded"attr__id="btn-${c < 3 ? 0 : 1}"nth-child="1"nth-of-type="1"text="Size guide";div.flex:nth-child="2"nth-of-type="1";main:nth-child="1"nth-of-type="1"`,
        });
      }
      if (rnd() < 0.5) {
        push("$pageleave", id, pdp);
        continue;
      }
      push("product_added", id, { ...pdp, price: 11500 });
      push("checkout_started", id, { ...base, $pathname: "/store/checkout" });
      push("shipping_cost_revealed", id, { ...base, $pathname: "/store/checkout", shipping: 495 });
      if (rnd() < 0.45) push("order_completed", id, { ...base, revenue: 11500 });
      else push("checkout_abandoned", id, { ...base, $pathname: "/store/checkout" });
    }
  }
  return events.slice(0, n);
}

/** Best of `runs` wall-clock timings (the machine may be shared; the first run is reported too). */
function time<T>(fn: () => T, runs = 3): { result: T; first: number; best: number } {
  let result!: T;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    result = fn();
    times.push(performance.now() - start);
  }
  return { result, first: times[0], best: Math.min(...times) };
}

describe("performance", () => {
  const events = generate(200_000);

  it("summarizes 200k events in well under 500ms (single pass)", () => {
    summarize(events.slice(0, 5000)); // JIT warm-up on a small slice
    const { result: s, first, best } = time(() => summarize(events));
    console.log(
      `summarize(200k): first ${first.toFixed(0)}ms, best ${best.toFixed(0)}ms — ${s.byKind.human.visitors} humans, ${s.byKind.agent.visitors} agents, ${s.friction.length} friction signals`,
    );
    expect(s.totalEvents).toBe(200_000);
    expect(s.friction.map((f) => f.kind)).toEqual(
      expect.arrayContaining(["shipping_shock", "dead_end", "rage_click", "agent_missing_field", "agent_abandoned", "agent_error"]),
    );
    expect(best).toBeLessThan(500);
  });

  it("filtered summary and compareVariants are fast too", () => {
    const filtered = time(() => summarize(events, { visitorKind: "agent", experimentId: "exp_perf", variant: "treatment" }));
    const cmp = time(() => compareVariants("exp_perf", {}, events));
    console.log(`filtered summarize(200k): best ${filtered.best.toFixed(0)}ms, compareVariants(200k): best ${cmp.best.toFixed(0)}ms`);
    expect(cmp.result.control.visitors + cmp.result.treatment.visitors).toBeGreaterThan(10_000);
    expect(filtered.best).toBeLessThan(500);
    expect(cmp.best).toBeLessThan(500);
  });
});
