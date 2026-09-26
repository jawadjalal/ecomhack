"use client";

/**
 * "Watch Darwin fix it": runs the real loop one phase at a time (the provider's `step()`, never
 * overlapping) so the audience sees observe → diagnose → propose → test → decide → ship in ~40 s.
 * A compact 6-step rail lights the current phase and each step raises one toast built from the loop
 * state the step returned (log entries, insights, proposal, verdict, history). Nothing is invented.
 * It stops by itself after one ship, when Darwin runs out of ideas, or after MAX_STEPS.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { ExperimentResult, LoopLogEntry, LoopPhase, LoopState } from "@/lib/contracts";
import { humanizeInsightText } from "@/lib/optimizer/humanize";
import { cn } from "@/components/ui/cn";
import { useDarwin } from "../provider";
import { countText, liftText, pctSmart } from "./model";
import { setLive } from "@/lib/console/live";

/** Safety cap: a test can need several rounds, and a "keep A" verdict sends Darwin back to diagnose. */
const MAX_STEPS = 14;
/** Pause between steps so each toast can be read. */
const GAP_MS = 1800;

const RAIL: { phase: Exclude<LoopPhase, "idle">; label: string }[] = [
  { phase: "observe", label: "Observe" },
  { phase: "diagnose", label: "Diagnose" },
  { phase: "propose", label: "Propose" },
  { phase: "experiment", label: "Test" },
  { phase: "decide", label: "Decide" },
  { phase: "ship", label: "Ship" },
];

const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

type Data = {
  simulation?: { humans?: number; agents?: number; events?: number };
  result?: ExperimentResult;
  round?: number;
  decision?: string;
  treatmentVersion?: number;
  pr?: { url?: string; number?: number; dryRun?: boolean };
  generation?: { generation: number; lift?: number };
};
const dataOf = (e: LoopLogEntry) => (e.data && typeof e.data === "object" ? (e.data as Data) : {});

/** One toast for the log entries a single step wrote, read from the state that step left behind. */
export function watchToast(loop: LoopState, fresh: LoopLogEntry[]): string | undefined {
  if (!fresh.length) return undefined;
  const find = (pred: (e: LoopLogEntry, d: Data) => boolean) => fresh.find((e) => pred(e, dataOf(e)));
  const last = fresh.at(-1)!;

  const failed = find((e) => e.actor === "system" && /^Step failed/.test(e.message));
  if (failed) return clip(failed.message);

  if (loop.phase === "ship") {
    const gen = loop.history.at(-1);
    const pr = find((_, d) => !!d.pr)?.message ?? find((e) => e.actor === "shipper" && /pull request|\bPR\b/i.test(e.message))?.message;
    const prText = !pr
      ? ""
      : /dry run/i.test(pr)
        ? "PR drafted (dry run)"
        : /no repository connected/i.test(pr)
          ? "no repo connected, so no PR"
          : /opened/i.test(pr)
            ? "PR opened"
            : "";
    return `Shipped Gen ${gen?.generation ?? loop.generation}${gen?.lift !== undefined ? `: ${liftText(gen.lift)}` : ""}${prText ? `, ${prText}` : ""}`;
  }
  if (loop.phase === "idle") return clip(last.message);

  const shelved = find((_, d) => d.decision === "reject" || d.decision === "inconclusive");
  if (shelved) {
    const verdict = find((_, d) => !!d.result && d.result.decision !== "running");
    const lift = verdict ? dataOf(verdict).result?.lift : undefined;
    return `Kept A: B didn’t beat it${lift !== undefined ? ` (${liftText(lift)})` : ""}. Back to the data`;
  }

  switch (loop.phase) {
    case "observe": {
      const sim = find((_, d) => !!d.simulation)?.data as Data | undefined;
      const h = sim?.simulation?.humans ?? 0;
      const a = sim?.simulation?.agents ?? 0;
      return h + a > 0 ? `Watching ${countText(h)} simulated shoppers and ${countText(a)} AI agents` : clip(fresh[0].message);
    }
    case "diagnose": {
      const top = loop.insights[0];
      return top ? clip(`Found: ${humanizeInsightText(top.title)}`) : clip(last.message);
    }
    case "propose":
      return loop.proposal ? clip(`Idea: ${loop.proposal.title}`) : clip(last.message);
    case "experiment": {
      const started = find((_, d) => d.treatmentVersion !== undefined);
      const round = find((_, d) => d.round !== undefined);
      const r = round ? dataOf(round) : undefined;
      if (started) return clip(`Testing B: ${loop.proposal?.title ?? "the new page"}…`);
      if (r?.result) return `Round ${r.round}: ${pctSmart(r.result.probabilityToBeat)} chance B wins`;
      return clip(last.message);
    }
    case "decide": {
      const v = find((_, d) => !!d.result && d.result.decision !== "running");
      const res = v ? dataOf(v).result : undefined;
      if (!res) return clip(last.message);
      return res.decision === "ship"
        ? `B wins: ${liftText(res.lift)}, ${pctSmart(res.probabilityToBeat)} sure. Shipping it`
        : `No winner: B ${liftText(res.lift)}, ${pctSmart(res.probabilityToBeat)} chance`;
    }
  }
  return clip(last.message);
}

