"use client";

/**
 * Swap: crossfades a short piece of text when (and only when) its key changes. Polling re-renders with
 * the same key do nothing, so a live strip never flickers; a real change (Observing → Diagnosing) slides
 * the old words up and the new ones in, inside a box that keeps its size. Instant under reduced motion.
 */
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/components/ui/cn";

export function Swap({ k, children, className }: { k: string | number; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative grid overflow-hidden", className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={k}
          className="col-start-1 row-start-1 min-w-0"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: "0.45em" }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: "-0.45em" }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
