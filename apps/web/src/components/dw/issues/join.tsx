"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ChevronDown } from "lucide-react";

/** Distance from a list row's right edge to the detail panel: list padding (22) + border (1) + grid gap (14) + 1px overlap. */
export const JOIN = 38;

/**
 * The selected-row background. It slides between rows (shared layoutId) and, on wide screens, reaches
 * across the gap into the detail panel in the panel's colour, with two fillets smoothing the join.
 * On narrow screens it's a soft tint inside the list.
 */
export function JoinHighlight({ layoutId, color, soft }: { layoutId: string; color: string; soft: string }) {
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      transition={{ type: "spring", stiffness: 480, damping: 40 }}
      className="absolute inset-0 rounded-2xl bg-(--soft) lg:rounded-r-none lg:bg-(--join)"
      style={{ ["--join" as string]: color, ["--soft" as string]: soft }}
    >
      <span className="absolute inset-y-0 left-full hidden lg:block" style={{ width: JOIN, background: color }} />
      <span
        className="absolute hidden lg:block"
        style={{ right: -JOIN, top: -14, width: 14, height: 14, background: `radial-gradient(circle at 0 0, transparent 13.5px, ${color} 14px)` }}
      />
      <span
        className="absolute hidden lg:block"
        style={{ right: -JOIN, bottom: -14, width: 14, height: 14, background: `radial-gradient(circle at 0 100%, transparent 13.5px, ${color} 14px)` }}
      />
    </motion.span>
  );
}

/* ------------------------------------------------------------------ long lists */

/** Rows shown before "Show all", so the list and its detail panel stay about the same height. */
export const LIST_LIMIT = 8;

/** First `limit` items, or all of them once opened or when the selection sits below the fold. */
export function useCollapsed<T>(items: T[], selectedIndex: number, limit = LIST_LIMIT) {
  const [open, setOpen] = useState(false);
  const expanded = open || selectedIndex >= limit;
  const visible = expanded ? items : items.slice(0, limit);
  return {
    visible,
    hidden: items.length - visible.length,
    canCollapse: open && selectedIndex < limit && items.length > limit,
    toggle: () => setOpen((o) => !o),
  };
}

export function MoreButton({ hidden, canCollapse, noun, onClick }: { hidden: number; canCollapse: boolean; noun: string; onClick: () => void }) {
  if (!hidden && !canCollapse) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group mx-1 mt-1 inline-flex h-9 items-center gap-1.5 self-start rounded-full px-3.5 text-[13px] font-medium text-dw-ink/70 transition-colors outline-none hover:bg-dw-sand hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink"
    >
      <ChevronDown className={canCollapse ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform group-hover:translate-y-0.5"} aria-hidden />
      {hidden ? `Show ${hidden} more ${noun}` : "Show fewer"}
    </button>
  );
}
