"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useSWRConfig } from "swr";
import { pct, signedPct } from "@/lib/console/format";
import { useExperiments, useGithubStatus, useLoop, useNow } from "@/lib/console/hooks";
import { BrandGlyph } from "../brand-logos";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { StartDemo } from "../first-run";
import { Card, CardTitle, Empty, LiveDot, PageHead, PillButton, Typing } from "../ui";
import { Timeline } from "../experiments/changes-parts";
import { DEPTH, LIST_DETAIL, SummaryStrip, type StripCell } from "../experiments/frame";
import { appHref, buildChanges, githubLive, indexLog, uplift, type ChangeEntry } from "../experiments/model";
import { DiffCard, ProofCard } from "../experiments/pr-parts";
import { setHash, useHash } from "../experiments/use-hash";

/**
 * Changes: every winner Max shipped (list left) and the proof and settings behind the selected one
 * (detail right), plus undo. Every change goes live on the store directly; a code change on GitHub
 * is an optional extra when GitHub is connected.
 */
export function ChangesScreen() {
  const { api, loop, mock, autopilot, notify } = useDarwin();
  const { mutate: mutateLoop } = useLoop();
  const { mutate } = useSWRConfig();
  const experiments = useExperiments();
  const { status } = useGithubStatus();
  const now = useNow();
  const hash = useHash();
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<string | undefined>();
  const [rollingBack, setRollingBack] = useState(false);

  const idx = useMemo(() => indexLog(loop), [loop]);
  const entries = useMemo(() => buildChanges(loop, status, experiments, idx), [loop, status, experiments, idx]);
  const up = useMemo(() => uplift(loop), [loop]);
  const live = !mock && githubLive(status);
  const synthetic = mock || [...idx.rounds.values()].some((rs) => rs.some((r) => r.synthetic));
  const sel = entries.find((e) => e.key === picked) ?? entries.find((e) => e.key === hash) ?? entries.find((e) => e.kind !== "baseline") ?? entries[0];
  const running = loop?.experimentId ? experiments?.find((e) => e.id === loop.experimentId && e.status === "running") : undefined;
  const configPath = (status as { targetConfigPath?: unknown } | undefined)?.targetConfigPath;

  const select = (key: string) => {
    setPicked(key);
    setConfirming(undefined);
    setHash(key);
  };

  const rollback = async (entry: ChangeEntry) => {
    if (entry.undoTo === undefined) return;
    setRollingBack(true);
    try {
      const next = await api.rollback(entry.undoTo);
      await mutateLoop(next, { revalidate: false });
      void mutate((key) => Array.isArray(key) && (key[1] === "experiments" || key[1] === "github"));
      setConfirming(undefined);
      select(`gen-${next.generation}`);
      notify(`Max put version ${entry.undoTo} back live.`, "info");
    } catch (e) {
      notify(`Undo failed: ${(e as Error).message}`);
    } finally {
      setRollingBack(false);
    }
  };

  /* ---------------------------------------------------------------- loading / empty */

  if (!loop) {
    return (
      <>
        <PageHead mascot={<Mascot kind="shipper" size={52} frame active />} title="Changes" lede={<span className="inline-flex items-center gap-2">Max is loading your changes <Typing /></span>} />
        <div className="h-[76px] animate-pulse rounded-[28px] bg-dw-surface" aria-hidden />
        <div className={LIST_DETAIL} aria-hidden>
          <div className="h-[420px] animate-pulse rounded-[28px] bg-dw-surface" />
          <div className="h-[420px] animate-pulse rounded-[28px] bg-dw-olive/40" />
        </div>
      </>
    );
  }

  const shipped = entries.filter((e) => e.kind === "shipped").length;
  const rolledBack = entries.filter((e) => e.kind === "rollback").length;

  if (!sel || entries.every((e) => e.kind === "baseline")) {
    return (
      <>
        <PageHead
          mascot={<Mascot kind="shipper" size={52} frame active />}
          title="No changes yet"
          lede="When one of Ada's tests wins, Max puts the change live on your store and shows you what it did to sales. He can undo any change."
        />
        <Card tone="olive" shape="shipper" corner="br" hover={false} className={`rounded-[28px] ${DEPTH}`}>
          <Empty
            mascot={<Mascot kind="shipper" size={88} frame active />}
            action={
              autopilot ? (
                <span className="inline-flex items-center gap-2 text-[14px] text-dw-ink/80">
                  <LiveDot /> Ada is testing fixes <Typing />
                </span>
              ) : (
                <StartDemo />
              )
            }
          >
            <span className="text-dw-ink/80">
              {running ? `Ada's first test, “${running.name}”, is running now.` : "The first winning test lands here, with the numbers that prove it."}
            </span>
          </Empty>
        </Card>
      </>
    );
  }

  /* ---------------------------------------------------------------- copy */

  const title = `${shipped} winning change${shipped === 1 ? "" : "s"} shipped`;
  const lede: ReactNode = (
    <>
      Max shipped {shipped === 1 ? "one winner" : `${shipped} winners`} from Ada&apos;s tests, each live the moment it won.
      {rolledBack ? ` He undid ${rolledBack === 1 ? "one" : rolledBack}.` : ""} He can undo any of them.
      {synthetic ? " Simulated shoppers." : ""}
    </>
  );
  const arrow = (a: string, b: string) => (
    <>
      <span className="text-dw-ink/55">{a}</span>
      <ArrowRight className="size-4 self-center text-dw-ink/45" aria-label="to" />
      <span>{b}</span>
    </>
  );
  const lift = (x: number | undefined) => (x !== undefined ? `, ${signedPct(x)}` : "");
  const perK = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x))}`;
  const cells: StripCell[] = up
    ? [
        {
          value: arrow(pct(up.all.before), pct(up.all.now)),
          label: `of shoppers buy${lift(up.all.lift)}`,
          tone: "yellow",
          shape: "shipper",
          title: "Weighted to your usual mix of people and AI agents, so it only moves when the store does, not when the traffic mix does.",
        },
        { value: arrow(pct(up.human.before), pct(up.human.now)), label: `of people buy${lift(up.human.lift)}`, tone: "lilac", shape: "analyst" },
        { value: arrow(pct(up.agent.before, 0), pct(up.agent.now, 0)), label: `of AI agents buy${lift(up.agent.lift)}`, tone: "blue", shape: "observer" },
        { value: perK(up.all.per1000), label: `more buyers per 1,000 visitors${synthetic ? " (simulated)" : ""}`, tone: "olive", shape: "shipper" },
      ]
    : [
        { value: String(shipped), label: "winners Max shipped", tone: "olive", shape: "shipper" },
        { value: String(rolledBack), label: "undone", tone: "sand" },
        { value: `Version ${loop.generation}`, label: "live on your store now", tone: "yellow", shape: "designer" },
      ];

  const actions = (
    <>
      {running && (
        <PillButton tone="sand" size="lg" href={appHref(`/console/experiments#${running.id}`, mock)}>
          See the live test
        </PillButton>
      )}
      {!live && (
        <PillButton tone={running ? "ink" : "sand"} size="lg" href="/onboarding">
          <BrandGlyph brand="github" /> Connect GitHub for code changes
          <ArrowRight aria-hidden />
        </PillButton>
      )}
    </>
  );

  const stagger = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.05 + i * 0.08, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const },
  });

  return (
    <>
      <PageHead mascot={<Mascot kind="shipper" size={52} frame active />} title={title} lede={lede} right={actions} />

      <SummaryStrip label="Before Darwin vs now" cells={cells} />

      <div className={LIST_DETAIL}>
        <motion.div {...stagger(1)} className="min-w-0">
          <Timeline
            entries={entries}
            selected={sel.key}
            onSelect={select}
            now={now}
            mock={mock}
            synthetic={synthetic}
            testing={running ? { id: running.id, name: running.name, p: running.result?.probabilityToBeat } : undefined}
            confirming={confirming}
            onConfirm={setConfirming}
            onRollback={(e) => void rollback(e)}
            rollingBack={rollingBack}
            githubLive={live}
          />
        </motion.div>

        <motion.div key={sel.key} {...stagger(2)} className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6">
          {sel.kind === "baseline" ? (
            <Card tone="olive" shape="shipper" corner="br" className={`rounded-[28px] ${DEPTH}`} aria-label="Where Darwin started">
              <CardTitle className="[&_h2]:text-[20px]">Where Darwin started</CardTitle>
              <p className="mt-3 text-[15px] leading-snug text-[#2F3517]">
                Version 0 is your store as it was: {pct(sel.record.overallConversionRate)} of shoppers bought (people {pct(sel.record.humanConversionRate)}, AI agents{" "}
                {pct(sel.record.agentConversionRate)}). Every change is measured against it.
              </p>
            </Card>
          ) : (
            <>
              <ProofCard
                row={sel.row}
                synthetic={synthetic}
                compact
                restored={
                  sel.kind === "rollback" && sel.restores !== undefined
                    ? { generation: sel.restores, human: sel.record.humanConversionRate, agent: sel.record.agentConversionRate }
                    : undefined
                }
              />
              <DiffCard
                row={sel.row}
                heading={sel.kind === "rollback" ? "What came back" : "What changed"}
                compact
                configPath={typeof configPath === "string" ? configPath : "apps/web/storefront.config.json"}
                live={live}
              />
            </>
          )}
        </motion.div>
      </div>
    </>
  );
}
