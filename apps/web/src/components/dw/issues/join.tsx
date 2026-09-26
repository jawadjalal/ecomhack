"use client";

import { motion } from "motion/react";

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
