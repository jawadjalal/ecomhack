"use client";

import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "../mascot";
import { DEPTH_SM } from "../ui";

/**
 * A calm, fixed-height status line for the loop pages ("Iris is re-checking with fresh shoppers…").
 * Always rendered, only its words change, so the page never jumps when the loop moves phase.
 */
export function StatusPill({ who, live, children }: { who: MascotKind; live: boolean; children: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      title={children}
      className={cn("inline-flex h-9 max-w-[calc(100vw-32px)] min-w-0 items-center gap-2 rounded-full bg-dw-surface pr-3.5 pl-1.5 text-[13px] font-medium text-dw-ink/80", DEPTH_SM)}
    >
      <Mascot kind={who} size={24} active={live} />
      <span className={cn("size-1.5 shrink-0 rounded-full", live ? "dw-live-dot bg-dw-live" : "bg-dw-ink/25")} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}
