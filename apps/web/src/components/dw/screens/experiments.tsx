"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { LoaderCircle } from "lucide-react";
import { count, pct, sourceBadge } from "@/lib/console/format";
import { useExperiments, useNow, useSamples } from "@/lib/console/hooks";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { StartDemo } from "../first-run";
import { Card, DEPTH, Empty, LiveDot, PageHead, PillButton, SummaryStrip, Typing, pct0 } from "../ui";
import { LIST_DETAIL } from "../experiments/frame";
import { ChanceCard, WhoBuysCard, type ChancePoint } from "../experiments/charts";
import { PastExperiments, WhatChangesCard } from "../experiments/changes";
import {
  CARD_FILL,
  appHref,
  audienceNoun,
  chance,
  changeRows,
  controlSpecFor,
  decisionRules,
  diffFor,
  historyFor,
  indexLog,
  measured,
  outcomeOf,
  pageFor,
  pickExperiment,
} from "../experiments/model";
import { ResultStrip } from "../experiments/result-strip";
import { SpecMock } from "../experiments/spec-mock";
import { Tip } from "../experiments/tip";
import { setHash, useHash } from "../experiments/use-hash";

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
const shipPct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** Who drafted the idea, for honesty, without model names: AI or Darwin's rules. */
function ideaSource(source: string | undefined): string | undefined {
  const b = sourceBadge(source);
  if (!b) return undefined;
  return b.label === "Heuristic" ? "Pixel drafted it from Darwin's rules" : "Pixel drafted it with AI";
}

