"use client";

/**
 * First run: nobody has connected a store and Darwin hasn't seen a shopper. The loop screens run on PACE,
 * the demo store, so the honest first step is "watch Darwin improve the demo store" (simulated shoppers +
 * autopilot, both labelled), with "connect your store" next to it. Once data flows the normal screens take over.
 */
import { ArrowUpRight, Play } from "lucide-react";
import Link from "next/link";
import type { LoopState } from "@/lib/contracts";
import { useSummary } from "@/lib/console/hooks";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "./mascot";
import { useDarwin } from "./provider";
import { useStoreContext } from "./store-context";
import { PillButton } from "./ui";

/** Gen 0, nothing found, nothing tested: the loop hasn't started on the demo store yet. */
export function loopIsFresh(loop: LoopState | undefined): boolean {
  if (!loop) return false;
  return (
    loop.generation === 0 &&
    loop.history.length <= 1 &&
    !loop.insights.length &&
    !loop.proposal &&
    !loop.experimentId &&
    (loop.phase === "idle" || loop.phase === "observe")
  );
}

/**
 * Visitors the demo store's live page has had (events tagged with its spec version). The unfiltered summary
 * also counts other sites' darwin.js events (e.g. the North Trail preview), which say nothing about PACE.
 */
export function useDemoStoreVisitors(): number | undefined {
  const { loop } = useDarwin();
  const { summary } = useSummary(loop ? { specVersion: loop.liveSpec.version } : null, 5000);
  return summary?.overall.visitors;
}

/** True while the console has nothing to show and nothing is running (the Overview shows <FirstRun />). */
export function useFirstRun(): boolean {
  const { loop, autopilot, trafficOn, mock } = useDarwin();
  const visitors = useDemoStoreVisitors();
  return !mock && !autopilot && !trafficOn && loopIsFresh(loop) && visitors === 0;
}

/**
 * The one-click start used by every empty screen. On a fresh loop: "Watch Darwin improve the demo store"
 * (+ "Connect your store" when nothing is connected). Otherwise the plain "Let Darwin run".
 */
export function StartDemo({ align = "center", className }: { align?: "center" | "start"; className?: string }) {
  const { loop, setAutopilot, stepping } = useDarwin();
  const store = useStoreContext();
  const fresh = loopIsFresh(loop);
  return (
    <div className={cn("flex flex-col gap-2.5", align === "center" ? "items-center text-center" : "items-start", className)}>
      <div className={cn("flex flex-wrap gap-2.5 max-sm:w-full max-sm:flex-col", align === "center" && "justify-center")}>
        <PillButton size="lg" onClick={() => void setAutopilot(true)} disabled={stepping || !loop} className="max-sm:h-auto max-sm:min-h-12 max-sm:w-full max-sm:py-2.5">
          <Play /> {fresh ? "Watch Darwin improve the demo store" : "Let Darwin run"}
        </PillButton>
        {fresh && !store.connected && (
          <PillButton size="lg" tone="white" href="/onboarding" className="max-sm:w-full">
            Connect your store
          </PillButton>
        )}
      </div>
      {fresh && <p className="text-[13px] leading-snug text-dw-ink/65">Runs on PACE, a demo store, with simulated shoppers. Pause any time.</p>}
    </div>
  );
}

const STEPS: { kind: MascotKind; label: string; line: string; tab: string; href: string }[] = [
  { kind: "observer", label: "Watch", line: "Simulated people and AI agents shop the demo store.", tab: "Overview", href: "/console" },
  { kind: "analyst", label: "Find leaks", line: "Where they drop off, biggest first.", tab: "Issues", href: "/console/issues" },
  { kind: "designer", label: "Draft a fix", line: "A small page change Darwin can undo.", tab: "Fixes", href: "/console/fixes" },
  { kind: "experimenter", label: "Test it", line: "Half the shoppers see the fix. Darwin counts who buys.", tab: "Experiments", href: "/console/experiments" },
  { kind: "shipper", label: "Ship it", line: "The winner goes live. You can roll it back.", tab: "Changes", href: "/console/changes" },
];

/** The Overview before anything has happened: what Darwin will do, on which store, and the one click to start. */
export function FirstRun() {
  const store = useStoreContext();
  return (
    <section
      aria-labelledby="dw-first-run"
      className="grid gap-6 rounded-[26px] border border-dw-hairline bg-dw-surface p-7 max-sm:p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10 lg:p-9"
    >
      <div className="flex min-w-0 flex-col items-start gap-5">
        <Mascot kind="analyst" size={64} frame active />
        <div className="flex flex-col gap-3">
          <h2 id="dw-first-run" className="text-[32px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-[38px]">
            Watch Darwin improve a store, live
          </h2>
          <p className="max-w-[34rem] text-[17px] leading-snug text-dw-ink/75">
            {store.connected ? (
              <>
                Darwin&apos;s loop runs on <b className="font-semibold text-dw-ink">PACE</b>, a demo running-shoe store, so you can see every step before it touches{" "}
                {store.host ?? store.repo}.
              </>
            ) : (
              <>
                No store is connected yet, so start on <b className="font-semibold text-dw-ink">PACE</b>, Darwin&apos;s demo running-shoe store.
              </>
            )}{" "}
            Darwin sends it simulated shoppers, finds where they drop off, tests a fix and ships the winner.
          </p>
        </div>
        <StartDemo align="start" className="w-full" />
        <a
          href="/store"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded text-[14px] font-medium text-dw-ink/70 underline-offset-2 hover:text-dw-ink hover:underline focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
        >
          See the demo store as a shopper <ArrowUpRight className="size-3.5" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>

      <ol aria-label="What happens next" className="flex min-w-0 flex-col gap-1 self-center rounded-[22px] bg-dw-sand/60 p-2.5">
        {STEPS.map((s, i) => (
          <li key={s.kind}>
            <Link
              href={s.href}
              className="flex items-center gap-3.5 rounded-[16px] px-3 py-2.5 transition-colors hover:bg-dw-bg focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
            >
              <Mascot kind={s.kind} size={40} frame active={i === 0} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold">
                  {i + 1}. {s.label}
                </span>
                <span className="text-[13.5px] leading-snug text-dw-ink/70">{s.line}</span>
              </span>
              <span className="shrink-0 text-[12.5px] text-dw-ink/55 max-sm:hidden">{s.tab}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
