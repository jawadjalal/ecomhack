"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Silhouette, type MascotKind } from "../mascot";
import { TONE, type Tone } from "../ui";

/**
 * The shared loop-page frame for Experiments and Changes (brief v2): a crisp top highlight and a
 * soft contact shadow for depth, a slim summary strip, and list left / detail right.
 */
export const DEPTH = "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_1px_2px_rgba(20,20,19,0.06),0_14px_30px_-20px_rgba(20,20,19,0.35)]";

/** List left, detail right: the same widths and gap as Issues and Fixes. */
export const LIST_DETAIL = "grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]";

export interface StripCell {
  /** The number, `tabular-nums`. */
  value: ReactNode;
  label: ReactNode;
  /** Pastel meaning: yellow money, pink tests, blue agents, olive wins, lilac crew. */
  tone: Tone;
  /** A small silhouette in the swatch. */
  shape?: MascotKind;
  title?: string;
}

/** The slim summary strip: one row of 3 or 4 numbers, the same height on every loop page. */
export function SummaryStrip({ cells, label }: { cells: StripCell[]; label: string }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[28px] border border-dw-hairline bg-dw-hairline",
        cells.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4",
        DEPTH,
      )}
    >
      {cells.map((c, i) => (
        <div key={i} title={c.title} className={cn("flex min-h-[76px] min-w-0 items-center gap-3 bg-dw-surface px-4 py-3 sm:px-5", cells.length === 3 && i === 2 && "max-lg:col-span-2")}>
          <span aria-hidden className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-[14px]" style={{ background: TONE[c.tone].bg }}>
            {c.shape && <Silhouette kind={c.shape} color={TONE[c.tone].shape} size={52} style={{ right: -12, bottom: -14 }} />}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="num flex items-baseline gap-1.5 text-[20px] leading-tight font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums">{c.value}</span>
            <span className="truncate text-[12.5px] text-dw-ink/60">{c.label}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

/** A list card on the left of the frame: title row + items. */
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
