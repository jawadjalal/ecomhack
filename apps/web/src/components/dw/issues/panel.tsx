"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Silhouette, type MascotKind } from "../mascot";
import { TONE, usePlainSurface, type Tone } from "../ui";

const CORNER: Record<"tr" | "br" | "bl" | "tl", CSSProperties> = {
  tr: { right: -60, top: -80 },
  br: { right: -60, bottom: -90 },
  bl: { left: -70, bottom: -90 },
  tl: { left: -70, top: -80 },
};

/**
 * A pastel card like `Card`, but its content is a full-height flex column (so charts can sit on the
 * bottom edge) and it can be a link. Faint mascot silhouette in a corner, lifts on hover.
 */
export function Panel({
  tone,
  shape,
  corner = "tr",
  silhouette = 240,
  href,
  label,
  className,
  children,
  plain,
}: {
  tone: Tone;
  shape?: MascotKind;
  corner?: "tr" | "br" | "bl" | "tl";
  silhouette?: number;
  href?: string;
  label?: string;
  className?: string;
  children: ReactNode;
  plain?: boolean;
}) {
  const t = TONE[tone];
  const surface = usePlainSurface();
  const flat = plain ?? surface;
  const cls = cn(
    "relative isolate flex min-w-0 flex-col text-dw-ink",
    flat ? "bg-transparent" : "dw-card overflow-hidden rounded-[26px] px-[26px] py-[22px]",
    href && "outline-none focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:ring-offset-dw-bg",
    className,
  );
  const body = (
    <>
      {!flat && shape && <Silhouette kind={shape} color={t.shape} size={silhouette} style={{ ...CORNER[corner], zIndex: -1 }} />}
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-label={label} className={cls} style={flat ? undefined : { background: t.bg }}>
        {body}
      </Link>
    );
  }
  return (
    <section aria-label={label} className={cls} style={flat ? undefined : { background: t.bg }}>
      {body}
    </section>
  );
}

/** Ink tooltip pill that floats above its `group` parent on hover/focus. */
export function Tip({ children, className, align = "center" }: { children: ReactNode; className?: string; align?: "center" | "start" | "end" }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-[calc(100%+8px)] z-20 max-w-[240px] translate-y-1 truncate",
        align === "center" ? "left-1/2 -translate-x-1/2" : align === "start" ? "left-0" : "right-0",
        "rounded-full bg-dw-ink px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white opacity-0 shadow-[0_6px_16px_rgba(20,20,19,0.18)] transition-[opacity,transform] duration-200",
        "group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Loading shimmer block. */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[26px] bg-dw-sand/70", className)} />;
}
