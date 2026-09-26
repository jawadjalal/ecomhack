"use client";

/**
 * Motion helpers for the Overview: staggered card entrance, count-up numbers, pills that grow in, and the
 * black pill tooltip. Everything settles instantly under prefers-reduced-motion.
 */
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { cn } from "@/components/ui/cn";

export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Card entrance: fade + rise, staggered by `i`. */
export function Rise({ i = 0, className, style, children }: { i?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE, delay: 0.05 + i * 0.07 }}
    >
      {children}
    </motion.div>
  );
}

export type CountFormat = "pct" | "int" | "mult" | "lift";

function fmt(v: number, format: CountFormat, digits?: number): string {
  switch (format) {
    case "pct": {
      const p = v * 100;
      const d = digits ?? (p < 10 ? 1 : 0);
      return `${p.toFixed(d)}%`;
    }
    case "mult":
      return `${v.toFixed(1)}×`;
    case "lift": {
      const p = Math.round(v * 100);
      return `${p >= 0 ? "+" : "−"}${Math.abs(p)}%`;
    }
    default:
      return new Intl.NumberFormat("en-GB").format(Math.round(v));
  }
}

/** A number that counts up to `value` (and glides to new values as data refreshes). */
export function CountUp({ value, format = "int", digits, className }: { value: number; format?: CountFormat; digits?: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => fmt(v, format, digits));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.9, ease: EASE });
    return () => c.stop();
  }, [value, reduce, mv]);
  return (
    <motion.span className={cn("num", className)} aria-label={fmt(value, format, digits)}>
      {text}
    </motion.span>
  );
}

/** A pill that grows from 0 to its size (vertical by default). */
export function Grow({
  size,
  axis = "y",
  delay = 0,
  className,
  style,
}: {
  size: number | string;
  axis?: "x" | "y";
  delay?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const reduce = useReducedMotion();
  const prop = axis === "y" ? "height" : "width";
  return (
    <motion.span
      className={cn("block", className)}
      style={style}
      initial={reduce ? false : { [prop]: 0 }}
      animate={{ [prop]: size }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    />
  );
}

/** Black pill tooltip shown when the parent `.group` is hovered or focused. */
export function Tip({ children, align = "center", className }: { children: ReactNode; align?: "center" | "right"; className?: string }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-[calc(100%+8px)] z-20 translate-y-1 rounded-full bg-dw-ink px-2.5 py-1 text-[12px] whitespace-nowrap text-white opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
        align === "center" ? "left-1/2 -translate-x-1/2" : "right-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
