"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { Experiment, LoopState } from "@/lib/contracts";
import { signedPct, timeAgo } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { Mascot } from "../mascot";
import { Card } from "../ui";
import { appHref, chance, historyFor, outcomeOf, type ChangeRow, type Outcome } from "./model";
import { Tip } from "./tip";

const WHO: Record<ChangeRow["seenBy"], { label: string; dot: string; tip: string }> = {
  people: { label: "People", dot: "bg-dw-blue", tip: "A page change: only people see it" },
  agents: { label: "Agents", dot: "bg-dw-pink", tip: "Lives in the store API: only AI shoppers see it" },
  both: { label: "Both", dot: "bg-[linear-gradient(90deg,#B8CAEE_50%,#F3B5D5_50%)]", tip: "People see it on the page, agents feel it in the landed price" },
};

export function WhatChangesCard({ rows, source }: { rows: ChangeRow[]; source?: string }) {
  const reduce = useReducedMotion();
  return (
    <Card tone="white" hover={false} className="p-5 sm:px-6" aria-label="What B changes">
      <div className="flex flex-wrap items-center gap-2.5 px-1.5 pb-3">
        <Mascot kind="designer" size={30} active />
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">What B changes</h2>
        {source && <span className="ml-auto text-[13px] text-dw-ink/55">{source}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-4 text-[14px] text-dw-ink/60">Darwin didn&apos;t log the settings for this test, so there&apos;s nothing to compare.</p>
      ) : (
        <div role="table" aria-label="Settings B changes">
          <div role="row" className="grid grid-cols-[1.5fr_1.2fr_0.7fr_1.5fr] px-3.5 pb-2 text-[13px] text-[#8A8478] max-md:hidden">
            <span role="columnheader">Setting</span>
            <span role="columnheader">A → B</span>
            <span role="columnheader">Seen by</span>
            <span role="columnheader">Leak it fixes</span>
          </div>
          {rows.map((r, i) => (
            <motion.div
              key={r.path}
              role="row"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.07, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className="dw-row grid items-center gap-x-4 gap-y-1.5 rounded-[16px] px-3.5 py-3 text-[15px] hover:bg-[#F6F0E4] md:min-h-14 md:grid-cols-[1.5fr_1.2fr_0.7fr_1.5fr] md:py-2"
            >
              <span role="cell" className="font-semibold">
                {r.setting}
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2.5 font-dwmono text-[13px]">
                <span className="max-w-[40%] shrink-0 truncate text-[#8A8478] line-through" title={r.a}>
                  {r.a}
                </span>
                <ArrowRight className="size-3.5 shrink-0" aria-label="becomes" />
                <span className="dw-tilt min-w-0 truncate rounded-full bg-dw-ink px-2.5 py-0.5 text-white" title={r.b}>
                  {r.b}
                </span>
              </span>
              <span role="cell">
                <Tip tip={WHO[r.seenBy].tip} align="start">
                  <span tabIndex={0} className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
                    <span className={cn("size-2.5 rounded-full", WHO[r.seenBy].dot)} />
                    {WHO[r.seenBy].label}
                  </span>
                </Tip>
              </span>
              <span role="cell" className="text-dw-ink/75">
                {r.leak ?? "A new idea, not tied to one leak"}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ past experiments */

const OUTCOME: Record<Outcome, { label: string; className: string }> = {
  running: { label: "Running", className: "bg-dw-pink text-dw-ink" },
  shipped: { label: "Shipped", className: "bg-dw-olive text-dw-ink" },
  lost: { label: "Lost", className: "bg-dw-sand text-dw-ink/70" },
  unclear: { label: "No clear winner", className: "bg-dw-sand text-dw-ink/70" },
  stopped: { label: "Stopped", className: "bg-dw-sand text-dw-ink/70" },
};

export function PastExperiments({
  experiments,
  loop,
  selectedId,
  onSelect,
  now,
  mock,
}: {
  mock: boolean;
  experiments: Experiment[];
  loop: LoopState | undefined;
  selectedId?: string;
  onSelect: (id: string) => void;
  now: number;
}) {
  const reduce = useReducedMotion();
  return (
    <Card tone="white" hover={false} className="p-5 sm:px-6" aria-label="Past experiments">
      <div className="flex items-center gap-2.5 px-1.5 pb-3">
        <Mascot kind="experimenter" size={30} active={false} />
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Every test so far</h2>
        <span className="num ml-auto text-[13px] text-dw-ink/55">{experiments.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {experiments.map((e, i) => {
          const outcome = outcomeOf(e, loop);
          const rec = historyFor(e, loop);
          const on = e.id === selectedId;
          const r = e.result;
          return (
            <motion.li
              key={e.id}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              className="relative"
            >
              {on && (
                <motion.span
                  layoutId="dw-exp-past-sel"
                  className="absolute inset-0 rounded-[16px] bg-dw-yellow"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <div className={cn("dw-row relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-[16px] px-3.5 py-2.5 md:grid-cols-[132px_1fr_90px_90px_110px]", !on && "hover:bg-[#F6F0E4]")}>
                <span className="flex items-center gap-2 max-md:col-start-1 max-md:row-start-1">
                  <span className={cn("dw-tilt inline-flex h-7 w-fit items-center rounded-full px-2.5 text-[12px] font-semibold", OUTCOME[outcome].className)}>{OUTCOME[outcome].label}</span>
                  {r && <span className="num text-[12px] text-dw-ink/60 md:hidden">{signedPct(r.lift)} · {chance(r.probabilityToBeat)} sure</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-pressed={on}
                  className="min-w-0 truncate rounded-md text-left text-[15px] font-semibold outline-none max-md:col-start-1 max-md:row-start-2 after:absolute after:inset-0 after:rounded-[16px] focus-visible:after:ring-2 focus-visible:after:ring-dw-ink"
                >
                  {e.name}
                </button>
                <span className={cn("num text-[14px] font-semibold max-md:hidden", r && r.lift < 0 && "text-dw-ink/55")}>{r ? signedPct(r.lift) : "–"}</span>
                <span className="num text-[13px] text-dw-ink/60 max-md:hidden">{r ? `${chance(r.probabilityToBeat)} sure` : ""}</span>
                <span className="relative z-10 flex items-center justify-end gap-2 text-[13px] text-dw-ink/55 max-md:col-start-2 max-md:row-span-2 max-md:row-start-1">
                  {outcome === "shipped" && rec ? (
                    <Link
                      href={appHref(`/console/pulls#gen-${rec.generation}`, mock)}
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-dw-ink px-2.5 text-[12px] font-medium text-white transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      Gen {rec.generation} PR <ArrowUpRight className="size-3" aria-hidden />
                    </Link>
                  ) : (
                    <span>{timeAgo(e.completedAt ?? e.createdAt, now)}</span>
                  )}
                </span>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
}
