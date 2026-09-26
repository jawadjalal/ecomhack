"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { AgentSessionSummary } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { humanizePath, parseDiffLine } from "@/lib/console/format";
import { AgentTile, agentBrand } from "../agent-tile";
import { Mascot, Silhouette } from "../mascot";
import { ArmChip, DEPTH, DEPTH_SM, PillButton, TONE } from "../ui";
import { WhoMark, whoLabel } from "./who";
import {
  issueStats,
  sessionsFor,
  type FixRow,
  type IssueRow,
} from "./model";

const INK2 = "#4F4417";

/** What the fix card says and where its button goes, from the issue's status and the fixes history. */
function fixCopy(
  row: IssueRow,
  fix: FixRow | undefined,
  past: FixRow | undefined,
  rest: { n: number },
) {
  if (row.status === "test" && fix) {
    return {
      text: `${fix.title}. Ada is testing the new version against your current page right now.`,
      cta: "See the test",
      href: "/console/experiments",
    };
  }
  if (row.status === "drafted" && fix) {
    return {
      text: `${fix.title}. Theo drafted it. Ada starts an A vs B test next: half your shoppers see the new version.`,
      cta: "See the fix",
      href: `/console/fixes?id=${encodeURIComponent(fix.id)}`,
    };
  }
  if (past && (past.status === "rejected" || past.status === "shelved")) {
    return {
      text: `Theo tried “${past.title}” and it ${past.status === "rejected" ? "lost its test" : "made no clear difference"}. His next idea will be a different one.`,
      cta: "See that fix",
      href: `/console/fixes?id=${encodeURIComponent(past.id)}`,
    };
  }
  return {
    text:
      rest.n === 1
        ? "No fix yet. This is the biggest one, so Theo will likely take it on next."
        : "No fix yet. Ada runs one test at a time, so Theo starts with the biggest issues.",
    cta: "See all fixes",
    href: "/console/fixes",
  };
}

