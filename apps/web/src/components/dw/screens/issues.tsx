"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { useExperiments, useSessions, useSummary } from "@/lib/console/hooks";
import { count } from "@/lib/console/format";
import { useDarwin } from "../provider";
import { Mascot } from "../mascot";
import { LOOP_SPLIT, PageHead, SummaryStrip, type SummaryItem } from "../ui";
import { IssueDetail } from "../issues/issue-detail";
import { IssueList, type Focus } from "../issues/issue-list";
import { buildFixes, coverageSentence, fmtImpact, plural, rankIssues, resolvedIssues, STAGES, type IssueRow } from "../issues/model";
import { AgentStack, PeopleGroup } from "../issues/who";
import { ResolvedIssues } from "../issues/resolved";
import { Shimmer } from "../issues/panel";
import { WatchingEmpty } from "../issues/watching";
import { useUrlSelection } from "../issues/use-selection";

/** Issues screen: every place Iris saw shoppers get stuck, biggest first, joined to a detail panel. */
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
  const resolved = useMemo(() => resolvedIssues(loop, experiments), [loop, experiments]);
  const fixedBy = useMemo(() => {
    const out: Partial<Record<(typeof resolved)[number]["who"], number>> = {};
    for (const r of resolved) out[r.who] = (out[r.who] ?? 0) + 1;
    return out;
  }, [resolved]);
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

  const worst = STAGES.map((st) => ({ st, lost: rows.filter((r) => r.stage === st.key).reduce((t, r) => t + r.insight.impactScore, 0) })).sort((a, b) => b.lost - a.lost)[0];
  const worstText = worst && worst.lost > 0 ? ` The ${worst.st.key === "home" ? "home page loses" : worst.st.key === "product" ? "product pages lose" : `${worst.st.label.toLowerCase()} step loses`} the most buyers.` : "";

  return (
    <>
      <PageHead
        mascot={<Mascot kind="observer" size={52} frame active />}
        title={`${n} thing${n === 1 ? "" : "s"} stop${n === 1 ? "s" : ""} shoppers buying`}
        lede={
          <>
            Iris found {n === 1 ? "it" : "them"}
            {sessionsSeen ? ` in ${count(sessionsSeen)} visits (simulated shoppers included)` : ""}.{worstText} {coverageSentence(rows)}
          </>
        }
      />

      <SummaryStrip items={summaryItems(rows, fixedBy, select, setFocus, nowTesting)} />

      <div className={LOOP_SPLIT}>
        <IssueList rows={rows} selected={row?.insight.id} focus={focus} onSelect={select} panelId="dw-issue-detail">
          <ResolvedIssues items={resolved} />
        </IssueList>
        <IssueDetail id="dw-issue-detail" row={row} fix={fix} past={past} sessions={sessions} nowTesting={nowTesting} />
      </div>
    </>
  );
}

/** Four numbers: buyers lost, who is hit (people / AI agents, with silhouettes), and what is being fixed now. */
function summaryItems(
  rows: IssueRow[],
  fixed: Partial<Record<IssueRow["who"], number>>,
  select: (id: string) => void,
  setFocus: (f: Focus) => void,
  nowTesting: { id: string; drafted: boolean; nums: number[] } | undefined,
): SummaryItem[] {
  const total = rows.reduce((t, r) => t + r.insight.impactScore, 0);
  const max = Math.max(...rows.map((r) => r.insight.impactScore), 0.0001);
  const people = rows.filter((r) => r.who !== "Agents");
  const agents = rows.filter((r) => r.who !== "People");
  const lost = (l: IssueRow[]) => l.reduce((t, r) => t + r.insight.impactScore, 0);
  const toResolved = () => document.getElementById("dw-resolved")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const group = (key: "People" | "Agents", list: IssueRow[], tone: SummaryItem["tone"], noun: string, art: ReactNode): SummaryItem => {
    const done = fixed[key] ?? 0;
    return {
      key,
      tone,
      value: list.length,
      label: list.length ? `${plural(list.length, "issue").replace(/^\d+ /, "")} hit ${noun} · ${fmtImpact(lost(list))} buyers lost` : done ? `open for ${noun} · ${done} already fixed` : `issues hit ${noun}`,
      art,
      onClick: list.length ? () => select(list[0].insight.id) : done ? toResolved : undefined,
      onHover: (on) => setFocus(on ? { kind: "who", who: key } : null),
      ariaLabel: list.length ? `${plural(list.length, "issue")} hit ${noun}. Show the biggest.` : `No open issues for ${noun}.`,
    };
  };
  return [
    {
      key: "lost",
      tone: "yellow",
      value: fmtImpact(total),
      label: "buyers lost per 1,000 visits",
      art: (
        <span className="flex h-[52px] items-end gap-[5px]">
          {rows.slice(0, 6).map((r) => (
            <span key={r.insight.id} className="w-[9px] rounded-full bg-dw-ink/80" style={{ height: `${Math.max(9, Math.round((r.insight.impactScore / max) * 52))}px` }} />
          ))}
        </span>
      ),
      title: "Estimated from what shoppers did, biggest issue first",
    },
    group("People", people, "lilac", "people", <PeopleGroup size={42} color="#3B2F6B" />),
    group("Agents", agents, "blue", "AI agents", <AgentStack size={30} />),
    nowTesting
      ? {
          key: "now",
          tone: "pink",
          value: nowTesting.nums.length || "–",
          label: nowTesting.drafted ? `${nowTesting.nums.length === 1 ? "issue has" : "issues have"} a fix drafted by Theo` : `${nowTesting.nums.length === 1 ? "issue is" : "issues are"} being tested by Ada`,
          art: <Mascot kind={nowTesting.drafted ? "designer" : "experimenter"} size={44} frame active />,
          href: nowTesting.drafted ? `/console/fixes?id=${encodeURIComponent(nowTesting.id)}` : "/console/experiments",
          ariaLabel: nowTesting.drafted ? "See the fix Theo drafted" : "See the test Ada is running",
        }
      : {
          key: "now",
          tone: "pink",
          value: 0,
          label: "being tested right now",
          art: <Mascot kind="experimenter" size={44} frame active={false} />,
          href: "/console/fixes",
          ariaLabel: "Nothing in test. See all fixes",
        },
  ];
}

function IssuesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading issues" className="flex flex-col gap-4">
      <Shimmer className="h-14 w-[min(640px,90%)] rounded-full" />
      <Shimmer className="h-5 w-[min(520px,80%)] rounded-full" />
      <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Shimmer className="h-[100px]" />
        <Shimmer className="h-[100px]" />
        <Shimmer className="h-[100px]" />
        <Shimmer className="h-[100px]" />
      </div>
      <div className={LOOP_SPLIT}>
        <Shimmer className="h-[470px]" />
        <Shimmer className="h-[470px]" />
      </div>
    </div>
  );
}
