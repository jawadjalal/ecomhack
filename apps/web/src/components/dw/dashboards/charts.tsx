"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** The design's hover tooltip: a small black pill above the mark (parent needs `group relative`). */
export function Tip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 translate-y-1 rounded-full bg-dw-ink px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white opacity-0 shadow-[0_6px_16px_-6px_rgba(20,20,19,0.5)] transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A vertical pill whose dashed outline is the whole (e.g. everyone who started) and whose solid ink
 * fill is the part that made it: loss reads as the empty dashed space above the fill.
 */
export function TrackPill({
  value,
  max,
  height = 120,
  width = 30,
  label,
  tip,
  emphasis,
  className,
}: {
  value: number;
  max: number;
  height?: number;
  width?: number;
  label?: ReactNode;
  tip?: ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const fill = value > 0 ? Math.max(width * 0.6, Math.round(share * height)) : 0;
  return (
    <div className={cn("group relative flex flex-col items-center", className)} tabIndex={tip ? 0 : undefined}>
      {label !== undefined && <span className={cn("num mb-1.5 text-[13px] font-semibold", emphasis === false && "text-dw-ink/60")}>{label}</span>}
      <span
        className="relative block rounded-full border-[1.5px] border-dashed border-dw-ink/55 transition-colors group-hover:border-dw-ink"
        style={{ width, height }}
      >
        <span
          className="absolute inset-x-[-1.5px] bottom-[-1.5px] block rounded-full bg-dw-ink transition-[height,background-color] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:bg-black motion-reduce:transition-none"
          style={{ height: fill }}
        />
      </span>
      {tip && <Tip>{tip}</Tip>}
    </div>
  );
}

/** A solid (series 1) or dashed (series 2) vertical pill sized to value/max, label above. */
export function Pill({
  value,
  max,
  height = 120,
  width = 30,
  dashed,
  label,
  tip,
}: {
  value: number;
  max: number;
  height?: number;
  width?: number;
  dashed?: boolean;
  label?: ReactNode;
  tip?: ReactNode;
}) {
  const h = Math.max(width, Math.round((max > 0 ? Math.max(0, Math.min(1, value / max)) : 0) * height));
  return (
    <div className="group relative flex flex-col items-center justify-end" style={{ height: height + 24 }} tabIndex={tip ? 0 : undefined}>
      {label !== undefined && <span className="num mb-1.5 text-[13px] font-semibold">{label}</span>}
      <span
        className={cn(
          "block rounded-full transition-[height,background-color] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          dashed ? "border-[1.5px] border-dashed border-dw-ink/80 group-hover:bg-dw-ink/10" : "bg-dw-ink group-hover:bg-black",
        )}
        style={{ width, height: h }}
      />
      {tip && <Tip>{tip}</Tip>}
    </div>
  );
}

/**
 * Smooth midpoint-bézier line (the design's `line` builder) with a soft ink area and a live end dot.
 * `ring` is the card colour, so the dot looks punched out of it.
 */
export function SmoothLine({ values, height = 72, ring = "#FFFDF8", className, label }: { values: number[]; height?: number; ring?: string; className?: string; label?: string }) {
  const gid = useId().replace(/:/g, "");
  const W = 600;
  const H = 100;
  const n = values.length;
  if (n < 2) return <div style={{ height }} className={className} />;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (n - 1)) * W, 92 - (Math.max(0, v) / max) * 80] as const);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  let d = `M${r2(pts[0][0])},${r2(pts[0][1])}`;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${r2(mx)},${r2(y0)} ${r2(mx)},${r2(y1)} ${r2(x1)},${r2(y1)}`;
  }
  const last = pts[n - 1];
  const area = `${d} L${W},${H} L0,${H} Z`;
  return (
    <div className={cn("relative w-full", className)} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`dwl-${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#141413" stopOpacity="0.14" />
            <stop offset="1" stopColor="#141413" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#dwl-${gid})`} />
        <path d={d} fill="none" stroke="#141413" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        aria-hidden
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-dw-ink"
        style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%`, boxShadow: `0 0 0 4px ${ring}` }}
      />
    </div>
  );
}
