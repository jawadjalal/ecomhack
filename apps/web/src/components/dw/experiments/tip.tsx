"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Hover / focus tooltip as a black pill (design rule: chart hovers show a black pill).
 * Wrap the trigger; the pill floats above it. Pure CSS, so it costs nothing while idle.
 */
export function Tip({
  tip,
  children,
  className,
  side = "top",
  align = "center",
  wide,
}: {
  tip: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom";
  /** Anchor the pill to the trigger's start or end edge (near card / screen edges) instead of centring it. */
  align?: "center" | "start" | "end";
  /** Allow wrapping for sentence-long tips. */
  wide?: boolean;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-30 rounded-full bg-dw-ink px-2.5 py-1 text-[12px] leading-snug font-medium text-white opacity-0 shadow-[0_8px_20px_-8px_rgba(20,20,19,0.5)] transition-[opacity,translate] duration-200 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100",
          side === "top" ? "bottom-[calc(100%+8px)] translate-y-1 group-focus-within/tip:translate-y-0 group-hover/tip:translate-y-0" : "top-[calc(100%+8px)] -translate-y-1 group-focus-within/tip:translate-y-0 group-hover/tip:translate-y-0",
          align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0",
          wide ? "w-max max-w-[17rem] rounded-[14px] px-3 py-2 text-left whitespace-normal" : "whitespace-nowrap",
        )}
      >
        {tip}
      </span>
    </span>
  );
}
