"use client";

/**
 * Overview (/console): greeting + one-line state of the store, four cards (Conversion, A vs B, Which agents
 * buy, How they convert), Live shoppers joined to a Journey panel, and the "Ask Darwin" prompt bar / chat.
 * Everything is real data from the console hooks; simulated shoppers are labelled.
 */
import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { LoopState } from "@/lib/contracts";
import { PHASE_META } from "@/lib/console/format";
import { useExperiments, useNow, useSessions, useSummary } from "@/lib/console/hooks";
import { useDarwin } from "../provider";
import { AbCard, AgentsCard, ConversionCard, FunnelCard } from "../overview/cards";
import { AssistantSuggestions } from "@/components/console/assistant-panel";
import type { Suggestion } from "../overview/chat";
import { EASE, Rise } from "../overview/fx";
import { useFirstName, usePeopleEvents, useStoreSnapshot } from "../overview/hooks";
import { agentBrand } from "../agent-tile";
import { ImpactStrip } from "../overview/impact";
import { CardDeck, DECK_ITEM, DECK_ROW } from "../overview/deck";
import { cn } from "@/components/ui/cn";
import { agentBoard, agentShopper, chartPoints, pctSmart, peopleFromEvents, projectIfShipped, testView, type Shopper } from "../overview/model";
import { LiveShoppers } from "../overview/shoppers";
import { WatchButton, WatchRail, useWatchRun } from "../overview/watch";
import { FirstRun, FirstRunLede, useDemoStoreVisitors, useFirstRun } from "../first-run";

/** The demo store the loop runs on (the PageSpec storefront at /store). */
const STORE = "PACE";

const recent = (a: Shopper, b: Shopper) => Date.parse(b.lastAt) - Date.parse(a.lastAt);

