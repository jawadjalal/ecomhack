"use client";

/**
 * "Darwin's impact so far": one compact strip under the greeting. Conversion before Darwin (Gen 0 in the
 * loop history) against the live store now, overall and for people and AI agents, the extra buyers per
 * 1,000 visitors, changes shipped, tests running and what Darwin is doing right now. No revenue (owner rule).
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Experiment, LoopState } from "@/lib/contracts";
import { PHASE_META } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { Mascot } from "../mascot";
import { CountUp, Grow } from "./fx";
import { liftText, pctSmart } from "./model";

function Divider() {
  return <span aria-hidden className="hidden w-px self-stretch bg-dw-hairline lg:block" />;
}

/** Before (dashed) vs now (solid): ink-only, like every chart on the page. */
function BeforeNow({ label, before, now, max }: { label: string; before: number; now: number; max: number }) {
  const lift = before > 0 ? now / before - 1 : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-dw-ink/65">{label}</span>
        {lift !== undefined && <span className={cn("num text-[12px] font-semibold", lift >= 0 ? "text-dw-win" : "text-dw-warn")}>{liftText(lift)}</span>}
      </div>
      <span className="num text-[16px] leading-tight font-semibold whitespace-nowrap">
        <span className="font-medium text-dw-ink/55">{pctSmart(before)}</span> → {pctSmart(now)}
      </span>
      <span className="flex w-full flex-col gap-[3px] sm:w-[132px]" aria-hidden>
        <Grow axis="x" size={`${Math.max(4, (before / max) * 100)}%`} delay={0.3} className="h-[5px] rounded-full border border-dashed border-dw-ink/70" />
        <Grow axis="x" size={`${Math.max(4, (now / max) * 100)}%`} delay={0.4} className="h-[5px] rounded-full bg-dw-ink" />
      </span>
    </div>
  );
}

export function ImpactStrip({ loop, experiments, simulated }: { loop?: LoopState; experiments?: Experiment[]; simulated: boolean }) {
  if (!loop) return null;
  const history = loop.history;
  const before = history[0];
  const now = history.at(-1);
  const shipped = history.filter((g) => g.generation > 0).length;
  const running = experiments?.filter((e) => e.status === "running").length ?? 0;
  const phase = PHASE_META[loop.phase];
  const measured = !!before && !!now && shipped > 0;
  const extra = measured ? (now.overallConversionRate - before.overallConversionRate) * 1000 : 0;
  const max = measured ? Math.max(before.humanConversionRate, now.humanConversionRate, 1e-9) : 1;
  const maxA = measured ? Math.max(before.agentConversionRate, now.agentConversionRate, 1e-9) : 1;

  return (
    <section
      aria-label="Darwin’s impact so far"
      className="relative mt-8 grid grid-cols-1 gap-x-8 gap-y-5 border-y border-dw-ink/10 py-5 sm:grid-cols-2 lg:flex lg:items-center lg:gap-x-8"
    >
      <div className="flex min-w-0 items-center gap-3.5 sm:col-span-2 lg:flex-1">
        <Mascot kind="shipper" size={46} frame active={loop.autopilot} />
        <div className="flex min-w-0 flex-col">
          {measured ? (
            <>
              <span className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">
                {extra >= 0 ? "+" : "−"}
                <CountUp value={Math.abs(extra)} format="int" /> buyers per 1,000 visitors
              </span>
              <span className="text-[13.5px] leading-snug text-dw-ink/65">
                since Darwin started: {pctSmart(before.overallConversionRate)} → {pctSmart(now.overallConversionRate)} of shoppers buy (
                <span className={cn("font-semibold", extra >= 0 ? "text-dw-win" : "text-dw-warn")}>
                  {liftText(before.overallConversionRate > 0 ? now.overallConversionRate / before.overallConversionRate - 1 : undefined)}
                </span>
                ){simulated && <span className="text-dw-ink/45"> · simulated shoppers</span>}
              </span>
            </>
          ) : (
            <>
              <span className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">
                {before ? "Your original store is measured" : "Darwin is getting to know your store"}
              </span>
              <span className="text-[13.5px] leading-snug text-dw-ink/65">
                {before
                  ? `${pctSmart(before.overallConversionRate)} of shoppers buy today. Darwin’s impact shows here once the first change ships.`
                  : "Its impact shows here once it has measured your store and shipped a change."}
              </span>
            </>
          )}
        </div>
      </div>

      {measured && (
        <>
          <Divider />
          <BeforeNow label="People" before={before.humanConversionRate} now={now.humanConversionRate} max={max} />
          <BeforeNow label="AI agents" before={before.agentConversionRate} now={now.agentConversionRate} max={maxA} />
        </>
      )}

      <Divider />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[16px] leading-tight font-semibold">
          {shipped} change{shipped === 1 ? "" : "s"} shipped
        </span>
        <span className="text-[13px] text-dw-ink/65">{running ? `${running} test${running === 1 ? "" : "s"} running now` : "No test running"}</span>
        <Link
          href="/console/changes"
          className="group inline-flex items-center gap-1 text-[13px] font-medium text-dw-ink underline decoration-dw-ink/30 underline-offset-4 hover:decoration-dw-ink"
        >
          See all changes
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      <Divider />
      <div className="flex min-w-0 flex-col gap-1 lg:max-w-[15rem]">
        <span className="flex items-center gap-2 text-[16px] leading-tight font-semibold">
          <span className={cn("size-2 shrink-0 rounded-full", loop.autopilot ? "dw-live-dot bg-dw-live" : "bg-dw-ink/30")} />
          {loop.autopilot ? phase.verb : "Paused"}
        </span>
        <span className="text-[13px] leading-snug text-dw-ink/65">
          {loop.autopilot
            ? `${phase.blurb}.`
            : loop.phase === "idle"
              ? `Let Darwin run to ${shipped ? "keep" : "start"} improving your store.`
              : `Stopped while ${phase.verb.toLowerCase()}. Let it run to carry on.`}
        </span>
      </div>
    </section>
  );
}
