"use client";

import { Suspense, useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import { useExperiments, useSessions, useSummary } from "@/lib/console/hooks";
import { count } from "@/lib/console/format";
import { useDarwin } from "../provider";
import { Mascot } from "../mascot";
import { PageHead } from "../ui";
import { BuyersLostCard, WhereCard, WhoCard, type Focus } from "../issues/issue-cards";
import { IssueDetail } from "../issues/issue-detail";
import { IssueList } from "../issues/issue-list";
import { buildFixes, coverageSentence, rankIssues } from "../issues/model";
import { Shimmer } from "../issues/panel";
import { WatchingEmpty } from "../issues/watching";
import { useUrlSelection } from "../issues/use-selection";

/** Issues screen: every conversion leak Darwin found, biggest first, joined to a detail panel. */
export function IssuesScreen() {
  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={<IssuesSkeleton />}>
        <Issues />
      </Suspense>
    </MotionConfig>
  );
}

function Issues() {
  const { loop } = useDarwin();
  const experiments = useExperiments();
  const sessions = useSessions(40);
  const { summary } = useSummary(loop ? { specVersion: loop.liveSpec.version } : null, 5000);

  const rows = useMemo(() => rankIssues(loop, experiments), [loop, experiments]);
  const fixes = useMemo(() => buildFixes(loop, experiments), [loop, experiments]);
  const ids = useMemo(() => rows.map((r) => r.insight.id), [rows]);
  const { selected, select } = useUrlSelection(ids);
  const [focus, setFocus] = useState<Focus>(null);

  if (!loop) return <IssuesSkeleton />;
  if (!rows.length) return <WatchingEmpty />;

  const n = rows.length;
  const row = rows.find((r) => r.insight.id === selected) ?? rows[0];
  const current = loop.proposal ? fixes.find((f) => f.id === loop.proposal?.id) : undefined;
  const fix = current && row && loop.proposal?.insightIds.includes(row.insight.id) ? current : undefined;
  const past = row ? fixes.find((f) => f.id !== current?.id && f.insightIds.includes(row.insight.id)) : undefined;
  const sessionsSeen = summary?.overall.sessions;
  const nowTesting =
    current && loop.proposal
      ? { id: current.id, title: current.title, drafted: current.status === "drafted", nums: rows.filter((r) => loop.proposal?.insightIds.includes(r.insight.id)).map((r) => r.n) }
      : undefined;

  return (
    <>
      <PageHead
        mascot={<Mascot kind="analyst" size={52} frame active />}
        title={`${n} thing${n === 1 ? "" : "s"} stop${n === 1 ? "s" : ""} shoppers buying`}
        lede={
          <>
            {sessionsSeen ? `Darwin found ${n === 1 ? "it" : "them"} in ${count(sessionsSeen)} sessions (simulated shoppers included). ` : ""}
            {coverageSentence(rows)}
          </>
        }
      />

      <div className="grid gap-[14px] md:grid-cols-2 lg:h-[200px] lg:grid-cols-[1.4fr_1fr_1fr]">
        <div className="min-w-0 md:col-span-2 lg:col-span-1 [&>*]:h-full">
          <BuyersLostCard rows={rows} selected={row?.insight.id} onSelect={select} />
        </div>
        <WhoCard rows={rows} onFocus={setFocus} onSelect={select} />
        <WhereCard rows={rows} selected={row?.insight.id} onFocus={setFocus} onSelect={select} />
      </div>

      <div className="grid items-stretch gap-[14px] lg:grid-cols-[1fr_1.4fr]">
        <IssueList rows={rows} selected={row?.insight.id} focus={focus} onSelect={select} panelId="dw-issue-detail" />
        <IssueDetail id="dw-issue-detail" row={row} fix={fix} past={past} sessions={sessions} nowTesting={nowTesting} />
      </div>
    </>
  );
}

function IssuesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading issues" className="flex flex-col gap-4">
      <Shimmer className="h-14 w-[min(640px,90%)] rounded-full" />
      <Shimmer className="h-5 w-[min(520px,80%)] rounded-full" />
      <div className="mt-3 grid gap-[14px] lg:grid-cols-[1.4fr_1fr_1fr]">
        <Shimmer className="h-[200px]" />
        <Shimmer className="h-[200px]" />
        <Shimmer className="h-[200px]" />
      </div>
      <div className="grid gap-[14px] lg:grid-cols-[1fr_1.4fr]">
        <Shimmer className="h-[470px]" />
        <Shimmer className="h-[470px]" />
      </div>
    </div>
  );
}
