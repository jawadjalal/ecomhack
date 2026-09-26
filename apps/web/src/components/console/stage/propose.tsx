"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Cpu, FileDiff, Sparkles } from "lucide-react";
import type { ChangeProposal, PageSpec } from "@/lib/contracts";
import { tryApplyPatch } from "@/lib/spec/patch";
import { humanizePath, parseDiffLine, signedPct, sourceBadge } from "@/lib/console/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { ThinkingCards } from "./diagnose";
import { AgentSurfaceDiff, pageForPatch, specQuery, StoreFrame, type PreviewPage } from "./previews";

export function SourceChip({ source }: { source: string }) {
  const b = sourceBadge(source);
  if (!b) return null;
  return (
    <Badge tone={b.label === "Heuristic" ? "neutral" : "brand"} title={source}>
      {b.label === "Heuristic" ? <Cpu /> : <Sparkles />}
      {b.label}
      {b.model && <span className="font-mono text-[0.65rem] opacity-60">{b.model}</span>}
    </Badge>
  );
}

function prettyValue(v?: string) {
  if (v === undefined) return "";
  if (/^\d{3,}$/.test(v)) return `${v} (£${(Number(v) / 100).toFixed(2)})`;
  return v;
}

export function DiffBlock({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-white/[0.07] bg-[#07090d]", className)}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5 font-mono text-[0.7rem] text-white/40">
        <FileDiff className="size-3.5" /> storefront.config.json
        <span className="ml-auto text-[#8ff0b2]/80">+{lines.length}</span>
        <span className="text-[#ff9b9b]/70">−{lines.length}</span>
      </div>
      <div className="flex flex-col gap-0.5 p-2">
        {lines.map((raw, i) => {
          const d = parseDiffLine(raw);
          return (
            <motion.div
              key={raw}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.07 }}
              className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,auto)] items-center gap-3 rounded-md px-2 py-1 hover:bg-white/[0.03]"
            >
              <div className="min-w-0">
                <div className="truncate text-[0.8rem] text-white/80">{humanizePath(d.path)}</div>
                <div className="truncate font-mono text-[0.64rem] text-white/30">{d.path}</div>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1.5 font-mono text-[0.76rem]">
                {d.before !== undefined && (
                  <span className="max-w-[9rem] shrink-0 truncate rounded bg-bad/12 px-1.5 py-0.5 text-[#ff9b9b] line-through decoration-[#ff9b9b]/50" title={d.before}>
                    {prettyValue(d.before)}
                  </span>
                )}
                <span className="text-white/30">→</span>
                <span className="min-w-0 truncate rounded bg-good/15 px-1.5 py-0.5 font-semibold text-[#8ff0b2]" title={d.after}>
                  {prettyValue(d.after)}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

const PAGE_LABEL: Record<PreviewPage, string> = { home: "Home", product: "Product", cart: "Bag" };

export function ProposeStage({
  proposal,
  liveSpec,
  treatmentSpec,
  controlQuery,
  mock,
}: {
  proposal?: ChangeProposal;
  liveSpec: PageSpec;
  /** The running experiment's treatment spec, if any. */
  treatmentSpec?: PageSpec;
  /** Query for the control preview (real: variant=control; mock: previewSpec=<live>). */
  controlQuery: string;
  mock: boolean;
}) {
  const auto = pageForPatch(proposal?.patch);
  const [picked, setPicked] = useState<{ id?: string; page: PreviewPage } | null>(null);
  const page = picked && picked.id === proposal?.id ? picked.page : auto;
  if (!proposal) return <ThinkingCards label="The designer is drafting a page change…" n={2} />;

  const treatment = treatmentSpec ?? tryApplyPatch(liveSpec, proposal.patch) ?? liveSpec;
  const touchesAgents = Boolean((proposal.patch as Record<string, unknown>).agentSurface);
  const touchesHumans = Object.keys(proposal.patch).some((k) => k !== "agentSurface");

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] gap-5">
      {/* proposal */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceChip source={proposal.source} />
          {touchesHumans && <Badge tone="human">🧑 Storefront</Badge>}
          {touchesAgents && <Badge tone="agent">🤖 Agent API</Badge>}
          <div className="flex-1" />
          <div className="text-right">
            <div className="text-[1.5rem] leading-none font-semibold text-brand tabular">{signedPct(proposal.expectedLift)}</div>
            <div className="text-[0.62rem] tracking-[0.12em] text-white/40 uppercase">expected lift</div>
          </div>
        </div>
        <h3 className="shrink-0 text-[1.4rem] leading-tight font-semibold tracking-[-0.015em] text-white">{proposal.title}</h3>
        <p className="line-clamp-3 shrink-0 text-[0.86rem] leading-relaxed text-white/55" title={proposal.hypothesis}>
          {proposal.hypothesis}
        </p>
        <DiffBlock lines={proposal.diff} className="min-h-0 overflow-y-auto scrollbar-thin" />
      </motion.div>

      {/* before / after */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-[0.72rem] font-medium tracking-[0.14em] text-white/40 uppercase">Before / after · live previews</div>
          <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
            {(["home", "product", "cart"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPicked({ id: proposal.id, page: p })}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[0.72rem] font-medium transition-colors",
                  page === p ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80",
                )}
              >
                {PAGE_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <StoreFrame page={page} query={controlQuery} tone="control" label={`Control · ${liveSpec.label}`} tall={!touchesAgents} />
          <StoreFrame page={page} query={specQuery(treatment)} tone="treatment" label="Treatment · proposal" tall={!touchesAgents} />
        </div>
        {touchesAgents ? (
          <AgentSurfaceDiff control={liveSpec} treatment={treatment} className="flex-1" />
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.07] px-3 py-2 text-[0.76rem] text-white/35">
            Human-facing change only; the agent API is unchanged.
          </div>
        )}
        {mock && <div className="text-[0.66rem] text-white/25">Previews render the real storefront with ?previewSpec=… (mock mode).</div>}
      </div>
    </div>
  );
}
