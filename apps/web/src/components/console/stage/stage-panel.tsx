"use client";

import { AnimatePresence, motion } from "motion/react";
import { Activity, Check, CornerDownLeft, Radar } from "lucide-react";
import type { AnalyticsSummary, Experiment, GenerationRecord, LoopPhase, LoopState } from "@/lib/contracts";
import type { PrInfo } from "@/lib/console/format";
import { PHASES, PHASE_META, phaseIndex } from "@/lib/console/format";
import { Panel } from "@/components/ui/panel";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/components/ui/cn";
import { PHASE_ICONS } from "../loop-ring";
import { GithubMark } from "../brand";
import { ObserveStage } from "./observe";
import { DiagnoseStage } from "./diagnose";
import { ProposeStage } from "./propose";
import { specQuery } from "./previews";
import { DecideStage, ExperimentStage } from "./experiment";
import { ShipStage } from "./ship";

function IdleStage({
  repo,
  trafficOn,
  hasEvents,
  onConnect,
}: {
  repo?: string;
  trafficOn: boolean;
  hasEvents: boolean;
  onConnect: () => void;
}) {
  const steps = [
    {
      done: Boolean(repo),
      title: repo ? `Connected ${repo}` : "Connect the store's repo",
      body: "Darwin opens a PR that installs analytics for humans and AI agents.",
      action: !repo && (
        <button onClick={onConnect} className="flex items-center gap-1.5 text-brand hover:underline">
          <GithubMark className="size-3.5" /> Connect
        </button>
      ),
    },
    {
      done: trafficOn || hasEvents,
      title: "Let shoppers in",
      body: "Simulated shoppers browse the store; AI shopping agents check stock, delivery and prices, then buy.",
      action: (
        <span className="flex items-center gap-1.5 text-white/50">
          Traffic <Kbd>T</Kbd>
        </span>
      ),
    },
    {
      done: false,
      title: "Start the loop",
      body: "Observe → diagnose → propose → A/B test → decide → ship a PR. Repeat.",
      action: (
        <span className="flex items-center gap-1.5 text-white/50">
          Step <Kbd>Space</Kbd> · Autopilot <Kbd>A</Kbd>
        </span>
      ),
    },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-6 px-2">
      <div>
        <div className="text-[0.8rem] font-medium tracking-[0.16em] text-brand uppercase">Ready</div>
        <h2 className="mt-1 text-[2.3rem] leading-tight font-semibold tracking-[-0.03em] text-white">
          The storefront that improves itself.
        </h2>
        <p className="mt-2 max-w-[44rem] text-[1rem] text-white/50">
          Darwin watches how humans and AI shopping agents move through PACE, finds where they drop, changes the page,
          proves it with an A/B test and ships the winner as a pull request.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <div
            key={s.title}
            className={cn("flex flex-col gap-2 rounded-xl border p-4", s.done ? "border-brand/30 bg-brand/[0.05]" : "border-white/[0.07] bg-white/[0.02]")}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[0.78rem] font-semibold",
                  s.done ? "bg-brand text-[#0b1200]" : "bg-white/[0.07] text-white/60",
                )}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className="truncate text-[0.98rem] font-semibold text-white/90">{s.title}</span>
            </div>
            <p className="text-[0.82rem] leading-relaxed text-white/50">{s.body}</p>
            <div className="mt-auto text-[0.8rem]">{s.action}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StagePanel({
  loop,
  viewPhase,
  onBackToLive,
  summaryGen,
  experiment,
  pr,
  pending,
  mock,
  repo,
  trafficOn,
  hasEvents,
  onConnect,
  onOpenPr,
}: {
  loop?: LoopState;
  viewPhase: LoopPhase;
  onBackToLive: () => void;
  summaryGen?: AnalyticsSummary;
  experiment?: Experiment;
  pr?: PrInfo;
  pending: boolean;
  mock: boolean;
  repo?: string;
  trafficOn: boolean;
  hasEvents: boolean;
  onConnect: () => void;
  onOpenPr: () => void;
}) {
  const phase = viewPhase;
  const live = loop?.phase ?? "idle";
  const peeking = phase !== live;
  const idx = phaseIndex(phase);
  const Icon = phase === "idle" ? Radar : PHASE_ICONS[phase];
  const history = loop?.history ?? [];
  const current: GenerationRecord | undefined = history.find((h) => h.generation === loop?.generation);
  const previous = current ? history.filter((h) => h.generation < current.generation).at(-1) : undefined;
  const liveSpec = loop?.liveSpec;
  // mock mode: the server's live spec isn't the simulated one, so preview the simulated spec explicitly
  const controlQuery = mock && liveSpec ? specQuery(liveSpec) : "variant=control";

  let body: React.ReactNode = null;
  if (!loop || !liveSpec) body = <div className="shimmer h-full rounded-xl" />;
  else if (phase === "idle") body = <IdleStage repo={repo} trafficOn={trafficOn} hasEvents={hasEvents} onConnect={onConnect} />;
  else if (phase === "observe") body = <ObserveStage summary={summaryGen} generation={loop.generation} />;
  else if (phase === "diagnose") body = <DiagnoseStage insights={loop.insights} targetedIds={loop.proposal?.insightIds ?? []} />;
  else if (phase === "propose")
    body = (
      <ProposeStage
        proposal={loop.proposal}
        liveSpec={liveSpec}
        treatmentSpec={experiment && experiment.proposalId === loop.proposal?.id ? experiment.treatmentSpec : undefined}
        controlQuery={controlQuery}
        mock={mock}
      />
    );
  else if (phase === "experiment") body = <ExperimentStage experiment={experiment} />;
  else if (phase === "decide") body = <DecideStage experiment={experiment} />;
  else if (phase === "ship")
    body = <ShipStage pr={pr} record={current} previous={previous} baseline={history[0]} onOpenPr={onOpenPr} />;

  return (
    <Panel glow={live === "ship" && !peeking} className="h-full">
      <header className="flex shrink-0 items-center gap-4 px-6 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-xl border",
              peeking ? "border-white/15 bg-white/[0.05] text-white/70" : "border-brand/30 bg-brand/10 text-brand",
            )}
          >
            <Icon className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <AnimatePresence mode="wait" initial={false}>
                <motion.h2
                  key={phase}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                  className="text-[1.35rem] leading-none font-semibold tracking-[-0.01em] text-white"
                >
                  {PHASE_META[phase].label}
                </motion.h2>
              </AnimatePresence>
              {pending && !peeking && (
                <span className="flex items-center gap-1.5 text-[0.78rem] text-white/45">
                  <Activity className="size-3.5 animate-pulse text-brand" /> working…
                </span>
              )}
            </div>
            <div className="mt-1 text-[0.85rem] text-white/45">{PHASE_META[phase].blurb}</div>
          </div>
        </div>
        <div className="flex-1" />
        {peeking && (
          <button
            onClick={onBackToLive}
            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-[0.8rem] text-white/80 hover:bg-white/10"
          >
            <CornerDownLeft className="size-3.5" /> Back to live: {PHASE_META[live].label}
          </button>
        )}
        {/* phase pips */}
        <div className="flex items-center gap-1.5" aria-label={`Phase ${idx + 1} of ${PHASES.length}`}>
          {PHASES.map((p, i) => (
            <span
              key={p}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                i === idx ? "w-6 bg-brand" : i < phaseIndex(live) ? "w-1.5 bg-brand/50" : "w-1.5 bg-white/15",
              )}
            />
          ))}
        </div>
      </header>
      <div className="relative min-h-0 flex-1 px-6 pb-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            className="h-full"
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </Panel>
  );
}
