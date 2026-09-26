/**
 * Darwin app primitives (cream design). Tokens live in globals.css (`bg-dw-*`, `font-dwmono`).
 *
 * Rules from the design owner:
 * - Never four equal boxes in a row: card rows are 1.7fr/1fr or 1fr/1.7fr.
 * - Human-readable copy, no eyebrow labels, headlines of two lines at most.
 * - Charts are ink only: solid black pills = series 1 (people / B), dashed outline = series 2 (agents / A).
 * - Things feel connected, not floating.
 */
"use client";

import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Silhouette, type MascotKind } from "./mascot";

export type Tone = "yellow" | "pink" | "olive" | "blue" | "lilac" | "white" | "sand";

export const TONE: Record<Tone, { bg: string; shape: string }> = {
  yellow: { bg: "#F6D76B", shape: "#EDC957" },
  pink: { bg: "#F3B5D5", shape: "#EDA5C9" },
  olive: { bg: "#A9B46E", shape: "#99A460" },
  blue: { bg: "#B8CAEE", shape: "#A8BCE7" },
  lilac: { bg: "#D5CCF5", shape: "#C7BCF0" },
  white: { bg: "#FFFDF8", shape: "#F3EBDC" },
  sand: { bg: "#EDE6D6", shape: "#E3DAC6" },
};

/** A pastel card with one big faint mascot silhouette bleeding off a corner. Lifts on hover. */
export function Card({
  tone = "white",
  shape,
  corner = "tr",
  className,
  style,
  children,
  as: As = "section",
  hover = true,
  ...rest
}: {
  tone?: Tone;
  shape?: MascotKind;
  corner?: "tr" | "br" | "bl" | "tl";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  as?: "section" | "div" | "article";
  hover?: boolean;
} & Omit<ComponentProps<"section">, "style" | "className" | "children" | "ref">) {
  const t = TONE[tone];
  const pos: Record<string, CSSProperties> = {
    tr: { right: -70, top: -80 },
    br: { right: -60, bottom: -90 },
    bl: { left: -70, bottom: -90 },
    tl: { left: -70, top: -80 },
  };
  return (
    <As
      {...rest}
      className={cn(
        "relative overflow-clip rounded-[26px] p-6",
        tone === "white" && "border border-dw-hairline",
        hover && "dw-card",
        className,
      )}
      style={{ background: t.bg, ...style }}
    >
      {shape && <Silhouette kind={shape} color={t.shape} size={250} style={pos[corner]} />}
      <div className="relative">{children}</div>
    </As>
  );
}

export function CardTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{children}</h2>
      {right && <div className="shrink-0 pt-1 text-[13px] text-dw-ink/70">{right}</div>}
    </div>
  );
}

/** Big number + small caps label ("5.2%" / "converts"). */
export function Stat({ value, label, active, className }: { value: ReactNode; label: ReactNode; active?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="num text-[20px] leading-tight font-semibold tracking-[-0.02em]">{value}</span>
      <span className={cn("mt-0.5 text-[12px] tracking-[0.02em] text-dw-ink/70 uppercase", active && "border-b-2 border-dw-ink pb-1.5 text-dw-ink")}>{label}</span>
    </div>
  );
}

/** Legend chip: 10px rounded square, solid (series 1) or dashed (series 2). */
export function LegendKey({ children, dashed, className }: { children: ReactNode; dashed?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] text-dw-ink/75", className)}>
      <span className={cn("size-2.5 rounded-[3px]", dashed ? "border border-dashed border-dw-ink" : "bg-dw-ink")} />
      {children}
    </span>
  );
}

/**
 * A vertical pill bar. `value` 0..1 of `max`; solid ink (series 1) or dashed outline (series 2).
 * Height is in px of the track. Shows a label above.
 */
export function PillBar({
  value,
  max = 1,
  height = 120,
  width = 30,
  dashed,
  label,
  title,
  className,
}: {
  value: number;
  max?: number;
  height?: number;
  width?: number;
  dashed?: boolean;
  label?: ReactNode;
  title?: string;
  className?: string;
}) {
  const h = Math.max(width, Math.round((Math.max(0, Math.min(value, max)) / (max || 1)) * height));
  return (
    <div className={cn("group relative flex flex-col items-center justify-end", className)} style={{ height: height + 22 }} title={title}>
      {label !== undefined && <span className="num mb-1.5 text-[12px] font-semibold">{label}</span>}
      <span
        className={cn("block rounded-full transition-colors", dashed ? "border-[1.5px] border-dashed border-dw-ink/80 group-hover:bg-dw-ink/10" : "bg-dw-ink group-hover:bg-black")}
        style={{ width, height: h }}
      />
    </div>
  );
}

