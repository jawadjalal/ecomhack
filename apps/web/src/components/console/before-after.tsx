"use client";

import { useState } from "react";
import { ArrowRight, GitCompareArrows, GitPullRequest } from "lucide-react";
import type { GenerationRecord, PageSpec } from "@/lib/contracts";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { pct, prNumberFromUrl, signedPct, type PrInfo } from "@/lib/console/format";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/components/ui/cn";
import { AgentSurfaceDiff, pageForSpecs, specQuery, StoreFrame, type PreviewPage } from "./stage/previews";

const PAGES: [PreviewPage, string][] = [
  ["home", "Home"],
  ["product", "Product"],
  ["cart", "Bag"],
  ["checkout", "Checkout"],
];

function Delta({ label, dot, from, to }: { label: string; dot: string; from?: number; to?: number }) {
  const multiple = from && to && from > 0 ? to / from : undefined;
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[0.72rem] font-medium tracking-[0.1em] text-white/45 uppercase">
        <span className={cn("size-2 rounded-full", dot)} /> {label}
      </div>
      <div className="flex items-baseline gap-2 tabular">
        <span className="text-[1.05rem] text-white/45">{pct(from)}</span>
        <ArrowRight className="size-4 self-center text-white/30" />
        <span className="text-[1.6rem] font-semibold text-white">{pct(to)}</span>
        {multiple !== undefined && multiple > 1.005 && (
          <span className="ml-auto rounded-md bg-good/15 px-1.5 py-0.5 text-[0.8rem] font-semibold text-[#8ff0b2]">
            {multiple.toFixed(1)}×
          </span>
        )}
      </div>
    </div>
  );
}

/** Gen 0 vs the live store, side by side: the closing shot of the demo (hotkey B). */
export function BeforeAfterModal({
  open,
  onClose,
  history,
  liveSpec,
  prs,
  onOpenPr,
}: {
  open: boolean;
  onClose: () => void;
  history: GenerationRecord[];
  liveSpec?: PageSpec;
  prs: Map<number, PrInfo>;
  onOpenPr: (generation: number) => void;
}) {
  const [picked, setPage] = useState<PreviewPage | null>(null);
  const first = history[0];
  const last = history.at(-1);
  const shipped = history.slice(1);
  const live = liveSpec ?? DEFAULT_SPEC;
  const page = picked ?? pageForSpecs(DEFAULT_SPEC, live);
  const gen = last?.generation ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<GitCompareArrows />}
      title={gen > 0 ? `Gen 0 → Gen ${gen}: what Darwin built` : "Before / after"}
      className="max-w-[84rem]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <Delta label="Human conversion" dot="bg-human" from={first?.humanConversionRate} to={last?.humanConversionRate} />
          <Delta label="AI agent purchase rate" dot="bg-agent" from={first?.agentConversionRate} to={last?.agentConversionRate} />
          <Delta label="Overall conversion" dot="bg-brand" from={first?.overallConversionRate} to={last?.overallConversionRate} />
        </div>

        <div className="flex items-center justify-between">
          <div className="text-[0.82rem] text-white/45">
            {shipped.length
              ? `${shipped.length} A/B-tested change${shipped.length === 1 ? "" : "s"} shipped, each as a pull request.`
              : "Nothing shipped yet: Darwin's first winner will show up here."}
          </div>
          <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-[0.76rem]">
            {PAGES.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setPage(k)}
                className={cn("rounded-md px-2.5 py-0.5 transition-colors", page === k ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          <StoreFrame page={page} query={specQuery(DEFAULT_SPEC)} label="Gen 0 · the store you connected" tone="control" badge="0" />
          <StoreFrame page={page} query={specQuery(live)} label={`Gen ${gen} · live now`} tone="treatment" badge={String(gen)} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1.3fr]">
          <AgentSurfaceDiff control={DEFAULT_SPEC} treatment={live} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[0.76rem] font-medium text-white/70">Shipped, one PR per generation</div>
            <div className="flex flex-col gap-1">
              {shipped.map((g) => {
                const pr = prs.get(g.generation);
                const number = pr?.number ?? prNumberFromUrl(g.prUrl ?? pr?.url);
                return (
                  <button
                    key={g.generation}
                    onClick={() => onOpenPr(g.generation)}
                    className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-left text-[0.8rem] hover:border-white/15 hover:bg-white/[0.05]"
                  >
                    <span className="rounded-md bg-brand/15 px-1.5 font-mono text-[0.7rem] font-bold text-brand">G{g.generation}</span>
                    <span className="min-w-0 flex-1 truncate text-white/80">{g.label}</span>
                    {g.lift !== undefined && <span className="font-semibold text-[#8ff0b2] tabular">{signedPct(g.lift)}</span>}
                    <span className="flex items-center gap-1 text-[0.72rem] text-white/40">
                      <GitPullRequest className="size-3" />
                      {number ? `#${number}` : "dry run"}
                    </span>
                  </button>
                );
              })}
              {!shipped.length && (
                <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-3 text-[0.8rem] text-white/35">
                  Run the loop (Space) or turn on autopilot (A).
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
