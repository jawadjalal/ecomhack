"use client";

import { motion } from "motion/react";
import { CircleCheck, CircleHelp, CircleX, FlaskConical } from "lucide-react";
import type { Experiment, ExperimentResult, VariantStats } from "@/lib/contracts";
import { count, pct, signedPct } from "@/lib/console/format";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { cn } from "@/components/ui/cn";
import { ThinkingCards } from "./diagnose";

const SHIP_THRESHOLD = 0.95;

/* ------------------------------------------------------------------ gauge */

export function ProbabilityGauge({ p, size = "lg" }: { p: number; size?: "lg" | "sm" }) {
  const R = 40;
  const half = Math.PI * R;
  const color = p >= SHIP_THRESHOLD ? "#b6f05a" : p >= 0.8 ? "#e7f59a" : p <= 0.2 ? "#f05252" : "#aab2c5";
  // angle of the ship threshold on the half circle (0 = right end, π = left end)
  const tA = Math.PI * (1 - SHIP_THRESHOLD);
  const tx1 = 50 + (R - 7) * Math.cos(tA);
  const ty1 = 50 - (R - 7) * Math.sin(tA);
  const tx2 = 50 + (R + 7) * Math.cos(tA);
  const ty2 = 50 - (R + 7) * Math.sin(tA);
  return (
    <div className={cn("relative", size === "lg" ? "w-full max-w-[20rem]" : "w-[9rem]")}>
      <svg viewBox="0 0 100 58" className="w-full overflow-visible">
        <defs>
          <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <path d={`M ${50 - R} 50 A ${R} ${R} 0 0 1 ${50 + R} 50`} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={7} strokeLinecap="round" />
        <motion.path
          d={`M ${50 - R} 50 A ${R} ${R} 0 0 1 ${50 + R} 50`}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={half}
          initial={{ strokeDashoffset: half }}
          animate={{ strokeDashoffset: half * (1 - p), stroke: color }}
          transition={{ type: "spring", stiffness: 50, damping: 16 }}
          filter={p >= SHIP_THRESHOLD ? "url(#gauge-glow)" : undefined}
          opacity={p >= SHIP_THRESHOLD ? 0.7 : 0}
        />
        <motion.path
          d={`M ${50 - R} 50 A ${R} ${R} 0 0 1 ${50 + R} 50`}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={half}
          initial={{ strokeDashoffset: half }}
          animate={{ strokeDashoffset: half * (1 - p), stroke: color }}
          transition={{ type: "spring", stiffness: 50, damping: 16 }}
        />
        {/* 95% threshold tick */}
        <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke="white" strokeOpacity={0.7} strokeWidth={0.8} />
        <text x={tx2 + 1.5} y={ty2 - 1} className="fill-white/50" style={{ fontSize: 4 }}>
          95%
        </text>
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <div
          className={cn("leading-none font-semibold tracking-[-0.03em] tabular", size === "lg" ? "text-[3.6rem]" : "text-[1.8rem]")}
          style={{ color: p >= SHIP_THRESHOLD ? "#d4ff94" : "white" }}
        >
          <AnimatedNumber value={p * 100} format={(v) => `${v.toFixed(0)}%`} />
        </div>
      </div>
    </div>
  );
}

/** Optional `audience` (beyond the base contract): agent-only changes are measured on agents. */
function measuredOn(r: ExperimentResult): string | undefined {
  const a = (r as ExperimentResult & { audience?: string }).audience;
  return a === "agent" ? "AI agents" : a === "human" ? "humans" : undefined;
}

/* ------------------------------------------------------------------ arms */

