"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { ExperimentResult } from "@/lib/contracts";
import { count, pct, signedPct } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { LiveDot } from "../ui";
import { DEPTH } from "./frame";
import { audienceNoun, chance, measured, type Outcome } from "./model";
import { Tip } from "./tip";

const shipPct = (x: number) => `${Math.round(x * 1000) / 10}%`;

function Stat({ label, children, tone }: { label: string; children: ReactNode; tone: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-0.5 rounded-[20px] px-4 py-3" style={{ background: tone }}>
      <div className="num flex items-baseline gap-1.5 text-[20px] leading-tight font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums">{children}</div>
      <span className="truncate text-[12.5px] text-dw-ink/65">{label}</span>
    </div>
  );
}

const DECISION: Record<Outcome, { label: string; className: string }> = {
  running: { label: "Ada is testing", className: "bg-dw-pink text-dw-ink" },
  shipped: { label: "Won, Max shipped it", className: "bg-dw-olive text-dw-ink" },
  lost: { label: "The new version lost", className: "bg-dw-sand text-dw-ink/75" },
  unclear: { label: "No clear winner", className: "bg-dw-sand text-dw-ink/75" },
  stopped: { label: "Stopped", className: "bg-dw-sand text-dw-ink/75" },
};

/**
 * The verdict at the top of the detail column: the test's name, what happened, the chance the new
 * version is better against Ada's ship bar, and the numbers behind it. Everything here is the
 * experiment's own result.
 */
export function ResultStrip({
  title,
  lede,
  result,
  outcome,
  rules,
  synthetic,
  next,
}: {
  title: ReactNode;
  lede: ReactNode;
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
    <section aria-label="Result so far" className={cn("relative flex flex-col gap-4 overflow-hidden rounded-[28px] border border-dw-hairline bg-dw-surface p-5 sm:p-6", DEPTH)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex h-7 w-fit items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold", d.className)}>
          {outcome === "running" && <LiveDot className="bg-dw-hot" />}
          {d.label}
        </span>
        {next.href ? (
          <Link href={next.href} className="ml-auto inline-flex items-center gap-1 rounded text-[12.5px] text-dw-ink/70 underline-offset-2 hover:text-dw-ink hover:underline focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none">
            {next.text} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <span className="ml-auto text-[12.5px] text-dw-ink/60">{next.text}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-balance">{title}</h2>
        <p className="text-[15px] leading-snug text-dw-ink/75">{lede}</p>
      </div>

      <div className="flex flex-col gap-2 rounded-[20px] bg-dw-pink px-4 py-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="flex items-baseline gap-2">
            <span className="num text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{chance(p)}</span>
            <span className="text-[13px] text-dw-ink/75">chance the new version is better</span>
          </span>
          <span className="text-[12.5px] text-dw-ink/65">Ada ships it once she&apos;s {shipPct(rules.ship)} sure</span>
        </div>
        <Tip
          wide
          className="block w-full"
          tip={
            rules.early > rules.ship
              ? `Ada ships the new version once she's ${shipPct(rules.ship)} sure on the final look (${shipPct(rules.early)} on earlier looks) and drops it under ${Math.round(rules.drop * 100)}%.`
              : `Ada ships the new version once she's ${shipPct(rules.ship)} sure and drops it under ${Math.round(rules.drop * 100)}%.`
          }
        >
          <span
            tabIndex={0}
            aria-label={`Chance the new version is better: ${chance(p)}. Ada ships it at ${shipPct(rules.ship)}.`}
            className="relative block h-3 w-full rounded-full bg-dw-pink-shape outline-none focus-visible:ring-2 focus-visible:ring-dw-ink"
          >
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label={`of ${noun} buy, current → new`} tone="var(--color-dw-yellow)">
          {m ? (
            <>
              <span className="text-dw-ink/55">{pct(m.a.conversionRate)}</span>
              <ArrowRight className="size-4 self-center text-dw-ink/45" aria-label="to" />
              <span>{pct(m.b.conversionRate)}</span>
            </>
          ) : (
            "–"
          )}
        </Stat>
        <Stat label="more buyers" tone="var(--color-dw-olive)">
          <span className={cn(result && result.lift < 0 && "text-dw-warn")}>{result ? signedPct(result.lift) : "–"}</span>
        </Stat>
        <Stat label={`${noun} tested${synthetic ? " (simulated)" : ""}`} tone="var(--color-dw-blue)">
          {m ? count(m.visitors) : "–"}
        </Stat>
      </div>
    </section>
  );
}
