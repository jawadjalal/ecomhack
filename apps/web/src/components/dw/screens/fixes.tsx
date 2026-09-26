"use client";

import { Suspense, useMemo } from "react";
import { MotionConfig } from "motion/react";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import { useExperiments } from "@/lib/console/hooks";
import { useDarwin } from "../provider";
import { CrewFace } from "../crew-face";
import { Mascot } from "../mascot";
import { pct } from "@/lib/console/format";
import { LOOP_SPLIT, PageHead, PillButton, SummaryStrip, type SummaryItem } from "../ui";
import { FixDetail, FixList } from "../issues/fix-view";
import { FixMark } from "../issues/fix-parts";
import { buildFixes, insightArchive, rankIssues, type FixRow } from "../issues/model";
import { Shimmer } from "../issues/panel";
import { useUrlSelection } from "../issues/use-selection";
import { WatchingEmpty } from "../issues/watching";
import { StartDemo } from "../first-run";
import { runScope, useSticky } from "../issues/sticky";
import { StatusPill } from "../issues/status-pill";

/** Fixes screen: every page change Pixel has drafted, what it changes, and what happened to it. */
export function FixesScreen() {
  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<FixesSkeleton />}>
        <Fixes />
      </Suspense>
    </MotionConfig>
  );
}

function Fixes() {
  const { loop, autopilot, stepping, step } = useDarwin();
  const experiments = useExperiments();
  const freshRows = useMemo(() => rankIssues(loop, experiments), [loop, experiments]);
  const freshFixes = useMemo(() => buildFixes(loop, experiments), [loop, experiments]);
  // The loop clears insights and the proposal at the start of every observe phase: keep the last ones so
  // the page never swaps to its empty state and back mid-cycle.
  const scope = runScope(loop);
  const rows = useSticky("dw-fixes-rows-sticky", scope, freshRows).list;
  const fixes = useSticky("dw-fixes-sticky", scope, freshFixes).list;
  const archive = useMemo(() => insightArchive(loop), [loop]);
  const ids = useMemo(() => fixes.map((f) => f.id), [fixes]);
  const { selected, select } = useUrlSelection(ids);

  if (!loop) return <FixesSkeleton />;

  const canDraft = loop.phase === "diagnose" && !autopilot && loop.insights.length > 0;
  const draftButton = (
    <PillButton size="lg" onClick={() => void step()} disabled={stepping}>
      <Sparkles /> {stepping ? "Drafting…" : fixes.length ? "Draft next fix" : "Draft the first fix"}
    </PillButton>
  );

  if (!fixes.length) {
    return (
      <WatchingEmpty
        mascot="designer"
        title="No fixes yet"
        lede="Pixel drafts a fix as soon as Iris finds what stops shoppers buying. Each one is a small change to your page settings, and Dash can undo it."
        line={loop.insights.length ? `Iris has found ${loop.insights.length} issue${loop.insights.length === 1 ? "" : "s"} for Pixel to work on.` : undefined}
        action={
          canDraft ? draftButton : <StartDemo agent="pixel" />
        }
      />
    );
  }

  const fix = fixes.find((f) => f.id === selected) ?? fixes[0];
  const inTest = fixes.find((f) => f.status === "test");
  const drafted = fixes.find((f) => f.status === "drafted");
  const shipped = fixes.filter((f) => f.status === "shipped").length;
  const covered = new Set(loop.proposal?.insightIds ?? []);
  const next = rows.find((r) => !covered.has(r.insight.id));
  const n = fixes.length;
  const lostOrShelved = fixes.filter((f) => f.status === "rejected" || f.status === "shelved" || f.status === "stopped").length;
  const tail = inTest ? "one in test" : drafted ? "one ready to test" : shipped ? `${shipped} shipped` : "none tested yet";
  const upNext = drafted && !inTest ? `Up next: Fizz tests “${drafted.title}”.` : next && !inTest ? `Up next: a fix for issue ${next.n}, ${next.insight.title.replace(/[.]$/, "")}.` : "";

  const busy = autopilot || stepping;
  const between = !loop.proposal && (loop.phase === "observe" || loop.phase === "diagnose" || loop.phase === "propose");
  const status = inTest
    ? "Fizz is testing Pixel's fix"
    : between
      ? busy
        ? "Pixel is drafting the next fix…"
        : "Pixel drafts the next fix on the next step"
      : drafted
        ? "Pixel's fix is ready to test"
        : `Pixel is up to date with version ${loop.generation}`;
  const action = inTest ? (
    <PillButton href="/console/experiments" tone="white" className="group/cta">
      Watch the test <ArrowRight className="transition-transform group-hover/cta:translate-x-0.5" />
    </PillButton>
  ) : canDraft ? (
    draftButton
  ) : loop.phase === "propose" && drafted && !autopilot ? (
    <PillButton size="lg" onClick={() => void step()} disabled={stepping}>
      <Play /> {stepping ? "Starting…" : "Start the test"}
    </PillButton>
  ) : undefined;
  const right = (
    <div className="flex max-w-[calc(100vw-32px)] flex-wrap items-center justify-end gap-2.5">
      <StatusPill who="designer" live={busy && (between || Boolean(inTest))}>
        {status}
      </StatusPill>
      {action}
    </div>
  );

  return (
    <>
      <PageHead
        mascot={<CrewFace kind="designer" />}
        title={`${n} fix${n === 1 ? "" : "es"}, ${tail}`}
        lede={`Pixel drafted ${n === 1 ? "this fix" : `these ${n} fixes`}. Each is a small change to your page settings that Dash can undo, and nothing reaches your store until it wins a test. ${upNext}`.trim()}
        right={right}
      />

      <SummaryStrip items={summaryItems(n, inTest, drafted, shipped, lostOrShelved)} />

      <div className={LOOP_SPLIT}>
        <FixList fixes={fixes} rows={rows} selected={fix.id} onSelect={select} panelId="dw-fix-detail" />
        <FixDetail id="dw-fix-detail" fix={fix} rows={rows} archive={archive} loop={loop} autopilot={autopilot} stepping={stepping} step={step} />
      </div>
    </>
  );
}