export function IssueDetail({
  row,
  fix,
  past,
  sessions,
  nowTesting,
  id,
}: {
  row?: IssueRow;
  /** What Darwin is testing right now (when it isn't this issue's fix). */
  nowTesting?: { id: string; title: string; nums: number[]; drafted: boolean };
  /** The loop's current proposal when it covers this issue. */
  fix?: FixRow;
  /** The most recent earlier fix that targeted this issue. */
  past?: FixRow;
  sessions?: AgentSessionSummary[];
  id: string;
}) {
  return (
    <section
      id={id}
      aria-live="polite"
      aria-label="Issue detail"
      className={cn("relative isolate flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[28px] px-5 py-[22px] sm:px-6", DEPTH)}
      style={{ background: TONE.yellow.bg }}
    >
      <Silhouette
        kind="observer"
        color={TONE.yellow.shape}
        size={240}
        style={{ right: -70, top: -90, zIndex: -1 }}
      />
      {!row && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Mascot kind="observer" size={72} frame active />
          <p className="max-w-[26rem] text-[16px] leading-snug">When Iris finds where shoppers get stuck, the details show up here.</p>
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        {row && (
          <motion.div
            key={row.insight.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-1 flex-col gap-4"
          >
            <DetailBody
              row={row}
              fix={fix}
              past={past}
              sessions={sessions}
              nowTesting={nowTesting}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function DetailBody({
  row,
  fix,
  past,
  sessions,
  nowTesting,
}: {
  row: IssueRow;
  fix?: FixRow;
  past?: FixRow;
  sessions?: AgentSessionSummary[];
  nowTesting?: { id: string; title: string; nums: number[]; drafted: boolean };
}) {
  const { insight } = row;
  const stats = issueStats(insight);
  const seen = sessionsFor(insight, sessions, 5);
  const copy = fixCopy(row, fix, past, { n: row.n });
  const evidence = insight.evidence.filter((e) => !/impact/i.test(e.label));

  return (
    <>
      <header className="flex flex-col gap-1 pr-10">
        <span className="text-[12.5px]" style={{ color: INK2 }}>
          Issue {row.n} · <WhoMark who={row.who} /> {whoLabel(row.who)} · {row.where}
        </span>
        <h2 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance">
          {insight.title}
        </h2>
        <p
          className="mt-1 max-w-[46rem] lg:line-clamp-2 text-[15px] leading-normal text-dw-ink/80"
          title={insight.detail}
        >
          {insight.detail}
        </p>
      </header>

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.06 }}
            className="flex min-w-0 flex-col-reverse gap-0.5"
          >
            <dt
              className="max-w-[14rem] truncate text-[12.5px]"
              style={{ color: INK2 }}
              title={s.label}
            >
              {s.label}
            </dt>
            <dd className="num text-[22px] leading-tight font-semibold">
              {s.value}
            </dd>
          </motion.div>
        ))}
      </dl>

      <div className="grid flex-1 gap-3.5 md:grid-cols-[1.2fr_1fr]">
        {/* Seen in */}
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[20px] px-[18px] py-4" style={{ background: TONE.yellow.shape }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Mascot kind="observer" size={24} frame active={false} />
              {seen.rows.length ? "Where Iris saw it" : "What Iris saw"}
            </span>
            {seen.rows.length > 0 && (
              <span className="text-right text-[12px]" style={{ color: INK2 }}>
                {seen.matched} of the last {seen.scanned} AI shopper visits
                {seen.rows.some((r) => r.synthetic) ? " · simulated" : ""}
              </span>
            )}
          </div>
          {seen.rows.length > 0 && (
            <ul className="flex flex-col gap-2">
              {seen.rows.map((s, i) => (
                <motion.li
                  key={s.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 + i * 0.05 }}
                  className="flex items-center gap-2.5 text-[14px] leading-snug"
                >
                  <AgentTile brand={agentBrand(s.name)} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-dw-ink/75"> · {s.what}</span>
                  </span>
                  {s.arm && <ArmChip arm={s.arm} className="size-5" />}
                </motion.li>
              ))}
            </ul>
          )}
          {evidence.length > 0 && (
            <ul
              className={cn(
                "flex flex-wrap gap-1.5",
                seen.rows.length > 0 &&
                  "mt-1 border-t border-dw-ink/10 pt-3",
              )}
            >
              {evidence.map((e, i) => (
                <motion.li
                  key={e.label}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.12 + i * 0.03 }}
                  className={cn("inline-flex max-w-full items-baseline gap-1.5 rounded-full bg-dw-surface px-3 py-1.5 text-[13px]", DEPTH_SM)}
                >
                  <span className="truncate text-dw-ink/65">{e.label}</span>
                  <span className="num font-semibold">{e.value}</span>
                </motion.li>
              ))}
            </ul>
          )}
          {seen.rows.length === 0 && insight.audience === "human" && (
            <p className="mt-auto text-[12.5px] text-dw-ink/65">
              People don&apos;t chat with the store, so these numbers come
              from what they tapped and viewed.
            </p>
          )}
        </div>

        {/* The fix */}
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[20px] border border-dw-hairline bg-dw-surface px-[18px] py-4">
          <div className="flex items-center gap-2.5">
            <Mascot
              kind="designer"
              size={30}
              frame
              active={row.status !== "queued"}
            />
            <span className="text-[14px] font-semibold">Theo&apos;s fix</span>
            {row.status === "test" && (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-dw-ink/60">
                <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" />{" "}
                in test
              </span>
            )}
            <PillButton
              href={copy.href}
              size="sm"
              tone={row.status === "queued" ? "sand" : "ink"}
              className="group/cta ml-auto"
            >
              {copy.cta}
              <ArrowRight className="transition-transform group-hover/cta:translate-x-0.5" />
            </PillButton>
          </div>
          <p
            className={cn(
              "text-[15px] leading-[1.45]",
              row.status === "queued" && "text-dw-ink/75",
            )}
          >
            {copy.text}
          </p>
          {row.status === "queued" && nowTesting && (
            <p className="rounded-2xl bg-dw-bg px-3.5 py-2.5 text-[13px] leading-snug text-dw-ink/75">
              {nowTesting.drafted ? "Theo just drafted" : "Ada is testing"}:{" "}
              <span className="font-semibold text-dw-ink">
                {nowTesting.title}
              </span>
              {nowTesting.nums.length
                ? ` (issue ${nowTesting.nums.join(", ")})`
                : ""}
              .
            </p>
          )}
          {fix?.diff.length ? (
            <div className="mt-auto flex flex-col gap-1 border-t border-dw-hairline pt-2.5">
              <span className="text-[12.5px] text-dw-ink/60">What changes on the page</span>
              <ul className="flex flex-col gap-0.5 text-[13px] text-dw-ink/80">
                {fix.diff.slice(0, 3).map((d) => (
                  <li key={d} className="truncate" title={d}>
                    {humanizePath(parseDiffLine(d).path)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
