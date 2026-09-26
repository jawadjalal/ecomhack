"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ExperimentResult } from "@/lib/contracts";
import { count } from "@/lib/console/format";
import { Card, CardTitle, DEPTH, pct0 } from "../ui";
import { CARD_FILL, chance } from "./model";
import { Tip } from "./tip";

/* ------------------------------------------------------------------ chance B wins */

export interface ChancePoint {
  p: number;
  label: string;
}

const X_END = 880;
const n2 = (v: number) => Math.round(v * 100) / 100;

/** Smooth midpoint béziers (the design's `line` builder). */
function smooth(pts: [number, number][]): string {
  if (!pts.length) return "";
  let d = `M${n2(pts[0][0])},${n2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${n2(mx)},${n2(y0)} ${n2(mx)},${n2(y1)} ${n2(x1)},${n2(y1)}`;
  }
  return d;
}

const pctShip = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function ChanceCard({
  points,
  shipAt,
  early,
  drop,
  decided,
  live,
}: {
  points: ChancePoint[];
  shipAt: number;
  early: number;
  drop: number;
  /** "ship" / "reject" / "inconclusive" once decided. */
  decided?: ExperimentResult["decision"];
  live: boolean;
}) {
  const reduce = useReducedMotion();
  const now = points.at(-1)?.p ?? 0.5;
  const lo = Math.max(0, Math.min(0.5, ...points.map((p) => p.p)) - 0.06);
  const y = (p: number) => 6 + (1 - (Math.max(lo, p) - lo) / (1 - lo)) * 90;
  const xs = points.map((_, i) => (points.length > 1 ? (i / (points.length - 1)) * X_END : 0));
  const pts = points.map((p, i) => [xs[i], y(p.p)] as [number, number]);
  const line = smooth(pts);
  const area = pts.length > 1 ? `${line} L${n2(xs.at(-1)!)},100 L0,100 Z` : "";
  const verdict = decided === "ship" ? "Shipped" : decided === "reject" ? "Dropped" : decided === "inconclusive" ? "No clear winner" : undefined;

  return (
    <Card tone="pink" shape="experimenter" className={`h-full min-h-[262px] rounded-[28px] ${CARD_FILL} ${DEPTH}`} aria-label="Chance the new version is better">
      <CardTitle
        right={
          <Tip
            wide
            align="end"
            tip={
              early > shipAt
                ? `Ada ships the new version once she's ${pctShip(shipAt)} sure on the final look (${pctShip(early)} on earlier looks, so noise can't sneak a win) and drops it under ${pct0(drop)}.`
                : `Ada ships the new version once she's ${pctShip(shipAt)} sure and drops it under ${pct0(drop)}.`
            }
          >
            <span tabIndex={0} className="rounded-full text-[14px] text-[#5A2744] outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
              <span className="num text-[22px] font-semibold text-dw-ink">{chance(now)}</span> · {verdict ? verdict.toLowerCase() : `ships at ${pctShip(shipAt)}`}
            </span>
          </Tip>
        }
      >
        Chance it&apos;s better
      </CardTitle>

      <div className="relative mt-4 min-h-[120px] flex-1">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" role="img" aria-label={`Chance the new version is better: ${points.map((p) => chance(p.p)).join(", ")}`}>
          <defs>
            <linearGradient id="dw-exp-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#141413" stopOpacity="0.2" />
              <stop offset="1" stopColor="#141413" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" x2="1000" y1={y(shipAt)} y2={y(shipAt)} stroke="#141413" strokeWidth="1.5" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
          {lo < drop && <line x1="0" x2="1000" y1={y(drop)} y2={y(drop)} stroke="#141413" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />}
          {area && (
            <motion.path key="area" d={area} fill="url(#dw-exp-fill)" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.5 }} />
          )}
          {line && (
            <motion.path
              key="line"
              d={line}
              fill="none"
              stroke="#141413"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
            />
          )}
          {pts.length > 1 && <line x1={xs.at(-1)} x2={xs.at(-1)} y1={pts.at(-1)![1]} y2="100" stroke="#141413" strokeOpacity="0.18" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>

        {pts.map(([x, py], i) => {
          const last = i === pts.length - 1;
          if (!last && points.length > 8) return null;
          return (
            <span key={last ? "now" : i} className="absolute z-10 flex size-0 items-center justify-center transition-[left,top] duration-500" style={{ left: `${x / 10}%`, top: `${py}%` }}>
              <Tip tip={`${points[i].label} · ${chance(points[i].p)}`} align={i === 0 ? "start" : "center"} className="shrink-0">
                <motion.span
                  tabIndex={0}
                  aria-label={`${points[i].label}: ${chance(points[i].p)}`}
                  initial={reduce ? false : { scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.25 + (i / Math.max(1, pts.length - 1)) * 0.9, type: "spring", stiffness: 420, damping: 22 }}
                  className={
                    last
                      ? "relative block size-3.5 rounded-full bg-dw-ink shadow-[0_0_0_4px_#F3B5D5] outline-none focus-visible:ring-2 focus-visible:ring-dw-ink"
                      : "block size-2.5 rounded-full border-2 border-dw-ink bg-dw-pink outline-none hover:bg-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink"
                  }
                >
                  {last && live && <span className="dw-live-dot absolute inset-0 rounded-full" style={{ background: "transparent" }} />}
                </motion.span>
              </Tip>
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex justify-between gap-2 text-[12px] whitespace-nowrap text-[#5A2744]">
        {points.map((p, i) => {
          const last = i === points.length - 1;
          if (!last && points.length > 6 && i !== 0) return null;
          return (
            <span key={i} className={last ? "font-semibold text-dw-ink" : i === 0 ? "" : "max-sm:hidden"}>
              {last ? `${verdict ?? "Now"} · ${chance(p.p)}` : `${p.label} · ${chance(p.p)}`}
            </span>
          );
        })}
        <span>Ships · {pctShip(shipAt)}</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ who buys */

type Seg = { visitors: number; conversions: number; conversionRate: number };

function Pill({ seg, arm, max, delay, label, align }: { seg: Seg; arm: "A" | "B"; max: number; delay: number; label: string; align: "start" | "center" | "end" }) {
  const reduce = useReducedMotion();
  const H = 118;
  const h = seg.visitors ? Math.max(22, Math.round((seg.conversionRate / max) * H)) : 22;
  return (
    <Tip align={align} tip={seg.visitors ? `${label}, ${arm === "A" ? "current page" : "new version"}: ${count(seg.conversions)} of ${count(seg.visitors)} bought` : `${label}, ${arm === "A" ? "current page" : "new version"}: no shoppers yet`}>
      <span tabIndex={0} className="group/p flex flex-col items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
        <span className={arm === "B" ? "num text-[12px] font-semibold" : "num text-[12px] text-dw-ink/80"}>{seg.visitors ? `${(seg.conversionRate * 100).toFixed(seg.conversionRate < 0.1 ? 1 : 0)}%` : "–"}</span>
        <motion.span
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: h, opacity: 1 }}
          transition={{ delay, type: "spring", stiffness: 160, damping: 20 }}
          className={
            arm === "B"
              ? "block w-[22px] rounded-full bg-dw-ink transition-[filter] group-hover/p:brightness-75"
              : "block w-[22px] rounded-full border-[1.5px] border-dashed border-dw-ink transition-colors group-hover/p:bg-dw-ink/10"
          }
        />
      </span>
    </Tip>
  );
}

export function WhoBuysCard({ result, audience, synthetic }: { result?: ExperimentResult; audience: "all" | "human" | "agent"; synthetic: boolean }) {
  const groups: { key: "all" | "human" | "agent"; label: string; a: Seg; b: Seg }[] = result
    ? [
        { key: "all", label: "Everyone", a: result.control, b: result.treatment },
        { key: "human", label: "People", a: result.control.byKind.human, b: result.treatment.byKind.human },
        { key: "agent", label: "Agents", a: result.control.byKind.agent, b: result.treatment.byKind.agent },
      ]
    : [];
  return (
    <Card tone="blue" shape="observer" className={`h-full min-h-[262px] rounded-[28px] ${CARD_FILL} ${DEPTH}`} aria-label="Who buys, current page vs new version">
      <CardTitle
        right={
          <span className="flex items-center gap-3 text-[12px] text-[#2E3A55]">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-2 rounded-full border-[1.5px] border-dashed border-dw-ink" />Current
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-2 rounded-full bg-dw-ink" />New
            </span>
          </span>
        }
      >
        Who buys
      </CardTitle>
      {!result ? (
        <p className="mt-6 text-[14px] text-[#2E3A55]">The first shoppers are on their way. Buy rates show up after the first round.</p>
      ) : (
        <>
          <div className="mt-2 grid flex-1 grid-cols-3 items-end">
            {groups.map((g, i) => {
              const max = Math.max(g.a.conversionRate, g.b.conversionRate, 0.001) * 1.05;
              const judged = audience === g.key;
              return (
                <div key={g.key} className="flex flex-col items-center gap-2">
                  <div className="flex items-end gap-2.5">
                    <Pill seg={g.a} arm="A" max={max} delay={0.2 + i * 0.12} label={g.label} align={i === 0 ? "start" : i === 2 ? "end" : "center"} />
                    <Pill seg={g.b} arm="B" max={max} delay={0.28 + i * 0.12} label={g.label} align={i === 0 ? "start" : i === 2 ? "end" : "center"} />
                  </div>
                  <span className={judged ? "text-[13px] font-semibold text-dw-ink" : "text-[13px] text-[#2E3A55]"}>{g.label}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] text-[#2E3A55]">
            {audience === "all" ? "Judged on everyone" : audience === "agent" ? "Judged on agents: people never see this change" : "Judged on people: agents never see this change"}
            {synthetic ? " · simulated shoppers" : ""}
          </p>
        </>
      )}
    </Card>
  );
}