/** Four numbers: drafted by Pixel, in test with Fizz, shipped by Dash, and the ones that lost. */
function summaryItems(n: number, inTest: FixRow | undefined, drafted: FixRow | undefined, shipped: number, lost: number): SummaryItem[] {
  const p = inTest?.probability;
  return [
    { key: "drafted", tone: "lilac", value: n, label: `${n === 1 ? "fix" : "fixes"} drafted by Pixel`, art: <Mascot kind="designer" size={44} frame active={Boolean(drafted)} /> },
    inTest
      ? {
          key: "test",
          tone: "pink",
          value: p !== undefined ? pct(p, 0) : "–",
          label: "chance the new version is better",
          art: <Mascot kind="experimenter" size={44} frame active />,
          href: "/console/experiments",
          ariaLabel: `In test now: ${inTest.title}. See the test`,
          title: inTest.title,
        }
      : {
          key: "test",
          tone: "pink",
          value: drafted ? 1 : 0,
          label: drafted ? "fix ready for Fizz to test" : "in test right now",
          art: <Mascot kind="experimenter" size={44} frame active={false} />,
          href: "/console/experiments",
          ariaLabel: "See tests",
        },
    { key: "shipped", tone: "olive", value: shipped, label: `${shipped === 1 ? "fix" : "fixes"} shipped by Dash`, art: <Mascot kind="shipper" size={44} frame active={false} />, href: "/console/changes", ariaLabel: `${shipped} shipped. See changes` },
    { key: "lost", tone: "sand", value: lost, label: "lost their test or set aside, never retried", art: <FixMark status="rejected" size={44} /> },
  ];
}

function FixesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading fixes" className="flex flex-col gap-4">
      <Shimmer className="h-14 w-[min(520px,90%)] rounded-full" />
      <Shimmer className="h-5 w-[min(640px,80%)] rounded-full" />
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Shimmer className="h-[100px]" />
        <Shimmer className="h-[100px]" />
        <Shimmer className="h-[100px]" />
        <Shimmer className="h-[100px]" />
      </div>
      <div className={LOOP_SPLIT}>
        <Shimmer className="h-[480px]" />
        <Shimmer className="h-[480px]" />
      </div>
    </div>
  );
}
