"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "./cn";

/** Pill toggle with label, e.g. "Traffic ●". */
export function Toggle({
  on,
  onChange,
  label,
  hint,
  icon,
  disabled,
  tone = "brand",
  className,
  title,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: "brand" | "human";
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        "group inline-flex h-10 items-center gap-2.5 rounded-xl border pr-3 pl-2.5 text-[0.9rem] font-medium transition-colors duration-200 select-none disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/70",
        on
          ? tone === "brand"
            ? "border-brand/40 bg-brand/[0.1] text-white"
            : "border-human/40 bg-human/[0.1] text-white"
          : "border-white/[0.1] bg-white/[0.04] text-white/70 hover:bg-white/[0.07]",
        className,
      )}
    >
      <span
        className={cn(
          "relative flex h-[1.2rem] w-[2.1rem] items-center rounded-full p-[0.15rem] transition-colors duration-200",
          on ? (tone === "brand" ? "bg-brand" : "bg-human") : "bg-white/15",
        )}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 35 }}
          className={cn("size-[0.9rem] rounded-full shadow", on ? "ml-auto bg-[#0b1200]" : "bg-white/80")}
        />
      </span>
      {icon && <span className={cn("[&>svg]:size-[1rem]", on ? "text-white" : "text-white/50")}>{icon}</span>}
      <span>{label}</span>
      {hint}
    </button>
  );
}
