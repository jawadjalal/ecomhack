"use client";

import { cn } from "@/components/ui/cn";
import { AgentTile, agentBrand } from "../agent-tile";
import type { IssueRow } from "./model";

/** A simple person silhouette (head and shoulders) for human shoppers. Solid shape, no outline. */
export function PersonSilhouette({ size = 20, color = "currentColor", className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
      <circle cx="12" cy="7.6" r="4.6" fill={color} />
      <path d="M2.6 23c0-5.6 4.2-9.4 9.4-9.4s9.4 3.8 9.4 9.4z" fill={color} />
    </svg>
  );
}

/** A small crowd of people silhouettes, for the "people" summary tile. */
export function PeopleGroup({ color = "#141413", size = 44 }: { color?: string; size?: number }) {
  return (
    <span className="relative inline-flex items-end" style={{ width: size * 1.55, height: size }}>
      <PersonSilhouette size={size * 0.72} color={color} className="absolute bottom-0 left-0 opacity-35" />
      <PersonSilhouette size={size * 0.72} color={color} className="absolute right-0 bottom-0 opacity-35" />
      <PersonSilhouette size={size * 0.92} color={color} className="absolute bottom-0 left-1/2 -translate-x-1/2 opacity-80" />
    </span>
  );
}

const STACK = ["chatgpt", "claude", "gemini"].map((n) => agentBrand(n));

/** Three overlapping AI brand tiles: "AI shopping agents". */
export function AgentStack({ size = 30 }: { size?: number }) {
  return (
    <span className="inline-flex items-center">
      {STACK.map((b, i) => (
        <span key={b.key} className="relative" style={{ marginLeft: i ? -size * 0.32 : 0, zIndex: STACK.length - i }}>
          <AgentTile brand={b} size={size} />
        </span>
      ))}
    </span>
  );
}

/** Tiny mark in front of "People · on the home page": a person silhouette or a single AI tile. */
export function WhoMark({ who, size = 14 }: { who: IssueRow["who"]; size?: number }) {
  if (who === "Agents") return <AgentTile brand={STACK[0]} size={size + 4} className="mr-0.5 align-[-4px]" />;
  if (who === "Everyone")
    return (
      <span className="mr-0.5 inline-flex items-end gap-px align-[-2px]" aria-hidden>
        <PersonSilhouette size={size} />
        <AgentTile brand={STACK[1]} size={size + 2} />
      </span>
    );
  return <PersonSilhouette size={size} className="mr-0.5 inline-block align-[-2px] opacity-70" />;
}

/** "AI agents" / "People" / "Everyone" for display. The row keeps its short `who` key. */
export function whoLabel(who: IssueRow["who"]): string {
  return who === "Agents" ? "AI agents" : who;
}
