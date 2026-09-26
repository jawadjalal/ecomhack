"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { DEPTH, LOOP_SPLIT } from "../ui";

/**
 * Experiments and Changes use the shared loop-page frame from `ui.tsx` (PageHead, SummaryStrip,
 * LOOP_SPLIT, DEPTH). Their detail column sticks while the list scrolls, so the split aligns to the top.
 */
export const LIST_DETAIL = cn(LOOP_SPLIT, "items-start");

/** The list card on the left of the frame: title row + items. */
export function ListCard({ title, meta, children, label, className }: { title: ReactNode; meta?: ReactNode; children: ReactNode; label: string; className?: string }) {
  return (
    <section aria-label={label} className={cn("relative min-w-0 rounded-[28px] border border-dw-hairline bg-dw-surface p-4 sm:p-5", DEPTH, className)}>
      <div className="flex items-center gap-2.5 px-1.5 pb-3">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</h2>
        {meta && <span className="num ml-auto text-[12.5px] text-dw-ink/55">{meta}</span>}
      </div>
      {children}
    </section>
  );
}