function ArmBar({ stats, tone, max, label }: { stats: VariantStats; tone: "control" | "treatment"; max: number; label: string }) {
  const color = tone === "control" ? "#8b93a7" : "#b6f05a";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-[1.4rem] items-center justify-center rounded-md text-[0.76rem] font-bold",
              tone === "control" ? "bg-control/25 text-white/85" : "bg-brand text-[#0b1200]",
            )}
          >
            {tone === "control" ? "A" : "B"}
          </span>
          <span className="text-[0.95rem] font-medium text-white/80">{label}</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-[0.78rem] text-white/40 tabular">
            {count(stats.conversions)} / {count(stats.visitors)}
          </span>
          <span className="text-[1.9rem] leading-none font-semibold text-white tabular">
            <AnimatedNumber value={stats.conversionRate * 100} format={(v) => `${v.toFixed(1)}%`} />
          </span>
        </div>
      </div>
      <div className="relative h-[1.6rem] overflow-hidden rounded-md bg-white/[0.04]">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-r-md"
          style={{ background: tone === "control" ? color : `linear-gradient(90deg, #7fcf3a, ${color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${max > 0 ? (stats.conversionRate / max) * 100 : 0}%` }}
          transition={{ type: "spring", stiffness: 70, damping: 18 }}
        />
      </div>
    </div>
  );
}

function KindRow({ result, kind }: { result: ExperimentResult; kind: "human" | "agent" }) {
  const c = result.control.byKind[kind];
  const t = result.treatment.byKind[kind];
  const lift = c.conversionRate > 0 ? (t.conversionRate - c.conversionRate) / c.conversionRate : undefined;
  const digits = kind === "human" ? 1 : 0;
  return (
    <div className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-[0.85rem]">
      <span>{kind === "human" ? "🧑" : "🤖"}</span>
      <span className="w-[4.5rem] text-white/60">{kind === "human" ? "Humans" : "Agents"}</span>
      <span className="text-white/50 tabular">{pct(c.conversionRate, digits)}</span>
      <span className="text-white/25">→</span>
      <span className="font-semibold text-white tabular">{pct(t.conversionRate, digits)}</span>
      <span className="ml-auto text-[0.75rem] text-white/35 tabular">{count(c.visitors + t.visitors)} visitors</span>
      {lift !== undefined && (
        <span className={cn("w-[3.6rem] text-right font-semibold tabular", lift >= 0 ? "text-[#7ee2a0]" : "text-[#ff9b9b]")}>{signedPct(lift)}</span>
      )}
    </div>
  );
}

