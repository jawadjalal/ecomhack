"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, GitCompareArrows, GitPullRequest, TrendingUp } from "lucide-react";
import type { Experiment, ExperimentResult, GenerationRecord } from "@/lib/contracts";
import { pct, prNumberFromUrl, signedPct, type PrInfo } from "@/lib/console/format";
import { useMeasure } from "@/lib/console/hooks";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/components/ui/cn";

type Kind = "human" | "agent";
const SERIES: Record<Kind, { label: string; color: string; digits: number; key: "humanConversionRate" | "agentConversionRate" }> = {
  human: { label: "Humans · conversion", color: "#4c94f0", digits: 1, key: "humanConversionRate" },
  agent: { label: "AI agents · purchase rate", color: "#e0609a", digits: 0, key: "agentConversionRate" },
};

interface Candidate {
  human?: number;
  agent?: number;
  p: number;
}

function niceMax(v: number) {
  const steps = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
  return steps.find((s) => s >= v) ?? 1;
}

function Row({
  kind,
  history,
  candidate,
  width,
  height,
  hover,
  slots,
  padL,
  padR,
}: {
  kind: Kind;
  history: GenerationRecord[];
  candidate?: Candidate;
  width: number;
  height: number;
  hover: number | null;
  slots: number;
  padL: number;
  padR: number;
}) {
  const s = SERIES[kind];
  const values = history.map((h) => h[s.key]);
  const cand = candidate?.[kind];
  const max = niceMax(Math.max(0.001, ...values, cand ?? 0) * 1.3);
  const top = 30;
  const bottom = 6;
  const plotH = Math.max(10, height - top - bottom);
  const plotW = Math.max(10, width - padL - padR);
  const x = (i: number) => padL + (slots <= 1 ? plotW / 2 : (i / (slots - 1)) * plotW);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts.at(-1)![0].toFixed(1)},${top + plotH} L${pts[0][0].toFixed(1)},${top + plotH} Z` : "";
  const last = values.length - 1;
  const fmt = (v: number) => pct(v, s.digits);

  return (
    <g>
      {/* title */}
      <circle cx={padL + 4} cy={9} r={4} fill={s.color} />
      <text x={padL + 14} y={13} className="fill-white/60" style={{ fontSize: "0.72rem", fontWeight: 500, letterSpacing: "0.04em" }}>
        {s.label}
      </text>
      {/* grid: baseline + max */}
      <line x1={padL} x2={width - padR} y1={top + plotH} y2={top + plotH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      <line x1={padL} x2={width - padR} y1={top} y2={top} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      <text x={padL - 8} y={top + 4} textAnchor="end" className="fill-white/30 tabular" style={{ fontSize: "0.66rem" }}>
        {pct(max, 0)}
      </text>
      <text x={padL - 8} y={top + plotH + 3} textAnchor="end" className="fill-white/30 tabular" style={{ fontSize: "0.66rem" }}>
        0%
      </text>
      {pts.length > 0 && (
        <>
          <motion.path d={area} fill={s.color} fillOpacity={0.1} initial={false} animate={{ d: area }} transition={{ duration: 0.8, ease: "easeOut" }} />
          <motion.path
            d={line}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={false}
            animate={{ d: line }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </>
      )}
      {/* live candidate (experiment in progress) */}
      {cand !== undefined && pts.length > 0 && (
        <g>
          <line
            x1={pts[last][0]}
            y1={pts[last][1]}
            x2={x(last + 1)}
            y2={y(cand)}
            stroke={s.color}
            strokeOpacity={0.7}
            strokeWidth={2}
            strokeDasharray="4 5"
          />
          <motion.circle
            cx={x(last + 1)}
            cy={y(cand)}
            r={5}
            fill="#0b0d12"
            stroke={s.color}
            strokeWidth={2}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          <text x={x(last + 1)} y={y(cand) - 10} textAnchor="middle" className="fill-white/55 tabular" style={{ fontSize: "0.7rem", fontWeight: 600 }}>
            {fmt(cand)}?
          </text>
        </g>
      )}
      {pts.map(([px, py], i) => {
        const showLabel = i === 0 || i === last || hover === i;
        return (
          <g key={i}>
            <motion.circle
              cx={px}
              cy={py}
              initial={{ r: 0 }}
              animate={{ r: hover === i || i === last ? 6 : 4.5 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              fill={s.color}
              stroke="#0b0d12"
              strokeWidth={2.5}
            />
            {showLabel && (
              <text
                x={i === 0 ? px + 9 : px}
                y={i === 0 ? (py < top + plotH / 2 ? py + 17 : py - 9) : py - 11}
                textAnchor={i === 0 ? "start" : "middle"}
                className={cn("tabular", i === last ? "fill-white" : "fill-white/65")}
                style={{ fontSize: i === last ? "0.95rem" : "0.76rem", fontWeight: 600 }}
              >
                {fmt(values[i])}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function EvolutionChart({
  history,
  experiment,
  prs,
  onOpenPr,
  onCompare,
}: {
  history: GenerationRecord[];
  experiment?: Experiment;
  prs: Map<number, PrInfo>;
  onOpenPr: (generation: number) => void;
  /** Open the Gen 0 vs live comparison. */
  onCompare?: () => void;
}) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const r = experiment?.status === "running" ? experiment.result : undefined;
  // Only forecast the audience the change can affect (the other arm's gap is noise).
  const audience = (r as (ExperimentResult & { audience?: string }) | undefined)?.audience;
  const candidate: Candidate | undefined =
    r && r.treatment.visitors >= 60
      ? {
          human:
            audience !== "agent" && r.treatment.byKind.human.visitors >= 40 ? r.treatment.byKind.human.conversionRate : undefined,
          agent:
            audience !== "human" && r.treatment.byKind.agent.visitors >= 15 ? r.treatment.byKind.agent.conversionRate : undefined,
          p: r.probabilityToBeat,
        }
      : undefined;
  const slots = Math.max(4, history.length + (candidate ? 1 : 0));
  const padL = 44;
  const padR = 28;
  const axisH = 26;
  const rowH = Math.max(40, (size.height - axisH - 10) / 2);
  const plotW = Math.max(10, size.width - padL - padR);
  const x = (i: number) => padL + (slots <= 1 ? plotW / 2 : (i / (slots - 1)) * plotW);

  const first = history[0];
  const last = history.at(-1);
  const multiple = (k: "humanConversionRate" | "agentConversionRate") =>
    first && last && first[k] > 0 && history.length > 1 ? `${(last[k] / first[k]).toFixed(1)}×` : undefined;

  const prFor = (g: GenerationRecord) => {
    const pr = prs.get(g.generation);
    const url = g.prUrl ?? pr?.url;
    if (!url && !pr) return undefined;
    return { url, number: pr?.number ?? prNumberFromUrl(url), dryRun: pr?.dryRun ?? !url };
  };

  return (
    <Panel className="h-full">
      <PanelHeader
        icon={<TrendingUp />}
        title="Evolution · better outcomes by generation"
        right={
          history.length > 1 ? (
            <div className="flex items-center gap-3 text-[0.8rem] text-white/50">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-human" /> Humans <b className="font-semibold text-white tabular">{multiple("humanConversionRate")}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-agent" /> Agents <b className="font-semibold text-white tabular">{multiple("agentConversionRate")}</b>
              </span>
              {onCompare && (
                <button
                  onClick={onCompare}
                  title="Gen 0 vs the live store (B)"
                  className="flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 text-[0.74rem] font-medium text-white/75 hover:bg-white/[0.08] hover:text-white"
                >
                  <GitCompareArrows className="size-3.5 text-brand" /> Before / after <Kbd>B</Kbd>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-[0.8rem] text-white/45">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-human" /> Humans
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-agent" /> AI agents
              </span>
            </div>
          )
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-4 sm:flex-row">
        <div ref={ref} className="relative min-w-0 flex-[1.9]" onMouseLeave={() => setHover(null)}>
          {history.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.08] text-center">
              <div className="text-[0.95rem] text-white/55">Gen 0 baseline appears after the first observation</div>
              <div className="text-[0.8rem] text-white/30">Every shipped winner adds a point: humans on top, AI agents below.</div>
            </div>
          ) : (
            size.width > 0 && (
              <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible">
                {/* generation columns: annotations + hover targets */}
                {Array.from({ length: slots }, (_, i) => {
                  const g = history[i];
                  const isCandidate = !g && candidate && i === history.length;
                  return (
                    <g key={i}>
                      {g && g.generation > 0 && (
                        <line x1={x(i)} x2={x(i)} y1={4} y2={size.height - axisH + 4} stroke="rgba(182,240,90,0.18)" strokeDasharray="2 4" />
                      )}
                      <text
                        x={x(i)}
                        y={size.height - 6}
                        textAnchor={isCandidate && i === slots - 1 ? "end" : "middle"}
                        dx={isCandidate && i === slots - 1 ? 12 : 0}
                        className={cn(g ? (hover === i ? "fill-white" : "fill-white/55") : isCandidate ? "fill-brand/80" : "fill-white/20")}
                        style={{ fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.06em" }}
                      >
                        {g ? `G${g.generation}` : isCandidate ? `G${(last?.generation ?? 0) + 1} · testing` : `G${i}`}
                      </text>
                      {g && (
                        <rect
                          x={x(i) - plotW / Math.max(2, slots - 1) / 2}
                          y={0}
                          width={plotW / Math.max(2, slots - 1)}
                          height={size.height}
                          fill="transparent"
                          onMouseEnter={() => setHover(i)}
                        />
                      )}
                    </g>
                  );
                })}
                <g pointerEvents="none">
                  <Row kind="human" history={history} candidate={candidate} width={size.width} height={rowH} hover={hover} slots={slots} padL={padL} padR={padR} />
                  <g transform={`translate(0, ${rowH + 8})`}>
                    <Row kind="agent" history={history} candidate={candidate} width={size.width} height={rowH} hover={hover} slots={slots} padL={padL} padR={padR} />
                  </g>
                </g>
              </svg>
            )
          )}
        </div>

        {/* generation log */}
        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto scrollbar-thin">
          {history.length === 0 && <div className="text-[0.8rem] text-white/30">Shipped generations and their PRs land here.</div>}
          {[...history].reverse().map((g) => {
            const i = history.indexOf(g);
            const pr = prFor(g);
            return (
              <motion.div
                key={g.generation}
                layout
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-1.5 transition-colors",
                  hover === i ? "border-white/15 bg-white/[0.05]" : "border-white/[0.05] bg-white/[0.02]",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 min-w-[2.2rem] items-center justify-center rounded-lg px-1.5 text-[0.78rem] font-semibold tabular",
                    g.generation === 0 ? "bg-white/[0.06] text-white/60" : "bg-brand/15 text-brand",
                  )}
                >
                  G{g.generation}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.85rem] font-medium text-white/85">{g.label}</div>
                  <div className="flex items-center gap-2 text-[0.72rem] text-white/40 tabular">
                    <span className="text-[#9cc5ff]">{pct(g.humanConversionRate, 1)}</span>
                    <span className="text-[#f5a6cb]">{pct(g.agentConversionRate, 0)}</span>
                    {g.lift !== undefined && <span className="text-[#7ee2a0]">{signedPct(g.lift)} lift</span>}
                  </div>
                </div>
                {g.generation > 0 &&
                  (pr?.url ? (
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[0.72rem] font-medium text-white/75 hover:border-white/25 hover:text-white"
                    >
                      <GitPullRequest className="size-3.5" />#{pr.number ?? "PR"}
                      <ArrowUpRight className="size-3" />
                    </a>
                  ) : (
                    <button
                      onClick={() => onOpenPr(g.generation)}
                      className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[0.72rem] font-medium text-white/60 hover:border-white/25 hover:text-white"
                      title="Dry-run PR (no GitHub token): view the would-be PR"
                    >
                      <GitPullRequest className="size-3.5" />
                      {pr?.number ? `#${pr.number}` : "PR"}
                      <span className="text-white/35">dry</span>
                    </button>
                  ))}
              </motion.div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
