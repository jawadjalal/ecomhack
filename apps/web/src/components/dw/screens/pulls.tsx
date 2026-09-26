"use client";

import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useExperiments, useGithubStatus, useNow } from "@/lib/console/hooks";
import { BrandGlyph } from "../brand-logos";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Card, Empty, LiveDot, PageHead, PillButton, Typing } from "../ui";
import { buildPrRows, githubLive, indexLog, type PrRow } from "../experiments/model";
import { DiffCard, PrList, ProofCard } from "../experiments/pr-parts";
import { setHash, useHash } from "../experiments/use-hash";

function headline(row: PrRow): string {
  const n = row.pr.number;
  if (row.kind === "install") return n && row.state === "open" ? `PR #${n} installs Darwin` : "Darwin's analytics install";
  const gen = row.generation !== undefined ? `Gen ${row.generation}` : "The fix";
  if (row.state === "queued") return `${gen} is waiting for GitHub`;
  if (row.state === "open") return n ? `PR #${n} is ready for you` : `${gen} is ready for you`;
  return `${gen} is ready for review`;
}

/** Pull requests: the winning change as a diff, the test that proves it, and every PR Darwin drafted. */
export function PullRequestsScreen() {
  const { loop, mock, autopilot, setAutopilot } = useDarwin();
  const experiments = useExperiments();
  const { status } = useGithubStatus();
  const now = useNow();
  const hash = useHash();
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<string | undefined>();

  const idx = useMemo(() => indexLog(loop), [loop]);
  const rows = useMemo(() => buildPrRows(loop, status, experiments, idx), [loop, status, experiments, idx]);
  const live = !mock && githubLive(status);
  const sel = rows.find((r) => r.key === picked) ?? rows.find((r) => r.key === hash) ?? rows[0];
  const configPath = (status as { targetConfigPath?: unknown } | undefined)?.targetConfigPath;

  if (!loop) {
    return (
      <>
        <PageHead mascot={<Mascot kind="shipper" size={52} frame active />} title="Pull requests" lede={<span className="inline-flex items-center gap-2">Loading <Typing /></span>} />
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]" aria-hidden>
          <div className="h-[480px] animate-pulse rounded-[26px] bg-dw-surface" />
          <div className="h-[480px] animate-pulse rounded-[26px] bg-dw-olive/40" />
        </div>
      </>
    );
  }

  if (!sel) {
    return (
      <>
        <PageHead
          mascot={<Mascot kind="shipper" size={52} frame active />}
          title="No pull requests yet"
          lede="When a test wins, Darwin writes the change as a pull request for you to review. Nothing merges without you."
          right={
            !live ? (
              <PillButton tone="sand" size="lg" href="/onboarding">
                <BrandGlyph brand="github" /> Connect GitHub
              </PillButton>
            ) : undefined
          }
        />
        <Card tone="olive" shape="shipper" corner="br" hover={false}>
          <Empty
            mascot={<Mascot kind="shipper" size={88} frame active />}
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
            <span className="text-dw-ink/80">The first winning test lands here as a diff of your storefront config, with the numbers that prove it.</span>
          </Empty>
        </Card>
      </>
    );
  }

  const synthetic = mock || Boolean(sel.experiment && idx.rounds.get(sel.experiment.id)?.some((r) => r.synthetic));
  const lede =
    sel.kind === "install"
      ? "One script tag so Darwin can watch people and AI agents shop. Nothing merges without you."
      : `The winning fix, with the test that proves it. ${sel.state === "preview" && !live ? "Connect GitHub and Darwin opens it for real; nothing" : "Nothing"} merges without you.`;

  let actions: ReactNode = null;
  const seeTest = sel.experiment ? (
    <PillButton tone="sand" size="lg" href={`/console/experiments#${sel.experiment.id}`}>
      See the test
    </PillButton>
  ) : null;
  if (sel.state === "open" && sel.pr.url) {
    actions = (
      <>
        {seeTest}
        <a
          href={sel.pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-dw-ink px-6 text-[15px] font-medium text-white transition-[background-color,transform] hover:-translate-y-px hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
        >
          <BrandGlyph brand="github" /> Open on GitHub <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </>
    );
  } else if (sel.state !== "open" && !live) {
    actions = (
      <>
        {seeTest}
        <PillButton size="lg" href="/onboarding">
          <BrandGlyph brand="github" /> Connect GitHub
        </PillButton>
      </>
    );
  } else {
    actions = seeTest;
  }

  const select = (key: string) => {
    setPicked(key);
    setHash(key === rows[0]?.key ? undefined : key);
  };
  const stagger = (i: number) => ({
    initial: reduce ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.05 + i * 0.08, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] as const },
  });

  return (
    <>
      <PageHead mascot={<Mascot kind="shipper" size={52} frame active={sel.state !== "queued"} />} title={headline(sel)} lede={lede} right={actions} />

      <div key={sel.key} className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <motion.div {...stagger(0)} className="min-w-0">
          <DiffCard row={sel} configPath={typeof configPath === "string" ? configPath : "apps/web/storefront.config.json"} live={live} />
        </motion.div>
        <motion.div {...stagger(1)} className="min-w-0">
          <ProofCard row={sel} synthetic={synthetic} />
        </motion.div>
      </div>

      <motion.div {...stagger(2)}>
        <PrList rows={rows} selected={sel.key} onSelect={select} now={now} live={live} />
      </motion.div>
    </>
  );
}