/** Experiments: every A vs B test Fizz ran (list left) and the selected one with its evidence (detail right). */
export function ExperimentsScreen() {
  const { loop, mock, step, stepping, autopilot, setAutopilot } = useDarwin();
  const experiments = useExperiments();
  const now = useNow();
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string | undefined>();
  const hash = useHash();

  const idx = useMemo(() => indexLog(loop), [loop]);
  const auto = pickExperiment(experiments, loop);
  // The URL fragment wins (deep links while the page is open); `picked` is the fallback.
  const want = (hash.startsWith("exp_") && experiments?.some((e) => e.id === hash) ? hash : undefined) ?? picked;
  const exp = (want ? experiments?.find((e) => e.id === want) : undefined) ?? auto;
  const result = exp?.result;
  const running = exp?.status === "running";
  const rules = decisionRules(mock);
  const rounds = useMemo(() => (exp ? (idx.rounds.get(exp.id) ?? []) : []), [exp, idx]);
  // The demo engine doesn't log rounds, so sample P(beat) as it moves (client-side) instead.
  const samples = useSamples(running && !rounds.length ? result?.probabilityToBeat : undefined, 40, exp?.id);

  const view = useMemo(() => {
    if (!exp) return undefined;
    const diff = diffFor(exp, loop, idx);
    const control = controlSpecFor(exp, loop, diff);
    const proposal = idx.proposals.get(exp.proposalId);
    return {
      diff,
      control,
      page: pageFor(diff),
      proposal,
      rows: changeRows(diff, proposal, idx, control),
      outcome: outcomeOf(exp, loop),
      record: historyFor(exp, loop),
    };
  }, [exp, loop, idx]);

  const points: ChancePoint[] = useMemo(() => {
    const start = { p: 0.5, label: "Start" };
    if (rounds.length) {
      const pts = [start, ...rounds.map((r) => ({ p: r.p, label: `Round ${r.round}` }))];
      if (result && Math.abs(result.probabilityToBeat - pts.at(-1)!.p) > 0.0005) pts.push({ p: result.probabilityToBeat, label: "Now" });
      return pts;
    }
    if (samples.length) return [start, ...samples.map((p, i) => ({ p, label: `Look ${i + 1}` }))];
    return result ? [start, { p: result.probabilityToBeat, label: "Now" }] : [start];
  }, [rounds, samples, result]);

  const synthetic = mock || rounds.some((r) => r.synthetic);

  /* ---------------------------------------------------------------- empty / loading */

  if (!experiments || !loop) {
    return (
      <>
        <PageHead mascot={<Mascot kind="experimenter" size={52} frame active />} title="Experiments" lede={<span className="inline-flex items-center gap-2">Fizz is loading the tests <Typing /></span>} />
        <div className="h-[92px] animate-pulse rounded-[22px] bg-dw-surface sm:h-[100px]" aria-hidden />
        <div className={LIST_DETAIL} aria-hidden>
          <div className="h-[420px] animate-pulse rounded-[28px] bg-dw-surface" />
          <div className="h-[420px] animate-pulse rounded-[28px] bg-dw-pink/40" />
        </div>
      </>
    );
  }

  if (!exp || !view) {
    return (
      <>
        <PageHead mascot={<Mascot kind="experimenter" size={52} frame active />} title="No tests yet" lede="When Pixel has a fix worth trying, Fizz shows half your shoppers the new version and counts who buys." />
        <Card tone="pink" shape="experimenter" hover={false} className={`rounded-[28px] ${DEPTH}`}>
          <Empty
            mascot={<Mascot kind="experimenter" size={88} frame active />}
            action={
              autopilot ? (
                <span className="inline-flex items-center gap-2 text-[14px] text-dw-ink/75">
                  <LiveDot /> Iris is looking for the first problem to fix <Typing />
                </span>
              ) : (
                <StartDemo agent="fizz" />
              )
            }
          >
            The first A vs B test starts right after Iris finds a problem and Pixel drafts a fix for it.
          </Empty>
        </Card>
      </>
    );
  }

  /* ---------------------------------------------------------------- copy */

  const m = result ? measured(result) : undefined;
  const noun = audienceNoun(m?.audience ?? "all");
  const sim = synthetic ? " (simulated)" : "";
  const P = result ? <b className="font-semibold text-dw-ink">{chance(result.probabilityToBeat)} chance</b> : null;
  const ver = view.record ? ` as version ${view.record.generation}` : "";
  let lede: ReactNode;
  if (!result || !m) lede = "Fizz just started this test: half of your shoppers see the new version. The first results land after one round of shoppers.";
  else if (running)
    lede = (
      <>
        {P} the new version is better after {count(m.visitors)} {noun}
        {sim}. Fizz ships it once it&apos;s {shipPct(rules.ship)} sure.
      </>
    );
  else if (view.outcome === "shipped")
    lede = (
      <>
        The new version won with a {P} of being better after {count(m.visitors)} {noun}
        {sim}. Dash shipped it{ver}.
      </>
    );
  else if (view.outcome === "lost")
    lede = (
      <>
        The new version lost: only a {P} of being better after {count(m.visitors)} {noun}
        {sim}, so Fizz dropped it.
      </>
    );
  else if (view.outcome === "unclear")
    lede = (
      <>
        No clear winner after {count(m.visitors)} {noun}
        {sim} ({P} for the new version), so your store kept its current page.
      </>
    );
  else
    lede = (
      <>
        Stopped after {count(m.visitors)} {noun}
        {sim} with a {P} for the new version.
      </>
    );

  /* ---------------------------------------------------------------- actions (real APIs only) */

  const isLoopTest = running && loop.experimentId === exp.id;
  const nextStep: { text: string; href?: string } =
    view.outcome === "shipped" && view.record
      ? { text: `Live as version ${view.record.generation}`, href: appHref(`/console/changes#gen-${view.record.generation}`, mock) }
      : view.outcome === "lost"
        ? { text: "Dropped. Your current page stayed" }
        : view.outcome === "unclear"
          ? { text: "Your current page stayed" }
          : view.outcome === "stopped"
            ? { text: "Stopped before a verdict" }
            : isLoopTest && autopilot
              ? { text: "Fizz reads the next round on autopilot" }
              : isLoopTest
                ? { text: "Next round when you let Fizz decide" }
                : { text: "Waiting for the next round" };
  const canDecide = isLoopTest && (loop.phase === "experiment" || loop.phase === "decide");
  let actions: ReactNode = null;
  if (canDecide && autopilot) {
    actions = (
      <>
        <span className={`inline-flex h-12 items-center gap-2 rounded-full bg-dw-surface px-5 text-[15px] ${DEPTH}`}>
          <LiveDot /> Autopilot is deciding
        </span>
        <PillButton tone="sand" size="lg" onClick={() => void setAutopilot(false)}>
          Pause autopilot
        </PillButton>
      </>
    );
  } else if (canDecide) {
    actions = (
      <>
        <PillButton tone="sand" size="lg" onClick={() => void setAutopilot(true)}>
          Turn on autopilot
        </PillButton>
        <Tip
          wide
          side="bottom"
          align="end"
          tip={`Sends the next round of shoppers and reads the result. Fizz never ships early: the new version goes live only once it's ${shipPct(rules.ship)} sure, and gets dropped under ${pct0(rules.drop)}.`}
        >
          <PillButton size="lg" onClick={() => void step()} disabled={stepping} aria-busy={stepping}>
            {stepping && <LoaderCircle className="animate-spin" aria-hidden />}
            Let Fizz decide
          </PillButton>
        </Tip>
      </>
    );
  } else if (view.outcome === "shipped" && view.record) {
    actions = (
      <PillButton size="lg" href={appHref(`/console/changes#gen-${view.record.generation}`, mock)}>
        See the change
      </PillButton>
    );
  }
  const choose = (id: string | undefined) => {
    setPicked(id);
    setHash(id);
  };
  if (auto && auto.id !== exp.id && auto.status === "running") {
    actions = (
      <>
        {actions}
        <PillButton tone="sand" size="lg" onClick={() => choose(auto.id)}>
          Back to the live test
        </PillButton>
      </>
    );
  }

  const armLine = (arm: "A" | "B") => {
    if (!m) return <span className="text-dw-ink/60">Waiting for shoppers</span>;
    const s = arm === "A" ? m.a : m.b;
    return (
      <>
        <span className={arm === "B" ? "font-semibold text-dw-ink" : ""}>{pct(s.conversionRate)} buy</span> · {count(s.visitors)} {noun}
        {sim}
      </>
    );
  };

  const past = [...experiments].sort(newestFirst);
  const wins = past.filter((e) => outcomeOf(e, loop) === "shipped").length;
  const dropped = past.filter((e) => {
    const o = outcomeOf(e, loop);
    return o === "lost" || o === "unclear";
  }).length;
  const liveTest = auto?.status === "running" ? auto : undefined;
  const tested = past.reduce((sum, e) => sum + (e.result ? measured(e.result).visitors : 0), 0);
  const nTests = past.length;
  const pageTitle = `${nTests} test${nTests === 1 ? "" : "s"}, ${wins} winner${wins === 1 ? "" : "s"}`;
  const pageLede = liveTest
    ? `Fizz is testing “${liveTest.name}” right now. Dash shipped ${wins} winner${wins === 1 ? "" : "s"} so far.`
    : `Fizz ran ${nTests} test${nTests === 1 ? "" : "s"} and Dash shipped ${wins} winner${wins === 1 ? "" : "s"}.${dropped ? ` Fizz dropped ${dropped} that didn't clearly help.` : ""}`;
  const stagger = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.05 + i * 0.07, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const },
  });
  const armCard = `h-full rounded-[28px] px-5 py-5 sm:px-6 ${CARD_FILL} ${DEPTH} [&>.relative]:gap-3`;

  return (
    <>
      <PageHead mascot={<Mascot kind="experimenter" size={52} frame active={Boolean(liveTest)} />} title={pageTitle} lede={pageLede} right={actions} />

      <SummaryStrip
        items={[
          { key: "tests", tone: "pink", value: count(nTests), label: "A vs B tests Fizz ran", art: <Mascot kind="experimenter" size={44} frame active={Boolean(liveTest)} /> },
          { key: "wins", tone: "olive", value: count(wins), label: "winners Dash shipped", art: <Mascot kind="shipper" size={44} frame active={false} />, href: appHref("/console/changes", mock), ariaLabel: `${wins} winners shipped. See changes` },
          liveTest
            ? {
                key: "live",
                tone: "yellow",
                value: chance(liveTest.result?.probabilityToBeat),
                label: "chance the new version is better, live test",
                art: <Mascot kind="designer" size={44} frame active />,
                title: liveTest.name,
              }
            : { key: "dropped", tone: "sand", value: count(dropped), label: "dropped, no clear gain", art: <Mascot kind="designer" size={44} frame active={false} /> },
          { key: "tested", tone: "blue", value: count(tested), label: `shoppers tested${synthetic ? " (simulated)" : ""}`, art: <Mascot kind="observer" size={44} frame active={false} /> },
        ]}
      />

      <div className={LIST_DETAIL}>
        <motion.div {...stagger(1)} className="min-w-0 max-lg:order-2">
          <PastExperiments
            experiments={past}
            loop={loop}
            selectedId={exp.id}
            now={now}
            mock={mock}
            onSelect={(id) => {
              choose(id);
              window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
            }}
          />
        </motion.div>

        <div key={exp.id} id="dw-exp-detail" className="flex min-w-0 flex-col gap-4">
          <motion.div {...stagger(0)}>
            <ResultStrip title={exp.name} lede={lede} result={result} outcome={view.outcome} rules={rules} synthetic={synthetic} next={nextStep} />
          </motion.div>
          <div className="grid gap-4 xl:grid-cols-2">
            <motion.div {...stagger(1)} className="min-w-0">
              <Card tone="white" className={armCard} aria-label="Your current page">
                <ArmHead title="Your current page" line={armLine("A")} />
                <div className="flex flex-1 flex-col [&>*]:flex-1">
                  <SpecMock spec={view.control} other={exp.treatmentSpec} arm="A" page={view.page} />
                </div>
              </Card>
            </motion.div>
            <motion.div {...stagger(2)} className="min-w-0">
              <Card tone="yellow" shape="designer" className={armCard} aria-label="The new version">
                <ArmHead title="The new version" line={<span className="text-[#4F4417]">{armLine("B")}</span>} />
                <div className="flex flex-1 flex-col [&>*]:flex-1">
                  <SpecMock spec={exp.treatmentSpec} other={view.control} arm="B" page={view.page} />
                </div>
              </Card>
            </motion.div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <motion.div {...stagger(3)} className="min-w-0">
              <ChanceCard points={points} shipAt={rules.ship} early={rules.early} drop={rules.drop} decided={result && result.decision !== "running" ? result.decision : undefined} live={running} />
            </motion.div>
            <motion.div {...stagger(4)} className="min-w-0">
              <WhoBuysCard result={result} audience={m?.audience ?? "all"} synthetic={synthetic} />
            </motion.div>
          </div>

          <motion.div {...stagger(5)}>
            <WhatChangesCard rows={view.rows} source={ideaSource(view.proposal?.source)} />
          </motion.div>
        </div>
      </div>
    </>
  );
}

function ArmHead({ title, line }: { title: string; line: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</h2>
      <p className="num text-[13px] text-dw-ink/70">{line}</p>
    </div>
  );
}
