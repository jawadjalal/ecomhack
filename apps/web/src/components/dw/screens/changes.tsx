"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useSWRConfig } from "swr";
import { pct, signedPct } from "@/lib/console/format";
import { useExperiments, useGithubStatus, useLoop, useNow } from "@/lib/console/hooks";
import { BrandGlyph } from "../brand-logos";
import { CrewFace } from "../crew-face";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Card, CardTitle, Empty, LiveDot, PageHead, PillButton, PlainSurface, Typing } from "../ui";
import { Timeline, UpliftCards } from "../experiments/changes-parts";
import { appHref, buildChanges, githubLive, indexLog, uplift, type ChangeEntry } from "../experiments/model";
import { DiffCard, ProofCard } from "../experiments/pr-parts";
import { setHash, useHash } from "../experiments/use-hash";

/**
 * Changes: what Darwin changed on your store, the overall uplift since Gen 0, and rolling back.
 * Every change goes live on the store directly; a pull request is an optional extra when GitHub
 * is connected.
 */
export function ChangesScreen() {
  const { api, loop, mock, autopilot, setAutopilot, notify } = useDarwin();
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
      notify(`Gen ${entry.undoTo}'s store is live again.`, "info");
    } catch (e) {
      notify(`Rollback failed: ${(e as Error).message}`);
    } finally {
      setRollingBack(false);
    }
  };

  /* ---------------------------------------------------------------- loading / empty */

  if (!loop) {
    return (
      <PlainSurface>
        <PageHead mascot={<Mascot kind="shipper" size={52} frame state="thinking" />} title="Changes" lede={<span className="inline-flex items-center gap-2">Loading <Typing /></span>} />
        <div className="mt-8 h-[280px] animate-pulse bg-dw-ink/[0.04]" aria-hidden />
      </PlainSurface>
    );
  }

  const shipped = entries.filter((e) => e.kind === "shipped").length;
  const rolledBack = entries.filter((e) => e.kind === "rollback").length;

  if (!sel || entries.every((e) => e.kind === "baseline")) {
    return (
      <PlainSurface>
        <PageHead
          mascot={<CrewFace kind="shipper" />}
          title="No changes yet"
          lede="When a test wins, Darwin puts the change live on your store and shows you what it did to sales. You can roll any change back."
        />
        <Card tone="olive" shape="shipper" corner="br" hover={false} className="mt-6">
          <Empty
            mascot={<CrewFace kind="shipper" size={88} />}
            action={
              autopilot ? (
                <span className="inline-flex items-center gap-2 text-[14px] text-dw-ink/80">
                  <LiveDot /> Darwin is testing fixes <Typing />
                </span>
              ) : (
                <PillButton onClick={() => void setAutopilot(true)}>Let Darwin run</PillButton>
              )
            }
          >
            <span className="text-dw-ink/80">
              {running ? `The first test, “${running.name}”, is running now.` : "The first winning test lands here, with the numbers that prove it."}
            </span>
          </Empty>
        </Card>
      </PlainSurface>
    );
  }

  /* ---------------------------------------------------------------- copy */

  const title = `Darwin has shipped ${shipped} change${shipped === 1 ? "" : "s"}`;
  let lede: ReactNode = "Every change is live on your store the moment it wins. Roll any of them back below.";
  if (up) {
    const b = (s: string) => <b className="font-semibold text-dw-ink">{s}</b>;
    lede = (
      <>
        Shoppers convert {b(`${pct(up.all.before)} → ${pct(up.all.now)}`)}
        {up.all.lift !== undefined ? ` (${signedPct(up.all.lift)})` : ""}, people {pct(up.human.before)} → {pct(up.human.now)}, AI agents {b(`${pct(up.agent.before, 0)} → ${pct(up.agent.now, 0)}`)}.
        {rolledBack ? ` ${rolledBack} rollback${rolledBack === 1 ? "" : "s"}.` : ""}
        {synthetic ? " Simulated shoppers." : ""}
      </>
    );
  }

  const actions = (
    <>
      {running && (
        <PillButton tone="sand" size="lg" href={appHref(`/console/experiments#${running.id}`, mock)}>
          See the running test
        </PillButton>
      )}
      {!live && (
        <PillButton tone={running ? "ink" : "sand"} size="lg" href="/onboarding">
          <BrandGlyph brand="github" /> Also open pull requests
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
    <PlainSurface>
      <PageHead mascot={<CrewFace kind="shipper" />} title={title} lede={lede} right={actions} />

      {up && (
        <motion.div {...stagger(0)}>
          <UpliftCards up={up} synthetic={synthetic} shipped={shipped} />
        </motion.div>
      )}

      <div className="mt-10 grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
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
            <Card tone="olive" shape="shipper" corner="br" aria-label="Where Darwin started">
              <CardTitle>Where Darwin started</CardTitle>
              <p className="mt-3 text-[15px] leading-snug text-[#2F3517]">
                Gen 0 is your store as it was: {pct(sel.record.overallConversionRate)} of shoppers bought (people {pct(sel.record.humanConversionRate)}, AI agents{" "}
                {pct(sel.record.agentConversionRate)}). Every change above is measured against it.
              </p>
            </Card>
          ) : (
            <>
              <ProofCard
                row={sel.row}
                synthetic={synthetic}
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
    </PlainSurface>
  );
}
