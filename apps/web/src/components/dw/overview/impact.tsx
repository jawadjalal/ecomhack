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
import { DEPTH } from "../ui";
import { CountUp, Grow } from "./fx";
import { Swap } from "./swap";
import { liftText, pctSmart } from "./model";

function Divider() {
  return <span aria-hidden className="hidden w-px self-stretch bg-dw-hairline lg:block" />;
}

/** Before (dashed) vs now (solid): ink-only, like every chart on the page. */
function BeforeNow({ label, before, now, max }: { label: string; before: number; now: number; max: number }) {
  const lift = before > 0 ? now / before - 1 : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 lg:gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-dw-ink/65 lg:text-[12.5px]">{label}</span>
        {lift !== undefined && <span className={cn("num min-w-[3.25rem] text-right text-[12px] font-semibold", lift >= 0 ? "text-dw-win" : "text-dw-warn")}>{liftText(lift)}</span>}
      </div>
      <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:gap-3">
        <span className="num text-[16px] leading-tight font-semibold whitespace-nowrap lg:min-w-[6.5rem] lg:text-[15px]">
          <span className="font-medium text-dw-ink/55">{pctSmart(before)}</span> → {pctSmart(now)}
        </span>
        <span className="flex w-full flex-col gap-[3px] sm:w-[132px] lg:w-14" aria-hidden>
          <Grow axis="x" size={`${Math.max(4, (before / max) * 100)}%`} delay={0.3} className="h-[5px] rounded-full border border-dashed border-dw-ink/70" />
          <Grow axis="x" size={`${Math.max(4, (now / max) * 100)}%`} delay={0.4} className="h-[5px] rounded-full bg-dw-ink" />
        </span>
      </div>
    </div>
  );
}

/** Holds the strip's exact footprint while the first poll is in flight, so nothing below it jumps. */
function StripPlaceholder() {
  return (
    <>
      <div aria-hidden className="h-[96px] sm:hidden" />
      <div aria-hidden className="flex h-[80px] items-center gap-3.5 rounded-[22px] border border-dw-hairline bg-dw-surface px-5 max-sm:hidden">
        <span className="size-[42px] shrink-0 rounded-full bg-dw-ink/[0.06]" />
        <span className="flex flex-col gap-2">
          <span className="h-3.5 w-56 rounded-full bg-dw-ink/[0.07]" />
          <span className="h-2.5 w-40 rounded-full bg-dw-ink/[0.05]" />
        </span>
      </div>
    </>
  );
}

