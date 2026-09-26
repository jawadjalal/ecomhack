/**
 * The gel button (ported from Wayari's `Gel`): a glossy capsule in pink (the next step), ghost (a
 * quiet alternative) or dark. A Next link when it has an `href`, a button otherwise. Height drives the
 * type size, so one component serves the 44px send button and the 56px hero door.
 */
"use client";

import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import "./gloss.css";

export type GelTone = "pink" | "ghost" | "dark";

type Common = {
  children: ReactNode;
  tone?: GelTone;
  /** Height in px. */
  h?: number;
  fontSize?: number;
  /** Icon-only: a circle as wide as it is tall. */
  round?: boolean;
  className?: string;
  style?: CSSProperties;
};

function gelProps({ tone = "pink", h = 48, fontSize, round, className, style }: Omit<Common, "children">) {
  return {
    className: cn("dw-gel font-dw", tone === "ghost" && "is-ghost", tone === "dark" && "is-dark", round && "is-round", className),
    style: { "--gel-h": `${h}px`, "--gel-fs": `${fontSize ?? Math.round(Math.max(13, h * 0.33))}px`, ...style } as CSSProperties,
  };
}

export function Gel({ children, tone, h, fontSize, round, className, style, ...rest }: Common & Omit<ComponentProps<"button">, "className" | "style" | "children">) {
  return (
    <button type="button" {...rest} {...gelProps({ tone, h, fontSize, round, className, style })}>
      <span className="dw-gel-gloss" aria-hidden />
      {children}
    </button>
  );
}

export function GelLink({ children, tone, h, fontSize, round, className, style, href, ...rest }: Common & { href: string } & Omit<ComponentProps<typeof Link>, "className" | "style" | "children" | "href">) {
  return (
    <Link href={href} {...rest} {...gelProps({ tone, h, fontSize, round, className, style })}>
      <span className="dw-gel-gloss" aria-hidden />
      {children}
    </Link>
  );
}