export function useWatchRun() {
  const { loop, step, trafficOn, setTrafficOn, notify } = useDarwin();
  const [running, setRunning] = useState(false);
  const run = useRef(0);
  const seen = useRef(0);
  const loopRef = useRef(loop);

  // Toast every batch of new log entries while a run is on, from the state that batch came with.
  useEffect(() => {
    loopRef.current = loop;
    if (!loop) return;
    if (!running) {
      seen.current = loop.log.length;
      return;
    }
    if (loop.log.length < seen.current) seen.current = loop.log.length; // log was reset elsewhere
    const fresh = loop.log.slice(seen.current);
    if (!fresh.length) return;
    seen.current = loop.log.length;
    const text = watchToast(loop, fresh);
    if (text) notify(text, "info");
  }, [loop, running, notify]);

  const stop = useCallback(() => {
    run.current += 1;
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    const id = ++run.current;
    seen.current = loopRef.current?.log.length ?? 0;
    setRunning(true);
    setLive(true); // the cards follow the run while it plays
    if (!trafficOn) setTrafficOn(true);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const startLen = loopRef.current?.log.length ?? 0;
    let steps = 0;
    await wait(250);
    while (run.current === id && steps < MAX_STEPS) {
      await step(); // no-op if another step (autopilot) is in flight; the loop below still bounds the run
      steps += 1;
      await wait(120); // let the returned state render (and toast) before judging it
      if (run.current !== id) return;
      const now = loopRef.current;
      const moved = (now?.log.length ?? 0) > startLen;
      if (moved && (now?.phase === "ship" || now?.phase === "idle")) break;
      await wait(GAP_MS);
    }
    if (run.current === id) setRunning(false);
  }, [step, trafficOn, setTrafficOn]);

  // Leaving the page ends the run (the loop itself just stays where it is).
  useEffect(() => () => void (run.current += 1), []);

  // The watch_fix command (lib/commands/run.ts): /console?watch=1, or its "darwin:watch" event when already here.
  useEffect(() => {
    const go = () => void start();
    const q = new URLSearchParams(window.location.search);
    if (q.get("watch") === "1") {
      q.delete("watch");
      window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
      go();
    }
    window.addEventListener("darwin:watch", go);
    return () => window.removeEventListener("darwin:watch", go);
  }, [start]);

  return { running, start, stop };
}

/** The start / stop button (the run itself lives in `useWatchRun`, called once by the page). */
export function WatchButton({ running, onStart, onStop, className }: { running: boolean; onStart: () => void; onStop: () => void; className?: string }) {
  const { loop } = useDarwin();
  return (
    <button
      type="button"
      onClick={running ? onStop : onStart}
      disabled={!loop}
      aria-label={running ? "Stop watching Darwin" : "Watch Darwin fix it: run the loop once, step by step"}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-medium whitespace-nowrap transition-[background-color,transform] active:scale-[0.98] disabled:opacity-40 [&_svg]:size-3.5",
        running ? "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]" : "bg-dw-ink text-white hover:bg-black",
        className,
      )}
    >
      {running ? <Square fill="currentColor" aria-hidden /> : <Play fill="currentColor" aria-hidden />}
      {running ? "Stop" : "Watch Darwin fix it"}
    </button>
  );
}

/** Compact 6-step rail: the current phase is ink, the ones before it are filled, the rest outlined. */
export function WatchRail({ className }: { className?: string }) {
  const { loop, stepping, trafficOn } = useDarwin();
  const at = RAIL.findIndex((r) => r.phase === loop?.phase);
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      <ol aria-label="Darwin’s loop, step by step" className="grid w-full grid-cols-6 gap-1 sm:flex sm:w-auto">
        {RAIL.map((r, i) => {
          const on = i === at;
          const done = at >= 0 && i < at;
          return (
            <li
              key={r.phase}
              aria-current={on ? "step" : undefined}
              className={cn(
                "flex h-7 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-medium whitespace-nowrap transition-colors duration-300 sm:px-2.5 sm:text-[12px] lg:h-6",
                on ? "bg-dw-ink text-white" : done ? "bg-dw-ink/[0.12] text-dw-ink" : "border border-dw-ink/15 text-dw-ink/50",
              )}
            >
              {on && <span className={cn("size-1.5 shrink-0 rounded-full bg-dw-live", stepping && "dw-live-dot")} aria-hidden />}
              {r.label}
            </li>
          );
        })}
      </ol>
      <span className="text-[12.5px] text-dw-ink/55">{trafficOn ? "Live run on simulated shoppers" : "Live run"}</span>
    </div>
  );
}
