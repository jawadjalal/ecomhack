"use client";

/**
 * Overview (/console): greeting + one-line state of the store, four cards (Conversion, A vs B, Which agents
 * buy, How they convert), Live shoppers joined to a Journey panel, and the "Ask Darwin" prompt bar / chat.
 * Everything is real data from the console hooks; simulated shoppers are labelled.
 */
import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { PHASE_META } from "@/lib/console/format";
import { useExperiments, useNow, useSessions, useSummary } from "@/lib/console/hooks";
import { useDarwin } from "../provider";
import { AbCard, AgentsCard, ConversionCard, FunnelCard } from "../overview/cards";
import { DarwinChat, type Suggestion } from "../overview/chat";
import { EASE, Rise } from "../overview/fx";
import { useFirstName, usePeopleEvents } from "../overview/hooks";
import { ImpactStrip } from "../overview/impact";
import { agentBoard, agentShopper, chartPoints, pctSmart, peopleFromEvents, projectIfShipped, testView, type Shopper } from "../overview/model";
import { LiveShoppers } from "../overview/shoppers";

const recent = (a: Shopper, b: Shopper) => Date.parse(b.lastAt) - Date.parse(a.lastAt);

function greeting(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Watching humans…" → "watching humans…", but keeps "A/B testing…". */
function lowerFirst(s: string) {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

export function OverviewScreen() {
  const { loop, autopilot, setAutopilot, setTrafficOn } = useDarwin();
  const experiments = useExperiments();
  const { summary } = useSummary({}, 3000);
  const sessions = useSessions(80);
  const events = usePeopleEvents();
  const now = useNow();
  const firstName = useFirstName();
  const reduce = useReducedMotion();

  const test = useMemo(() => testView(loop, experiments), [loop, experiments]);
  const points = useMemo(() => chartPoints(loop?.history), [loop?.history]);
  const board = useMemo(() => agentBoard(sessions), [sessions]);
  const agents = useMemo(() => (sessions ?? []).map((s) => agentShopper(s, now)).sort(recent), [sessions, now]);
  const people = useMemo(() => peopleFromEvents(events, now), [events, now]);
  const finished = board.reduce((n, r) => n + r.shoppers, 0);
  const simulated = Boolean(
    sessions?.some((s) => s.synthetic) || events?.some((e) => e.properties.synthetic) || (summary && summary.overall.visitors > 0 && !events?.length),
  );

  const run = () => void setAutopilot(true);

  /* the one-line lede, from real numbers */
  const live = loop?.history.at(-1);
  const rate = live?.overallConversionRate ?? (summary?.overall.visitors ? summary.overall.conversionRate : undefined);
  let lede: ReactNode;
  if (rate === undefined) {
    lede = "Darwin hasn’t seen any shoppers yet. Let it run and this page fills up in seconds.";
  } else {
    const first = (
      <>
        Your store converts <b className="font-semibold text-dw-ink">{pctSmart(rate)}</b> of shoppers.{" "}
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
      lede = <>{first}Test B isn’t beating it yet, so your store stays as it is for now.</>;
    } else if (loop && loop.phase !== "idle") {
      lede = (
        <>
          {first}Right now Darwin is {lowerFirst(PHASE_META[loop.phase].blurb)}.
        </>
      );
    } else {
      lede = <>{first}Darwin is paused. Let it run to keep improving your store.</>;
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
    <div className="flex flex-col gap-7">
      <header className="flex flex-col gap-2.5 px-1 pt-1.5">
        <motion.h1
          className="min-h-[1.05em] text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[46px]"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={now ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          {now ? `${greeting(new Date(now).getHours())}${firstName ? `, ${firstName}` : ""}` : " "}
        </motion.h1>
        <motion.p
          className="max-w-[60rem] text-[17px] leading-[1.45] text-[#4A463D] sm:text-[18px]"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}
        >
          {lede}
        </motion.p>
      </header>

      <div className="flex flex-col gap-3.5">
        <Rise i={0}>
          <ImpactStrip loop={loop} experiments={experiments} simulated={simulated} />
        </Rise>
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Rise i={1}>
            <ConversionCard points={points} summary={summary} simulated={simulated} onRun={autopilot ? undefined : run} />
          </Rise>
          <Rise i={2}>
            <AbCard test={test} autopilot={autopilot} onRun={points.length ? run : undefined} />
          </Rise>
        </div>
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
          <Rise i={3}>
            <AgentsCard
              board={board}
              peopleRate={summary?.byKind.human.visitors ? summary.byKind.human.conversionRate : undefined}
              sample={finished}
              simulated={simulated}
            />
          </Rise>
          <Rise i={4}>
            <FunnelCard summary={summary} />
          </Rise>
        </div>
      </div>

      <Rise i={5}>
        <LiveShoppers agents={agents} people={people} loop={loop} test={test} board={board} summary={summary} onSendShoppers={() => setTrafficOn(true)} />
      </Rise>

      <DarwinChat suggestions={suggestions} />
    </div>
  );
}
