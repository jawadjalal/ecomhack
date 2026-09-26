"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-[#0b1200] hover:bg-[#c8f77c] shadow-[0_0_0_1px_rgba(182,240,90,0.4),0_8px_30px_-8px_rgba(182,240,90,0.55)] font-semibold",
  secondary: "bg-white/[0.06] text-white/90 border border-white/[0.1] hover:bg-white/[0.1] hover:border-white/[0.16]",
  ghost: "text-white/70 hover:text-white hover:bg-white/[0.06]",
  danger: "bg-bad/90 text-white hover:bg-bad",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8rem] gap-1.5 rounded-lg [&_svg]:size-[0.9rem]",
  md: "h-10 px-4 text-[0.9rem] gap-2 rounded-xl [&_svg]:size-[1rem]",
  lg: "h-12 px-6 text-[1rem] gap-2.5 rounded-xl [&_svg]:size-[1.1rem]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,border,color,box-shadow,transform] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand/70",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});