function greeting(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The H1 is the outcome, from the same numbers as the impact strip: conversion at Gen 0 vs the live
 * generation. "Darwin made PACE 2.4× better at selling" (or "+35% better" under 2×). Undefined at Gen 0,
 * with no baseline, or when there's no real gain, so the page falls back to the greeting.
 */
function outcomeHeadline(loop: LoopState | undefined, liveRate?: number): string | undefined {
  const before = loop?.history[0];
  const generation = loop?.history.at(-1)?.generation ?? 0;
  if (!before || generation <= 0 || before.overallConversionRate <= 0 || liveRate === undefined) return undefined;
  const x = liveRate / before.overallConversionRate;
  if (!Number.isFinite(x) || x < 1.05) return undefined;
  return x >= 2 ? `Darwin made ${STORE} ${x.toFixed(1)}× better at selling` : `Darwin made ${STORE} ${Math.round((x - 1) * 100)}% better at selling`;
}

/** "Watching humans…" → "watching humans…", but keeps "A/B testing…". */
function lowerFirst(s: string) {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

export function OverviewScreen() {
  const { loop, autopilot, setAutopilot, setTrafficOn, mock } = useDarwin();
  const experiments = useExperiments();
  const snap = useStoreSnapshot(!mock);
  const { summary: polled } = useSummary({}, 3000);
  const summary = snap?.summary ?? polled;
  const sessions = useSessions(80);
  const events = usePeopleEvents();
  const now = useNow();
  const firstName = useFirstName();
  const reduce = useReducedMotion();

  const test = useMemo(() => testView(loop, experiments), [loop, experiments]);
  const points = useMemo(() => chartPoints(loop?.history), [loop?.history]);
  const sessionBoard = useMemo(() => agentBoard(sessions), [sessions]);
  const board = useMemo(
    () =>
      snap
        ? snap.brands.map((b) => ({ brand: agentBrand(b.name), shoppers: b.shoppers, bought: b.bought, rate: b.rate }))
        : sessionBoard,
    [snap, sessionBoard],
  );
  const agents = useMemo(() => (sessions ?? []).map((s) => agentShopper(s, now)).sort(recent), [sessions, now]);
  const people = useMemo(() => peopleFromEvents(events, now), [events, now]);
  const finished = board.reduce((n, r) => n + r.shoppers, 0);
  const simulated = snap
    ? snap.simulated
    : Boolean(sessions?.some((s) => s.synthetic) || events?.some((e) => e.properties.synthetic) || (summary && summary.overall.visitors > 0 && !events?.length));

  const run = () => void setAutopilot(true);
  const watch = useWatchRun();
  // Nothing connected, nothing seen, nothing running: show what Darwin will do instead of a pile of zeros.
  const firstRun = useFirstRun();
  const demoVisitors = useDemoStoreVisitors();

  /* the one-line lede, from real numbers */
  const live = loop?.history.at(-1);
  // The headline rate is the same snapshot the chat cites, not the latest generation's own rate.
  const seen = Boolean(demoVisitors || live?.humanVisitors || live?.agentVisitors || (loop?.history.length ?? 0) > 1 || summary?.overall.visitors);
  const rate = summary?.overall.visitors ? summary.overall.conversionRate : undefined;
  const hello = now ? `${greeting(new Date(now).getHours())}${firstName ? `, ${firstName}` : ""}` : undefined;
  const outcome = firstRun || rate === undefined ? undefined : outcomeHeadline(loop, rate);
  let lede: ReactNode;
  if (firstRun) {
    lede = <FirstRunLede />;
  } else if (snap?.kind === "empty") {
    lede = snap.emptyLine;
  } else if (rate === undefined || !seen) {
    lede = "Darwin hasn’t seen any shoppers yet. Let it run and this page fills up in seconds.";
  } else {
    const first = (
      <>
        {simulated ? "The demo store" : "Your store"} converts <b className="font-semibold text-dw-ink">{pctSmart(rate)}</b> of shoppers
        {simulated ? " (simulated)" : ""}.{" "}
      </>
    );
    const projected = test?.running ? projectIfShipped(live, test) : undefined;
    if (test?.running && projected !== undefined && (test.lift ?? 0) > 0) {
      lede = (
        <>
          {first}If test B ships, that becomes <b className="font-semibold text-dw-ink">{pctSmart(projected)}</b>.
        </>
      );
    } else if (test?.running && test.lift !== undefined) {
      lede = <>{first}Test B isn’t beating it yet, so the store stays as it is for now.</>;
    } else if (loop && loop.phase !== "idle") {
      lede = (
        <>
          {first}Right now Darwin is {lowerFirst(PHASE_META[loop.phase].blurb)}.
        </>
      );
    } else {
      lede = <>{first}Darwin is paused. Let it run to keep improving the store.</>;
    }
  }

  const leaver = agents.find((s) => s.status === "left" && s.kind === "agent");
  const suggestions: Suggestion[] = [
    test?.running
      ? { text: "Is test B safe to ship?", kind: "experimenter", tone: "#F3B5D5" }
      : { text: "What’s the biggest leak?", kind: "experimenter", tone: "#F3B5D5" },
    { text: test?.running ? "What should we test after this?" : "What should I do next?", kind: "designer", tone: "#F6D76B" },
    leaver
      ? { text: `Why did ${leaver.name} leave?`, kind: "observer", tone: "#B8CAEE" }
      : { text: "Which agents buy most?", kind: "observer", tone: "#B8CAEE" },
  ];

  return (
    <div className="flex flex-col gap-7 lg:-mt-2 lg:gap-6">
      {/* Desktop: the outcome and "Watch Darwin fix it" share row 1; the greeting + lede (or the live rail) is row 2. */}
      <header className="grid grid-cols-1 gap-2.5 px-1 pt-1.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-5 lg:gap-y-1 lg:pt-0">
        <motion.h1
          className="min-h-[1.05em] text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[44px] lg:col-start-1 lg:row-start-1 lg:whitespace-nowrap lg:text-[38px]"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={now ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          {outcome ?? hello ?? " "}
        </motion.h1>
        <motion.p
          className={cn(
            "max-w-[60rem] text-[17px] leading-[1.45] text-[#4A463D] sm:text-[18px] lg:col-span-2 lg:row-start-2 lg:min-w-0 lg:text-[16.5px]",
            watch.running && "lg:hidden",
          )}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}
        >
          {outcome && hello ? `${hello}. ` : ""}
          {lede}
        </motion.p>
        {!firstRun && (
          <WatchButton
            running={watch.running}
            onStart={() => void watch.start()}
            onStop={watch.stop}
            className="justify-self-start lg:col-start-2 lg:row-start-1"
          />
        )}
        {watch.running && <WatchRail className="lg:col-span-2 lg:row-start-2" />}
      </header>

      {firstRun ? (
        <Rise i={0}>
          <FirstRun />
        </Rise>
      ) : (
        <>
      <div className="flex flex-col gap-3.5 lg:gap-3">
        <Rise i={0}>
          <ImpactStrip
            loop={loop}
            experiments={experiments}
            simulated={simulated}
            nowRates={
              summary?.overall.visitors
                ? {
                    overall: summary.overall.conversionRate,
                    human: summary.byKind.human.conversionRate,
                    agent: summary.byKind.agent.conversionRate,
                  }
                : undefined
            }
          />
        </Rise>
        <CardDeck count={4} labels={["Conversion", "A vs B", "Which agents buy", "How they convert"]}>
          <div className={cn("grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-3", DECK_ROW)}>
            <Rise i={1} item className={DECK_ITEM}>
              <ConversionCard points={points} summary={summary} simulated={simulated} onRun={autopilot ? undefined : run} />
            </Rise>
            <Rise i={2} item className={DECK_ITEM}>
              <AbCard test={test} autopilot={autopilot} onRun={points.length ? run : undefined} />
            </Rise>
          </div>
          <div className={cn("grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-3", DECK_ROW)}>
            <Rise i={3} item className={DECK_ITEM}>
              <AgentsCard
                board={board}
                peopleRate={summary?.byKind.human.visitors ? summary.byKind.human.conversionRate : undefined}
                sample={finished}
                simulated={simulated}
              />
            </Rise>
            <Rise i={4} item className={DECK_ITEM}>
              <FunnelCard summary={summary} />
            </Rise>
          </div>
        </CardDeck>
      </div>

      <Rise i={5}>
        <LiveShoppers agents={agents} people={people} loop={loop} test={test} board={board} summary={summary} onSendShoppers={() => setTrafficOn(true)} />
      </Rise>
        </>
      )}

      <AssistantSuggestions suggestions={suggestions} />
    </div>
  );
}