function LiftInterval({ result }: { result: ExperimentResult }) {
  const [lo, hi] = result.liftInterval;
  const span = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(result.lift), 0.1) * 1.15;
  const pos = (v: number) => `${50 + (v / span) * 50}%`;
  return (
    <div className="w-full max-w-[20rem]">
      <div className="mb-1 flex items-baseline justify-between text-[0.76rem] text-white/45">
        <span>Lift, 95% interval</span>
        <span className="text-[1.3rem] font-semibold text-white tabular">{signedPct(result.lift)}</span>
      </div>
      <div className="relative h-[1.3rem]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute top-0 bottom-0 w-px bg-white/35" style={{ left: "50%" }} />
        <motion.div
          className="absolute top-1/2 h-[0.45rem] -translate-y-1/2 rounded-full bg-brand/40"
          initial={false}
          animate={{ left: pos(Math.min(lo, hi)), width: `${(Math.abs(hi - lo) / span) * 50}%` }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
        />
        <motion.div
          className="absolute top-1/2 size-[0.8rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand ring-2 ring-[#0b0d12]"
          initial={false}
          animate={{ left: pos(result.lift) }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
        />
      </div>
      <div className="flex justify-between text-[0.68rem] text-white/35 tabular">
        <span>{signedPct(lo)}</span>
        <span>0</span>
        <span>{signedPct(hi)}</span>
      </div>
    </div>
  );
}

export function ExperimentStage({ experiment, compact }: { experiment?: Experiment; compact?: boolean }) {
  const r = experiment?.result;
  if (!experiment || !r) return <ThinkingCards label="Setting up the A/B test…" n={2} />;
  const max = Math.max(r.control.conversionRate, r.treatment.conversionRate, 0.0001) * 1.08;
  const total = r.control.visitors + r.treatment.visitors;
  return (
    <div className={cn("grid h-full min-h-0 gap-6", compact ? "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]")}>
      <div className="flex min-h-0 flex-col gap-4">
        <div className="flex items-center gap-2 text-[0.85rem] whitespace-nowrap text-white/50">
          <FlaskConical className="size-4 shrink-0 text-brand" />
          <span className="min-w-0 truncate font-medium text-white/80" title={experiment.name}>
            {experiment.name}
          </span>
          <span>·</span>
          <span className="tabular">
            {Math.round((1 - experiment.allocation) * 100)}/{Math.round(experiment.allocation * 100)}
          </span>
          <span>·</span>
          <span className="tabular">{count(total)} visitors</span>
          {measuredOn(r) && <span className="rounded-md bg-agent/15 px-1.5 text-[0.72rem] text-[#f5a6cb]">measured on {measuredOn(r)}</span>}
          {experiment.status === "running" && (
            <span className="ml-auto flex items-center gap-1.5 text-[0.75rem] text-brand">
              <span className="size-1.5 rounded-full bg-brand pulse-dot" /> live
            </span>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <ArmBar stats={r.control} tone="control" max={max} label={`Control · spec v${experiment.controlVersion}`} />
          <ArmBar stats={r.treatment} tone="treatment" max={max} label="Treatment · proposal" />
        </div>
        <div className="flex flex-col gap-1.5">
          <KindRow result={r} kind="human" />
          <KindRow result={r} kind="agent" />
        </div>
        {!compact && (
          <div className="mt-auto text-[0.72rem] leading-relaxed text-white/30">
            Bayesian Beta-Binomial on order_completed per visitor · sticky 50/50 assignment for humans and agents · ships at P ≥ 95%
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-col items-center justify-center gap-4">
        <ProbabilityGauge p={r.probabilityToBeat} size={compact ? "sm" : "lg"} />
        <div className="-mt-2 text-center text-[0.8rem] text-white/45">P(treatment beats control)</div>
        {!compact && <LiftInterval result={r} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ decide */

const VERDICT = {
  ship: { label: "Ship it", icon: CircleCheck, cls: "border-brand/40 from-brand/20 via-brand/[0.06] to-transparent text-brand", word: "SHIP" },
  reject: { label: "Reject", icon: CircleX, cls: "border-bad/40 from-bad/20 via-bad/[0.06] to-transparent text-[#ff9b9b]", word: "REJECT" },
  inconclusive: {
    label: "Inconclusive",
    icon: CircleHelp,
    cls: "border-warn/40 from-warn/20 via-warn/[0.06] to-transparent text-[#ffd27a]",
    word: "INCONCLUSIVE",
  },
} as const;

export function DecideStage({ experiment }: { experiment?: Experiment }) {
  const r = experiment?.result;
  if (!experiment || !r || r.decision === "running") return <ExperimentStage experiment={experiment} />;
  const v = VERDICT[r.decision];
  const Icon = v.icon;
  const sentence =
    r.decision === "ship"
      ? `Treatment wins: ${signedPct(r.lift)} conversion with ${pct(r.probabilityToBeat, 0)} probability of beating control.`
      : r.decision === "reject"
        ? `Treatment loses (${signedPct(r.lift)}, P(beat) ${pct(r.probabilityToBeat, 0)}). Darwin keeps the current store.`
        : `Not enough evidence either way (P(beat) ${pct(r.probabilityToBeat, 0)}). Nothing ships.`;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        className={cn("flex items-center gap-5 rounded-2xl border bg-gradient-to-r px-6 py-4", v.cls)}
      >
        <motion.div initial={{ rotate: -30, scale: 0.4 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}>
          <Icon className="size-[3.2rem]" strokeWidth={2.2} />
        </motion.div>
        <div className="min-w-0">
          <div className="text-[2.6rem] leading-none font-bold tracking-[-0.02em]">{v.word}</div>
          <div className="mt-1.5 text-[0.95rem] text-white/70">{sentence}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[0.7rem] tracking-[0.14em] text-white/40 uppercase">95% interval</div>
          <div className="text-[1.05rem] font-semibold text-white/85 tabular">
            {signedPct(r.liftInterval[0])} … {signedPct(r.liftInterval[1])}
          </div>
        </div>
      </motion.div>
      <div className="min-h-0 flex-1">
        <ExperimentStage experiment={experiment} compact />
      </div>
    </div>
  );
}
