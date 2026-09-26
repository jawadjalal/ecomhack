/**
 * Dashboard tabs, client-safe (no server imports): which tab each card shows in, and the tab list.
 */
import type { DashboardSpec } from "@/lib/contracts";

export const BOARDS = ["Overview", "Checkout", "AI agents", "Your charts"] as const;

const CHECKOUT_EVENT = /checkout|order|cart|payment|coupon|purchase/i;

/** Which built-in tabs a card shows in. Deterministic from its kind, events and who asked for it. */
export function boardsFor(d: Pick<DashboardSpec, "kind" | "events" | "custom" | "board">): string[] {
  if (d.board) return [d.board];
  if (d.custom) return ["Your charts"];
  const out = ["Overview"];
  if (d.kind === "funnel" || d.kind === "revenue" || d.kind === "time_to_convert" || d.kind === "kpis" || (d.events ?? []).some((e) => CHECKOUT_EVENT.test(e))) out.push("Checkout");
  if (d.kind === "humans-agents" || d.kind === "sources" || d.kind === "kpis" || (d.events ?? []).includes("agent_visit")) out.push("AI agents");
  return out;
}

/** Every tab a plan has: the built-in four, then the merchant's own named dashboards in the order made. */
export function boardNames(dashboards: readonly Pick<DashboardSpec, "board">[]): string[] {
  const own = [...new Set(dashboards.map((d) => d.board).filter((b): b is string => !!b && !(BOARDS as readonly string[]).includes(b)))];
  return [...BOARDS, ...own];
}

