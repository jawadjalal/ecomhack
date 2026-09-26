"use client";

import { motion } from "motion/react";
import { AlertTriangle, CircleAlert, Info, Target } from "lucide-react";
import type { Insight } from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

const SEVERITY = {
  high: { tone: "bad" as const, label: "High", icon: AlertTriangle },
  medium: { tone: "warn" as const, label: "Medium", icon: CircleAlert },
  low: { tone: "neutral" as const, label: "Low", icon: Info },
};

export function AudienceBadge({ audience }: { audience: Insight["audience"] }) {
  if (audience === "agent") return <Badge tone="agent">🤖 AI agents</Badge>;
  if (audience === "human") return <Badge tone="human">🧑 Humans</Badge>;
  return <Badge tone="neutral">🧑🤖 Everyone</Badge>;
}

export function InsightCard({ insight, index, targeted }: { insight: Insight; index: number; targeted?: boolean }) {
  const sev = SEVERITY[insight.severity];
  const Icon = sev.icon;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.09, type: "spring", stiffness: 260, damping: 24 }}
      className={cn(
        "relative flex min-h-0 flex-col gap-2 overflow-hidden rounded-xl border p-4",
        targeted ? "border-brand/35 bg-brand/[0.045]" : "border-white/[0.07] bg-white/[0.025]",
      )}
    >
      {insight.severity === "high" && <div className="absolute inset-y-0 left-0 w-[3px] bg-bad/80" />}
      <div className="flex items-center gap-2">
        <Badge tone={sev.tone}>
          <Icon />
          {sev.label}
        </Badge>
        <AudienceBadge audience={insight.audience} />
        <span className="truncate font-mono text-[0.72rem] text-white/35">{insight.stage}</span>
        <div className="flex-1" />
        {targeted && (
          <Badge tone="brand">
            <Target />
            Targeted
          </Badge>
        )}
        <div className="flex shrink-0 items-baseline gap-1" title="Estimated conversions lost per 1,000 sessions">
          <span className="text-[1.2rem] leading-none font-semibold text-white tabular">−{Math.round(insight.impactScore)}</span>
          <span className="text-[0.62rem] leading-tight text-white/35">/1k</span>
        </div>
      </div>
      <h3 className="text-[1.15rem] leading-snug font-semibold tracking-[-0.01em] text-white">{insight.title}</h3>
      <p className="line-clamp-2 text-[0.84rem] leading-relaxed text-white/55">{insight.detail}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {insight.evidence.slice(0, 3).map((e) => (
          <span key={e.label} className="inline-flex items-baseline gap-1.5 rounded-md bg-white/[0.05] px-2 py-1 text-[0.74rem]">
            <span className="text-white/45">{e.label}</span>
            <span className="font-semibold text-white/90 tabular">{e.value}</span>
          </span>
        ))}
      </div>
    </motion.article>
  );
}

export function ThinkingCards({ label, n = 4 }: { label: string; n?: number }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 text-[0.9rem] text-white/55">
        <span className="size-2 rounded-full bg-brand pulse-dot" />
        {label}
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="shimmer rounded-xl border border-white/[0.05]" />
        ))}
      </div>
    </div>
  );
}

export function DiagnoseStage({ insights, targetedIds }: { insights: Insight[]; targetedIds: string[] }) {
  if (!insights.length) return <ThinkingCards label="The analyst is reading funnels, friction and agent tool calls…" />;
  const shown = [...insights].sort((a, b) => b.impactScore - a.impactScore).slice(0, 4);
  return (
    <div className={cn("grid h-full gap-3", shown.length > 2 ? "grid-cols-2 grid-rows-2" : "grid-cols-2")}>
      {shown.map((ins, i) => (
        <InsightCard key={ins.id} insight={ins} index={i} targeted={targetedIds.includes(ins.id)} />
      ))}
    </div>
  );
}
