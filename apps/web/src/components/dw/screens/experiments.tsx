"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { LoaderCircle } from "lucide-react";
import { count, pct, sourceBadge } from "@/lib/console/format";
import { useExperiments, useNow, useSamples } from "@/lib/console/hooks";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { StartDemo } from "../first-run";
import { Card, CardTitle, Empty, LiveDot, PageHead, PillButton, Typing, pct0 } from "../ui";
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

/** Who wrote the idea, for honesty: Darwin's playbook (heuristic) or a named LLM. */
function ideaSource(source: string | undefined): string | undefined {
  const b = sourceBadge(source);
  if (!b) return undefined;
  return b.label === "Heuristic" ? "Idea from Darwin's playbook" : `Idea from ${b.label}`;
}

/** Experiments: the A/B test Darwin is running (or the latest), its evidence, and every test so far. */
export function ExperimentsScreen() {
  const { loop, mock, step, stepping, autopilot, setAutopilot } = useDarwin();
  const experiments = useExperiments();
  const now = useNow();
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string | undefined>();
  const hash = useHash();

  const idx = useMemo(() => indexLog(loop), [loop]);
  const auto = pickExperiment(experiments, loop);
  const want = picked ?? (hash.startsWith("exp_") ? hash : undefined);
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
        <PageHead mascot={<Mascot kind="experimenter" size={52} frame active />} title="Experiments" lede={<span className="inline-flex items-center gap-2">Loading the tests <Typing /></span>} />
        <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
          <div className="h-[390px] animate-pulse rounded-[26px] bg-dw-surface" />
          <div className="h-[390px] animate-pulse rounded-[26px] bg-dw-yellow/40" />
        </div>
      </>
    );
  }

  if (!exp || !view) {
    return (
      <>
        <PageHead mascot={<Mascot kind="experimenter" size={52} frame active />} title="No tests yet" lede="When Darwin has a fix worth trying, it shows half your shoppers the new version and measures who buys." />
        <Card tone="pink" shape="experimenter" hover={false}>
          <Empty
            mascot={<Mascot kind="experimenter" size={88} frame active />}
            action={
              autopilot ? (
                <span className="inline-flex items-center gap-2 text-[14px] text-dw-ink/75">
                  <LiveDot /> Darwin is looking for the first fix <Typing />
                </span>
              ) : (
                <StartDemo />
              )
            }
          >
            The first A/B test starts right after Darwin finds a leak and designs a fix for it.
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
  let lede: ReactNode;
  if (!result || !m) lede = "The test just started: half of your shoppers see B. The first results land after one round of shoppers.";
  else if (running)
    lede = (
      <>
        Test B has a {P} of beating A after {count(m.visitors)} {noun}
        {sim}. Darwin ships it at {shipPct(rules.ship)}.
      </>
    );
  else if (view.outcome === "shipped")
    lede = (
      <>
        B won with a {P} of beating A after {count(m.visitors)} {noun}
        {sim}. Darwin shipped it{view.record ? ` as Gen ${view.record.generation}` : ""}.
      </>
    );
  else if (view.outcome === "lost")
    lede = (
      <>
        B lost: only a {P} of beating A after {count(m.visitors)} {noun}
        {sim}, so Darwin dropped it.
      </>
    );
  else if (view.outcome === "unclear")
    lede = (
      <>
        No clear winner after {count(m.visitors)} {noun}
        {sim} ({P} for B), so the store stayed on A.
      </>
    );
  else
    lede = (
      <>
        Stopped after {count(m.visitors)} {noun}
        {sim} with a {P} for B.
      </>
    );

  /* ---------------------------------------------------------------- actions (real APIs only) */

  const isLoopTest = running && loop.experimentId === exp.id;
  const nextStep: { text: string; href?: string } =
    view.outcome === "shipped" && view.record
      ? { text: `Live as Gen ${view.record.generation}`, href: appHref(`/console/changes#gen-${view.record.generation}`, mock) }
      : view.outcome === "lost"
        ? { text: "Dropped; the store stayed on A" }
        : view.outcome === "unclear"
          ? { text: "The store stayed on A" }
          : view.outcome === "stopped"
            ? { text: "Stopped before a verdict" }
            : isLoopTest && autopilot
              ? { text: "Autopilot reads the next round" }
              : isLoopTest
                ? { text: "Next round when you let Darwin decide" }
                : { text: "Waiting for the next round" };
  const canDecide = isLoopTest && (loop.phase === "experiment" || loop.phase === "decide");
  let actions: ReactNode = null;
  if (canDecide && autopilot) {
    actions = (
      <>
        <span className="inline-flex h-12 items-center gap-2 rounded-full bg-dw-surface px-5 text-[15px] shadow-[0_0_0_1px_#EDE4D2]">
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
          tip={`Sends the next round of shoppers and reads the result. Darwin never ships early: B goes live only once it's ${shipPct(rules.ship)} sure, and gets dropped under ${pct0(rules.drop)}.`}
        >
          <PillButton size="lg" onClick={() => void step()} disabled={stepping} aria-busy={stepping}>
            {stepping && <LoaderCircle className="animate-spin" aria-hidden />}
            Let Darwin decide
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
      </>
    );
  };

  const past = [...experiments].sort(newestFirst);
  const stagger = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.05 + i * 0.07, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const },
  });

  return (
    <>
      <PageHead mascot={<Mascot kind="experimenter" size={52} frame active={running} />} title={exp.name} lede={lede} right={actions} />

      <div key={exp.id} className="flex flex-col gap-4">
        <motion.div {...stagger(0)}>
          <ResultStrip result={result} outcome={view.outcome} rules={rules} synthetic={synthetic} next={nextStep} />
        </motion.div>
        <div className="grid gap-4 lg:grid-cols-2">
          <motion.div {...stagger(0)} className="min-w-0">
            <Card tone="white" className={`h-full px-5 py-5 sm:px-6 ${CARD_FILL} [&>.relative]:gap-3`} aria-label="A, today">
              <CardTitle right={<span className="text-[14px]">{armLine("A")}</span>}>A · {running ? "today" : "before"}</CardTitle>
              <div className="flex flex-1 flex-col [&>*]:flex-1">
                <SpecMock spec={view.control} other={exp.treatmentSpec} arm="A" page={view.page} />
              </div>
            </Card>
          </motion.div>
          <motion.div {...stagger(1)} className="min-w-0">
            <Card tone="yellow" shape="designer" className={`h-full px-5 py-5 sm:px-6 ${CARD_FILL} [&>.relative]:gap-3`} aria-label="B, the fix">
              <CardTitle right={<span className="text-[14px] text-[#4F4417]">{armLine("B")}</span>}>B · the fix</CardTitle>
              <div className="flex flex-1 flex-col [&>*]:flex-1">
                <SpecMock spec={exp.treatmentSpec} other={view.control} arm="B" page={view.page} />
              </div>
            </Card>
          </motion.div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <motion.div {...stagger(2)} className="min-w-0">
            <ChanceCard points={points} shipAt={rules.ship} early={rules.early} drop={rules.drop} decided={result && result.decision !== "running" ? result.decision : undefined} live={running} />
          </motion.div>
          <motion.div {...stagger(3)} className="min-w-0">
            <WhoBuysCard result={result} audience={m?.audience ?? "all"} synthetic={synthetic} />
          </motion.div>
        </div>

        <motion.div {...stagger(4)}>
          <WhatChangesCard rows={view.rows} source={ideaSource(view.proposal?.source)} />
        </motion.div>
      </div>

      {past.length > 1 && (
        <motion.div {...stagger(5)}>
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
      )}
    </>
  );
}
