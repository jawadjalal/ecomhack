"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { ExperimentResult } from "@/lib/contracts";
import { count, pct, signedPct } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { LiveDot } from "../ui";
import { audienceNoun, chance, measured, type Outcome } from "./model";
import { Tip } from "./tip";

const shipPct = (x: number) => `${Math.round(x * 1000) / 10}%`;

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-center gap-0.5 px-4 py-3 sm:px-5", className)}>
      <div className="num flex items-baseline gap-1.5 text-[20px] leading-tight font-semibold tracking-[-0.02em] whitespace-nowrap">{children}</div>
      <span className="truncate text-[12.5px] text-dw-ink/60">{label}</span>
    </div>
  );
}

const DECISION: Record<Outcome, { label: string; className: string }> = {
  running: { label: "Testing", className: "bg-dw-pink text-dw-ink" },
  shipped: { label: "Shipped", className: "bg-dw-olive text-dw-ink" },
  lost: { label: "B lost", className: "bg-dw-sand text-dw-ink/75" },
  unclear: { label: "No clear winner", className: "bg-dw-sand text-dw-ink/75" },
  stopped: { label: "Stopped", className: "bg-dw-sand text-dw-ink/75" },
};

/**
 * The verdict at a glance, right under the header: A vs B, lift, chance B wins against the ship
 * bar, shoppers, and what happens next. Everything here is the experiment's own result.
 */
export function ResultStrip({
  result,
  outcome,
  rules,
  synthetic,
  next,
}: {
  result?: ExperimentResult;
  outcome: Outcome;
  rules: { ship: number; early: number; drop: number };
  synthetic: boolean;
  /** One line about what happens next, with an optional link. */
  next: { text: string; href?: string };
}) {
  const reduce = useReducedMotion();
  const m = result ? measured(result) : undefined;
  const noun = audienceNoun(m?.audience ?? "all");
  const p = result?.probabilityToBeat;
  const d = DECISION[outcome];
  return (
    <section
      aria-label="Result so far"
      className="grid grid-cols-2 overflow-hidden rounded-[22px] border border-dw-hairline bg-dw-surface sm:grid-cols-3 lg:grid-cols-[auto_auto_minmax(220px,1fr)_auto_auto] lg:divide-x lg:divide-dw-hairline"
    >
      <Cell label={`of ${noun} bought, A → B`}>
        {m ? (
          <>
            <span className="text-dw-ink/55">{pct(m.a.conversionRate)}</span>
            <ArrowRight className="size-4 self-center text-dw-ink/40" aria-label="to" />
            <span>{pct(m.b.conversionRate)}</span>
          </>
        ) : (
          "–"
        )}
      </Cell>
      <Cell label="lift">
        <span className={cn(result && result.lift < 0 && "text-dw-warn")}>{result ? signedPct(result.lift) : "–"}</span>
      </Cell>

      <div className="col-span-2 flex min-w-0 flex-col justify-center gap-1.5 px-4 py-3 sm:col-span-1 sm:px-5 lg:col-span-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="num text-[20px] leading-tight font-semibold tracking-[-0.02em]">{chance(p)}</span>
          <span className="truncate text-[12.5px] text-dw-ink/60">chance B wins · ships at {shipPct(rules.ship)}</span>
        </div>
        <Tip
          wide
          className="block w-full"
          tip={
            rules.early > rules.ship
              ? `Darwin ships B at ${shipPct(rules.ship)} on the final look (${shipPct(rules.early)} on earlier looks) and drops it under ${Math.round(rules.drop * 100)}%.`
              : `Darwin ships B at ${shipPct(rules.ship)} and drops it under ${Math.round(rules.drop * 100)}%.`
          }
        >
          <span tabIndex={0} aria-label={`Chance B wins ${chance(p)}; ships at ${shipPct(rules.ship)}`} className="relative block h-2.5 w-full rounded-full bg-dw-sand outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
            <span className="absolute inset-y-0 rounded-l-full border-r border-dashed border-dw-ink/35" style={{ left: 0, width: `${rules.drop * 100}%` }} aria-hidden />
            <motion.span
              className="absolute inset-y-0 left-0 rounded-full bg-dw-ink"
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${Math.max(2, (p ?? 0.5) * 100)}%` }}
              transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}
            />
            <span className="absolute -inset-y-1.5 w-0 border-l-[1.5px] border-dashed border-dw-ink" style={{ left: `${rules.ship * 100}%` }} aria-hidden />
          </span>
        </Tip>
      </div>

      <Cell label={`${noun} tested${synthetic ? " (simulated)" : ""}`}>{m ? count(m.visitors) : "–"}</Cell>

      <div className="flex min-w-0 flex-col justify-center gap-1 px-4 py-3 sm:px-5">
        <span className={cn("inline-flex h-7 w-fit items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold", d.className)}>
          {outcome === "running" && <LiveDot className="bg-dw-hot" />}
          {d.label}
        </span>
        {next.href ? (
          <Link href={next.href} className="w-fit truncate rounded text-[12.5px] text-dw-ink/70 underline-offset-2 hover:text-dw-ink hover:underline focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none">
            {next.text} →
          </Link>
        ) : (
          <span className="truncate text-[12.5px] text-dw-ink/60">{next.text}</span>
        )}
      </div>
    </section>
  );
}