export function ImpactStrip({ loop, experiments, simulated }: { loop?: LoopState; experiments?: Experiment[]; simulated: boolean }) {
  if (!loop) return <StripPlaceholder />;
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

  const lift = measured && before.overallConversionRate > 0 ? now.overallConversionRate / before.overallConversionRate - 1 : undefined;
  const status = loop.autopilot ? phase.verb : "Paused";
  const blurb = loop.autopilot
    ? `${phase.blurb}.`
    : loop.phase === "idle"
      ? `Let Darwin run to ${shipped ? "keep" : "start"} improving your store.`
      : `Stopped while ${phase.verb.toLowerCase()}. Let it run to carry on.`;

  return (
    <>
      {/* Phones: three big numbers, flat on the page (no box). */}
      <section aria-label="Darwin’s impact so far" className="flex flex-col gap-2.5 sm:hidden">
        <div className="grid grid-cols-3 divide-x divide-dw-ink/10">
          {(measured
            ? [
                {
                  value: (
                    <>
                      <span>{extra >= 0 ? "+" : "−"}</span>
                      <CountUp value={Math.abs(extra)} format="int" />
                    </>
                  ),
                  label: "more buyers per 1,000 visitors",
                },
                {
                  value: lift !== undefined ? <CountUp value={lift} format="lift" /> : "–",
                  label: "conversion since Darwin started",
                },
                {
                  value: <CountUp value={shipped} format="int" />,
                  label: shipped === 1 ? "change shipped" : "changes shipped",
                },
              ]
            : [
                {
                  value: before ? pctSmart(before.overallConversionRate) : "–",
                  label: "of shoppers buy today",
                },
                {
                  value: <CountUp value={running} format="int" />,
                  label: running === 1 ? "test running" : "tests running",
                },
                {
                  value: <CountUp value={shipped} format="int" />,
                  label: "changes shipped",
                },
              ]
          ).map((x, i) => (
            <div key={i} className={cn("flex min-w-0 flex-col gap-1", i === 0 ? "pr-3" : "px-3")}>
              <span className="num text-[30px] leading-none font-semibold tracking-[-0.03em]">{x.value}</span>
              <span className="text-[12px] leading-snug text-dw-ink/60">{x.label}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 text-[12.5px] text-dw-ink/60">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", loop.autopilot ? "dw-live-dot bg-dw-live" : "bg-dw-ink/30")} />
            <Swap k={status} className="min-w-0 whitespace-nowrap">
              {status}
            </Swap>
            {simulated && <span className="shrink-0 whitespace-nowrap">· simulated</span>}
          </span>
          <Link href="/console/changes" className="inline-flex shrink-0 items-center gap-1 font-medium text-dw-ink underline decoration-dw-ink/30 underline-offset-4">
            See all changes
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </section>

      <section
        aria-label="Darwin’s impact so far"
        className={cn(
          "relative max-sm:hidden grid grid-cols-1 gap-x-6 gap-y-4 rounded-[22px] border border-dw-hairline bg-dw-surface px-5 py-4 tabular-nums sm:grid-cols-2 lg:flex lg:h-[80px] lg:items-center lg:gap-x-5 lg:py-2.5",
          DEPTH,
        )}
      >
        <div className="flex min-w-0 items-center gap-3.5 sm:col-span-2 lg:flex-1">
          <Mascot kind="shipper" size={42} frame active={loop.autopilot} />
          <div className="flex min-w-0 flex-col">
            {measured ? (
              <>
                <span className="text-[20px] leading-tight font-semibold tracking-[-0.02em] lg:text-[18px]">
                  {extra >= 0 ? "+" : "−"}
                  <CountUp value={Math.abs(extra)} format="int" /> buyers per 1,000 visitors
                </span>
                {/* The "simulated" label never truncates: only the sentence before it may. */}
                <span className="flex min-w-0 items-baseline gap-1 text-[13.5px] leading-snug text-dw-ink/65 lg:text-[13px]">
                  <span className="min-w-0 lg:truncate" title="Share of shoppers who buy: Gen 0 → now">
                    {pctSmart(before.overallConversionRate)} → {pctSmart(now.overallConversionRate)} buy since Darwin (<span className="sr-only">change: </span>
                    <span className={cn("font-semibold", extra >= 0 ? "text-dw-win" : "text-dw-warn")}>
                      {liftText(before.overallConversionRate > 0 ? now.overallConversionRate / before.overallConversionRate - 1 : undefined)}
                    </span>
                    )
                  </span>
                  {simulated && <span className="shrink-0 whitespace-nowrap text-dw-ink/45">· simulated</span>}
                </span>
              </>
            ) : (
              <>
                <span className="text-[20px] leading-tight font-semibold tracking-[-0.02em] lg:text-[18px]">{before ? "Your original store is measured" : "Darwin is getting to know your store"}</span>
                <span className="text-[13.5px] leading-snug text-dw-ink/65 lg:line-clamp-1 lg:text-[13px]">
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
        <div className="flex min-w-0 flex-col gap-1 lg:w-[15.5rem] lg:shrink-0">
          <span className="text-[16px] leading-tight font-semibold whitespace-nowrap lg:text-[15px]">
            <CountUp value={shipped} format="int" /> change
            {shipped === 1 ? "" : "s"} shipped
            <span className="font-normal text-dw-ink/65 max-lg:hidden"> · {running ? `${running} test${running === 1 ? "" : "s"} running` : "no test running"}</span>
          </span>
          <span className="text-[13px] text-dw-ink/65 lg:hidden">{running ? `${running} test${running === 1 ? "" : "s"} running now` : "No test running"}</span>
          <Link href="/console/changes" className="group inline-flex items-center gap-1 text-[13px] font-medium text-dw-ink underline decoration-dw-ink/30 underline-offset-4 hover:decoration-dw-ink">
            See all changes
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <Divider />
        <div className="flex min-w-0 flex-col gap-1 lg:w-[13.5rem] lg:shrink-0">
          <span className="flex items-center gap-2 text-[16px] leading-tight font-semibold lg:text-[15px]">
            <span className={cn("size-2 shrink-0 rounded-full transition-colors", loop.autopilot ? "dw-live-dot bg-dw-live" : "bg-dw-ink/30")} />
            <Swap k={status}>{status}</Swap>
          </span>
          <Swap k={blurb} className="text-[13px] leading-snug text-dw-ink/65 lg:h-[2lh] lg:text-[12.5px]">
            <span className="lg:line-clamp-2">{blurb}</span>
          </Swap>
        </div>
      </section>
    </>
  );
}
