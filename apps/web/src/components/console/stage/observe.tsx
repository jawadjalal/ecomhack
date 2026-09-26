"use client";

import { motion } from "motion/react";
import { Activity } from "lucide-react";
import type { AnalyticsSummary, FrictionSignal, SegmentKpis } from "@/lib/contracts";
import { count, pct } from "@/lib/console/format";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/components/ui/cn";

const STEP_LABELS = {
  human: ["Visited store", "Viewed product", "Added to bag", "Started checkout", "Ordered"],
  agent: ["Discovered (search)", "Read product data", "Added to cart", "Started checkout", "Purchased"],
};

function Funnel({ kind, seg }: { kind: "human" | "agent"; seg?: SegmentKpis }) {
  const color = kind === "human" ? "#4c94f0" : "#e0609a";
  const steps = seg?.funnel ?? [];
  const drops = steps.map((s, i) => (i === 0 ? 0 : 1 - s.rateFromPrevious));
  const worst = drops.reduce((w, d, i) => (d > drops[w] ? i : w), 1);
  const hasData = (seg?.visitors ?? 0) > 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-3 flex items-end justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[1.4rem]">{kind === "human" ? "🧑" : "🤖"}</span>
          <div>
            <div className="text-[1.05rem] font-semibold text-white">{kind === "human" ? "Humans" : "AI shopping agents"}</div>
            <div className="text-[0.78rem] text-white/40 tabular">{count(seg?.visitors ?? 0)} visitors</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[2rem] leading-none font-semibold tracking-tight tabular" style={{ color }}>
            {hasData ? pct(seg!.conversionRate, kind === "human" ? 1 : 0) : "–"}
          </div>
          <div className="text-[0.72rem] tracking-[0.12em] text-white/40 uppercase">convert</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-between gap-1.5">
        {STEP_LABELS[kind].map((label, i) => {
          const s = steps[i];
          const rate = s?.rateFromStart ?? 0;
          const isWorst = hasData && i === worst && drops[i] > 0.3;
          return (
            <div key={label} className="relative">
              {i > 0 && hasData && (
                <div
                  className={cn(
                    "absolute -top-[0.62rem] right-0 z-10 rounded-md px-1.5 text-[0.66rem] leading-[1.1rem] font-semibold tabular",
                    isWorst ? "bg-bad/20 text-[#ff9b9b]" : "text-white/30",
                  )}
                >
                  −{Math.round(drops[i] * 100)}%{isWorst && " · biggest leak"}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="w-[8.6rem] shrink-0 truncate text-[0.82rem] text-white/60">{label}</div>
                <div className="relative h-[1.9rem] flex-1 overflow-hidden rounded-md bg-white/[0.035]">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-r-md"
                    style={{ background: `linear-gradient(90deg, ${color}55, ${color})` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(hasData ? 0.6 : 0, rate * 100)}%` }}
                    transition={{ type: "spring", stiffness: 80, damping: 20 }}
                  />
                  {isWorst && <div className="absolute inset-0 rounded-md ring-1 ring-bad/50 ring-inset" />}
                </div>
                <div className="w-[3.6rem] shrink-0 text-right text-[0.9rem] font-semibold text-white/85 tabular">
                  {hasData ? pct(rate, rate < 0.1 ? 1 : 0) : "–"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FRICTION_LABEL: Record<FrictionSignal["kind"], string> = {
  rage_click: "Rage clicks",
  dead_end: "Dead end",
  shipping_shock: "Shipping shock",
  agent_missing_field: "Missing field",
  agent_error: "Tool error",
  agent_abandoned: "Agent quit",
};

export function ObserveStage({ summary, generation }: { summary?: AnalyticsSummary; generation: number }) {
  const hasData = (summary?.overall.visitors ?? 0) > 0;
  const friction = (summary?.friction ?? []).slice(0, 5);
  return (
    <div className="flex h-full flex-col gap-4">
      {!hasData && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-3 text-[0.9rem] text-white/55">
          <Activity className="size-4 text-human" />
          No shoppers on Gen {generation} yet. Turn on traffic <Kbd>T</Kbd> to send simulated humans and AI agents to the store.
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-8">
        <Funnel kind="human" seg={summary?.byKind.human} />
        <div className="w-px bg-white/[0.06]" />
        <Funnel kind="agent" seg={summary?.byKind.agent} />
      </div>
      <div className="flex min-h-[2rem] flex-wrap items-center gap-2">
        <span className="mr-1 text-[0.72rem] font-medium tracking-[0.14em] text-white/35 uppercase">Friction</span>
        {friction.length === 0 && <span className="text-[0.8rem] text-white/30">No friction signals yet</span>}
        {friction.map((f) => (
          <motion.span
            layout
            key={`${f.kind}-${f.audience}-${f.location}-${f.detail}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[0.78rem]",
              f.audience === "agent" ? "border-agent/25 bg-agent/[0.07]" : "border-human/25 bg-human/[0.07]",
            )}
          >
            <span>{f.audience === "agent" ? "🤖" : "🧑"}</span>
            <span className="font-medium text-white/85">{FRICTION_LABEL[f.kind]}</span>
            <span className="max-w-[13rem] truncate text-white/50">{f.detail ?? f.location}</span>
            <span className="font-semibold text-white/80 tabular">{pct(f.share, 0)}</span>
          </motion.span>
        ))}
      </div>
    </div>
  );
}
