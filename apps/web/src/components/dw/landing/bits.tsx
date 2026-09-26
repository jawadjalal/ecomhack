"use client";

/**
 * Small pieces the landing's sections share (ported from Wayari's scroll engine, rewritten with
 * motion/react): `Reveal` rises a block (always visible) as it crosses the fold, and `Sel` draws the pink selection
 * box behind one phrase of a heading once it reaches the eye line, a third of the way up the window.
 * Both sit under the landing's MotionConfig (reducedMotion="user"), so reduced motion drops the
 * movement and shows the finished state.
 */
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";

export const EASE = [0.2, 0.8, 0.2, 1] as const;

/**
 * A block that rises into place as it crosses the fold. Only the small y-offset animates: the block is fully
 * opaque at rest, so a full-page render that never scrolls (a link preview, a screenshot, an AI agent reading
 * the page) still shows every section instead of blank cream. Reduced motion (MotionConfig) skips the rise.
 */
export function Reveal({ children, delay = 0, y = 14, className, as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "li" | "article" | "header" }) {
  const Tag = as === "li" ? motion.li : as === "article" ? motion.article : as === "header" ? motion.header : motion.div;
  return (
    <Tag
      className={className}
      initial={{ y }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </Tag>
  );
}

/** One phrase of a heading in the pink selection box, drawn in from the left at the eye line. */
export function Sel({ children, tone = "pink", className }: { children: ReactNode; tone?: "pink" | "yellow" | "lilac" | "blue"; className?: string }) {
  const bg = tone === "yellow" ? "bg-dw-yellow" : tone === "lilac" ? "bg-dw-lilac" : tone === "blue" ? "bg-dw-blue" : "bg-dw-pink";
  return (
    <span className={cn("relative isolate inline-block whitespace-nowrap px-[0.14em]", className)}>
      <motion.span
        aria-hidden
        className={cn("absolute inset-x-0 inset-y-[0.06em] -z-10 rounded-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0.06em_0.2em_-0.08em_rgba(20,20,19,0.25)]", bg)}
        style={{ originX: 0 }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: "0px 0px -33% 0px" }}
        transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
      />
      {children}
    </span>
  );
}

/** A white die-cut rim around a crew member or a tile, the way Wayari's crew wear it on the desk. */
export const RIM = "rounded-full bg-white p-[3px] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset,0_1px_2px_rgba(20,20,19,0.12),0_8px_18px_-10px_rgba(20,20,19,0.35)]";

/** The card depth from the style brief: a crisp top highlight and a soft contact shadow. */
export const CARD =
  "rounded-[28px] bg-dw-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_0_0_1px_rgba(20,20,19,0.05),0_1px_2px_rgba(20,20,19,0.06),0_14px_30px_-20px_rgba(20,20,19,0.35)]";

/** Section headings: Wayari's t-h2, in Outfit. */
export const H2 = "text-[34px] leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-[44px] xl:text-[54px]";
