"use client";

import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import type { MascotState } from "@/lib/mascot/state";
import { Mascot, type MascotKind } from "@/components/dw/mascot";

/** Simulated buyer personas get their own crew member, so the list reads at a glance. */
function personaMascot(name: string): MascotKind {
  const n = name.toLowerCase();
  if (/cautious/.test(n)) return "experimenter";
  if (/decisive/.test(n)) return "designer";
  if (/price/.test(n)) return "analyst";
  return "observer";
}

/**
 * A buyer agent's face: the assistant's official glyph when we know the brand (ChatGPT, Claude, Gemini…),
 * otherwise a framed crew mascot (you in the console, Darwin's simulated buyers, unknown agents).
 */
export function BuyerAvatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const brand = agentBrand(name);
  if (brand.glyph) return <AgentTile brand={brand} size={size} className={className} />;
  return <Mascot kind={personaMascot(name)} size={size} frame active={false} title={name} className={className} />;
}

/** The store agent itself: the green shipper, framed in glass. */
export function StoreAvatar({ size = 34, active = true, state }: { size?: number; active?: boolean; state?: MascotState }) {
  return <Mascot kind="shipper" size={size} frame state={state ?? (active ? "working" : "idle")} title="Your store agent" />;
}