/** Horizontal bar (leaderboards): solid or dashed. value 0..1. */
export function HBar({ value, dashed, className }: { value: number; dashed?: boolean; className?: string }) {
  return (
    <span className={cn("relative block h-3 flex-1", className)}>
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", dashed ? "border border-dashed border-dw-ink" : "bg-dw-ink")}
        style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }}
      />
    </span>
  );
}

/** Segmented control on sand (All / People / Agents). */
export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("inline-flex items-center gap-1 rounded-full bg-dw-sand p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors",
            o.value === value ? "bg-dw-ink text-dw-bg" : "text-dw-ink/70 hover:text-dw-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type ButtonTone = "ink" | "sand" | "white" | "ghost";
const BUTTON: Record<ButtonTone, string> = {
  ink: "bg-dw-ink text-white hover:bg-black",
  sand: "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
  white: "bg-white text-dw-ink shadow-[0_1px_0_rgba(20,20,19,0.06)] hover:bg-[#fffaf0]",
  ghost: "text-dw-ink/70 hover:text-dw-ink hover:bg-dw-sand",
};

/** Pill button. `href` renders a Link. */
export function PillButton({
  tone = "ink",
  size = "md",
  href,
  className,
  children,
  ...rest
}: { tone?: ButtonTone; size?: "sm" | "md" | "lg"; href?: string; className?: string; children: ReactNode } & Omit<ComponentProps<"button">, "className" | "children">) {
  const cls = cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium transition-[background-color,transform,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
    size === "sm" ? "h-8 px-3.5 text-[13px]" : size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-5 text-[14px]",
    BUTTON[tone],
    className,
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}

/** Small status pill: "In test B", "Drafted", "Missing data", "Bought", "Left" … */
export function Tag({ tone = "sand", children, className }: { tone?: "ink" | "sand" | "yellow" | "warn" | "win" | "pink" | "white" | "outline"; children: ReactNode; className?: string }) {
  const map = {
    ink: "bg-dw-ink text-white",
    sand: "bg-dw-sand text-dw-ink/75",
    yellow: "bg-dw-yellow text-dw-ink",
    warn: "bg-dw-warn-bg text-dw-warn",
    win: "bg-dw-win-bg text-dw-win",
    pink: "bg-dw-pink text-dw-ink",
    white: "bg-white text-dw-ink",
    outline: "border border-dw-ink/20 text-dw-ink/70",
  } as const;
  return <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap", map[tone], className)}>{children}</span>;
}

/** Test arm chip: a white rounded square with A or B. */
export function ArmChip({ arm, className }: { arm: "A" | "B" | string; className?: string }) {
  return (
    <span className={cn("inline-grid size-[18px] shrink-0 place-items-center rounded-[5px] text-[11px] font-semibold", arm === "B" ? "bg-dw-ink text-white" : "bg-white text-dw-ink", className)}>
      {arm}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cn("dw-live-dot inline-block size-2 shrink-0 rounded-full bg-dw-live", className)} />;
}

export function Typing() {
  return (
    <span className="dw-typing inline-flex items-center gap-1" aria-label="Darwin is thinking">
      <span className="size-1.5 rounded-full bg-dw-ink" />
      <span className="size-1.5 rounded-full bg-dw-ink" />
      <span className="size-1.5 rounded-full bg-dw-ink" />
    </span>
  );
}

/** Page heading: optional mascot, H1 46/600 (two lines max), one-line lede. */
export function PageHead({ mascot, title, lede, right }: { mascot?: ReactNode; title: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <h1 className="flex items-center gap-4 text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[46px]">
          {mascot}
          <span className="min-w-0">{title}</span>
        </h1>
        {lede && <p className="mt-3 max-w-[60rem] text-[17px] leading-snug text-dw-ink/75">{lede}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2.5">{right}</div>}
    </header>
  );
}

/** Empty state inside a card: mascot + one line + optional action. */
export function Empty({ mascot, children, action }: { mascot?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center text-[15px] text-dw-ink/70">
      {mascot}
      <p className="max-w-[28rem]">{children}</p>
      {action}
    </div>
  );
}

/** "12 seconds", "3 min", "2 h" */
export function humanDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

export const pct1 = (x: number | undefined | null) => (x === undefined || x === null || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(x < 0.1 ? 1 : x < 1 ? 1 : 0)}%`);
export const pct0 = (x: number | undefined | null) => (x === undefined || x === null || !Number.isFinite(x) ? "–" : `${Math.round(x * 100)}%`);
export const signed0 = (x: number | undefined | null) => (x === undefined || x === null || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`);
