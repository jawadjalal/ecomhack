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
import { createContext, useContext, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Silhouette, type MascotKind } from "./mascot";

/** Pages wrapped in this drop the pastel tile chrome (fill, radius, silhouette, lift). */
const PlainCtx = createContext(false);
export function PlainSurface({ children }: { children: ReactNode }) {
  return <PlainCtx.Provider value={true}>{children}</PlainCtx.Provider>;
}
export function usePlainSurface() {
  return useContext(PlainCtx);
}

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
  plain,
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
  /** No fill, radius, or silhouette. Defaults to the surrounding PlainSurface. */
  plain?: boolean;
} & Omit<ComponentProps<"section">, "style" | "className" | "children" | "ref">) {
  const t = TONE[tone];
  const surface = usePlainSurface();
  const flat = plain ?? surface;
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
        "relative",
        flat ? "bg-transparent" : "overflow-clip rounded-[26px] p-6",
        !flat && tone === "white" && "border border-dw-hairline",
        !flat && hover && "dw-card",
        className,
      )}
      style={flat ? style : { background: t.bg, ...style }}
    >
      {!flat && shape && <Silhouette kind={shape} color={t.shape} size={250} style={pos[corner]} />}
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

/** `yellow` is Darwin's own colour: his actions (let Darwin run, autopilot) use it. */
type ButtonTone = "ink" | "yellow" | "sand" | "white" | "ghost";
const BUTTON: Record<ButtonTone, string> = {
  ink: "bg-dw-ink text-white hover:bg-black",
  yellow: "bg-dw-yellow text-dw-ink hover:bg-dw-yellow-shape",
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

/* ------------------------------------------------------------------ loop-page frame (brief v2) */

/**
 * Depth without gradients or glows: a crisp top highlight plus a soft contact shadow.
 * Use on cards (`DEPTH`) and on small raised chips inside them (`DEPTH_SM`).
 */
export const DEPTH = "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_1px_2px_rgba(20,20,19,0.06),0_14px_30px_-20px_rgba(20,20,19,0.35)]";
export const DEPTH_SM = "shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(20,20,19,0.08),0_6px_14px_-10px_rgba(20,20,19,0.3)]";

/** The loop pages' two columns: list on the left, detail on the right. Same widths and gap on every page. */
export const LOOP_SPLIT = "grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]";

/** One number in the summary strip. Pastel fill carries meaning (yellow money, pink tests, blue agents, olive wins, lilac crew). */
export interface SummaryItem {
  key: string;
  tone: Tone;
  value: ReactNode;
  label: ReactNode;
  /** A silhouette, mascot or brand tiles shown on the right. */
  art?: ReactNode;
  href?: string;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
  /** Accessible name when the tile is a link or button. */
  ariaLabel?: string;
  title?: string;
}

/** The slim summary strip under PageHead: one row of 3 or 4 numbers, the same height on every loop page. */
export function SummaryStrip({ items, className }: { items: SummaryItem[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", items.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4", className)}>
      {items.map((it) => {
        const cls = cn(
          "relative isolate flex h-[92px] min-w-0 items-center gap-3 overflow-hidden rounded-[22px] px-4 text-left text-dw-ink outline-none sm:h-[100px] sm:px-[22px]",
          DEPTH,
          (it.href || it.onClick) && "dw-card focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:ring-offset-dw-bg",
        );
        const body = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="num truncate text-[26px] leading-none font-semibold tracking-[-0.02em] sm:text-[30px]">{it.value}</span>
              <span className="line-clamp-2 text-[12.5px] leading-snug text-dw-ink/70">{it.label}</span>
            </span>
            {it.art && <span className="relative hidden shrink-0 items-center sm:flex" aria-hidden>{it.art}</span>}
          </>
        );
        const style = { background: TONE[it.tone].bg };
        const hover = it.onHover ? { onMouseEnter: () => it.onHover?.(true), onMouseLeave: () => it.onHover?.(false), onFocus: () => it.onHover?.(true), onBlur: () => it.onHover?.(false) } : {};
        if (it.href) {
          return (
            <Link key={it.key} href={it.href} aria-label={it.ariaLabel} title={it.title} className={cls} style={style} {...hover}>
              {body}
            </Link>
          );
        }
        if (it.onClick) {
          return (
            <button key={it.key} type="button" onClick={it.onClick} aria-label={it.ariaLabel} title={it.title} className={cls} style={style} {...hover}>
              {body}
            </button>
          );
        }
        return (
          <div key={it.key} title={it.title} className={cls} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
