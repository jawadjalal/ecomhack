"use client";

import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";

/**
 * Pill switch in the Darwin style: ink track when on, faint ink when off, a white knob that springs across.
 * `busy` keeps it pressed-looking while a request is in flight.
 */
export function Switch({
  checked,
  onChange,
  label,
  size = "md",
  busy,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name (the visible row text usually repeats it). */
  label: string;
  size?: "md" | "lg";
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const d = size === "lg" ? { w: 66, h: 38, k: 30 } : { w: 48, h: 28, k: 22 };
  const pad = (d.h - d.k) / 2;
  const travel = d.w - d.k - pad * 2;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-[background-color,box-shadow] duration-300",
        "focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-dw-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]" : "bg-dw-ink/20 shadow-[inset_0_1px_2px_rgba(20,20,19,0.12)] hover:bg-dw-ink/30",
        className,
      )}
      style={{ width: d.w, height: d.h, padding: pad }}
    >
      <motion.span
        aria-hidden
        className="grid place-items-center rounded-full bg-white shadow-[0_1px_2px_rgba(20,20,19,0.25),0_3px_8px_rgba(20,20,19,0.12)]"
        style={{ width: d.k, height: d.k }}
        initial={false}
        animate={{ x: checked ? travel : 0, scale: busy ? 0.86 : 1 }}
        whileTap={{ scaleX: 1.12 }}
        transition={{ type: "spring", stiffness: 520, damping: 32, mass: 0.7 }}
      >
        {busy && <span className="size-2 animate-pulse rounded-full bg-dw-ink/40" />}
      </motion.span>
    </button>
  );
}
