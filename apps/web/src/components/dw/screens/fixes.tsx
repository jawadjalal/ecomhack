"use client";

import { Suspense, useMemo } from "react";
import { MotionConfig } from "motion/react";
import { ArrowRight, Play, Sparkles } from "lucide-react";
import { useExperiments } from "@/lib/console/hooks";
import { useDarwin } from "../provider";
import { Mascot } from "../mascot";
import { PageHead, PillButton, PlainSurface } from "../ui";
import { InTestCard, ThrownAwayCard, UpNextCard } from "../issues/fix-cards";
import { FixDetail, FixList } from "../issues/fix-view";
import { buildFixes, insightArchive, rankIssues } from "../issues/model";
import { Shimmer } from "../issues/panel";
import { useUrlSelection } from "../issues/use-selection";
import { WatchingEmpty } from "../issues/watching";

/** Fixes screen: every settings change Darwin has proposed, its diff, and what happened to it. */
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
  const { loop, autopilot, stepping, step, setAutopilot } = useDarwin();
  const experiments = useExperiments();
  const rows = useMemo(() => rankIssues(loop, experiments), [loop, experiments]);
  const fixes = useMemo(() => buildFixes(loop, experiments), [loop, experiments]);
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
        lede="Darwin drafts a fix as soon as it knows what stops shoppers buying. Each one is a small settings change it can undo."
        line={loop.insights.length ? `Darwin has found ${loop.insights.length} issue${loop.insights.length === 1 ? "" : "s"} to work on.` : undefined}
        action={
          canDraft ? (
            draftButton
          ) : (
            <PillButton size="lg" onClick={() => void setAutopilot(true)} disabled={stepping}>
              <Play /> Let Darwin run
            </PillButton>
          )
        }
      />
    );
  }

  const fix = fixes.find((f) => f.id === selected) ?? fixes[0];
  const inTest = fixes.find((f) => f.status === "test");
  const drafted = fixes.find((f) => f.status === "drafted");
  const thrown = fixes.find((f) => f.status === "rejected" || f.status === "shelved");
  const shipped = fixes.filter((f) => f.status === "shipped").length;
  const covered = new Set(loop.proposal?.insightIds ?? []);
  const next = rows.find((r) => !covered.has(r.insight.id));
  const n = fixes.length;
  const tail = inTest ? "one in test" : drafted ? "one ready to test" : shipped ? `${shipped} shipped` : "none tested yet";

  const right = inTest ? (
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

  return (
    <PlainSurface>
      <PageHead
        mascot={<Mascot kind="designer" size={52} frame active />}
        title={`${n} fix${n === 1 ? "" : "es"}, ${tail}`}
        lede="Every fix is a small settings change Darwin can undo. Nothing reaches your store until it wins a test."
        right={right}
      />

      <div className="mt-8 grid items-start gap-10 lg:grid-cols-[minmax(240px,340px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col divide-y divide-dw-ink/10 border-t border-dw-ink/10">
          <div className="py-6">
            <InTestCard fix={inTest} rows={rows} hasDraft={Boolean(drafted)} />
          </div>
          <div className="py-6">
            <UpNextCard drafted={inTest ? undefined : drafted} next={next} testing={Boolean(inTest)} />
          </div>
          <div className="py-6">
            <ThrownAwayCard thrown={thrown} shipped={shipped} />
          </div>
          <div className="py-6">
            <FixList fixes={fixes} rows={rows} selected={fix.id} onSelect={select} panelId="dw-fix-detail" />
          </div>
        </div>
        <div className="min-w-0 lg:sticky lg:top-6">
          <FixDetail id="dw-fix-detail" fix={fix} rows={rows} archive={archive} loop={loop} autopilot={autopilot} stepping={stepping} step={step} />
        </div>
      </div>
    </PlainSurface>
  );
}

function FixesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading fixes" className="flex flex-col gap-4">
      <Shimmer className="h-14 w-[min(520px,90%)] rounded-full" />
      <Shimmer className="h-5 w-[min(640px,80%)] rounded-full" />
      <div className="mt-3 grid gap-[14px] lg:grid-cols-[1.5fr_1fr_1fr]">
        <Shimmer className="h-[240px]" />
        <Shimmer className="h-[240px]" />
        <Shimmer className="h-[240px]" />
      </div>
      <div className="grid gap-[14px] lg:grid-cols-[1fr_1.4fr]">
        <Shimmer className="h-[480px]" />
        <Shimmer className="h-[480px]" />
      </div>
    </div>
  );
}
