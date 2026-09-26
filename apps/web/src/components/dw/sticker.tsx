/**
 * A die-cut sticker button (ported from Wayari's peel sticker): a white-edged label, pressed on at a
 * slight tilt, that lifts its top-right corner when you point at it. `flat` presses it down (the
 * thing it opens is open). Styles in gloss.css.
 */
"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import "./gloss.css";

export function Sticker({
  children,
  tilt = 0,
  flat,
  faceClassName,
  className,
  style,
  ...rest
}: {
  children: ReactNode;
  /** Degrees. */
  tilt?: number;
  flat?: boolean;
  faceClassName?: string;
  className?: string;
  style?: CSSProperties;
} & Omit<ComponentProps<"button">, "className" | "style" | "children">) {
  return (
    <button type="button" {...rest} className={cn("dw-stk is-peel", flat && "is-flat", className)} style={{ "--r": `${tilt}deg`, ...style } as CSSProperties}>
      <span className={cn("dw-stk-face", faceClassName)}>{children}</span>
      <span className="dw-stk-flap" aria-hidden />
    </button>
  );
}
