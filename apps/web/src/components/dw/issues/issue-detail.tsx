"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import type { AgentSessionSummary } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { AgentTile, agentBrand } from "../agent-tile";
import { Mascot, Silhouette } from "../mascot";
import { ArmChip, PillButton, TONE } from "../ui";
import { fmtImpact, issueStats, sessionsFor, type FixRow, type IssueRow } from "./model";

const INK2 = "#5A2744";

/** What the fix card says and where its button goes, from the issue's status and the fixes history. */
function fixCopy(row: IssueRow, fix: FixRow | undefined, past: FixRow | undefined, rest: { n: number }) {
  if (row.status === "test" && fix) {
    return {
      text: `${fix.title}. Live in test B now, measured against your current store.`,
      cta: "See the test",
      href: "/console/experiments",
    };
  }
  if (row.status === "drafted" && fix) {
    return {
      text: `${fix.title}. Drafted and waiting for its A/B test to start.`,
      cta: "See the fix",
      href: `/console/fixes?id=${encodeURIComponent(fix.id)}`,
    };
  }
  if (past && (past.status === "rejected" || past.status === "shelved")) {
    return {
      text: `Darwin tried “${past.title}” and it ${past.status === "rejected" ? "lost its test" : "showed no clear effect"}. The next idea will be a different one.`,
      cta: "See that fix",
      href: `/console/fixes?id=${encodeURIComponent(past.id)}`,
    };
  }
  return {
    text:
      rest.n === 1
        ? "No fix drafted yet. This is the biggest leak, so Darwin will likely take it on next."
        : "No fix drafted yet. Darwin runs one test at a time and usually starts with the biggest leaks.",
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
      className="relative isolate flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-[26px] px-6 py-6 sm:px-7"
      style={{ background: TONE.pink.bg }}
    >
      <Silhouette kind="experimenter" color={TONE.pink.shape} size={240} style={{ right: -70, top: -90, zIndex: -1 }} />
      <AnimatePresence mode="wait" initial={false}>
        {row && (
          <motion.div
            key={row.insight.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-1 flex-col gap-[18px]"
          >
            <DetailBody row={row} fix={fix} past={past} sessions={sessions} nowTesting={nowTesting} />
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
      <header className="flex flex-col gap-1.5 pr-10">
        <span className="text-[13px]" style={{ color: INK2 }}>
          Issue {row.n} · {row.who} · {row.where}
        </span>
        <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance">{insight.title}</h2>
        <p className="mt-1 max-w-[46rem] text-[15px] leading-relaxed text-dw-ink/80">{insight.detail}</p>
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
            <dt className="max-w-[14rem] truncate text-[12px] tracking-[0.02em] uppercase" style={{ color: INK2 }} title={s.label}>
              {s.label}
            </dt>
            <dd className="num text-[22px] leading-tight font-semibold">{s.value}</dd>
          </motion.div>
        ))}
      </dl>

      <div className="grid flex-1 gap-3.5 md:grid-cols-[1.2fr_1fr]">
        {/* Seen in */}
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[20px] bg-white/60 px-[18px] py-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px]" style={{ color: INK2 }}>
              {seen.rows.length ? "Seen in" : "What Darwin saw"}
            </span>
            {seen.rows.length > 0 && (
              <span className="text-right text-[12px]" style={{ color: INK2 }}>
                {seen.matched} of the last {seen.scanned} agent sessions{seen.rows.some((r) => r.synthetic) ? " · simulated" : ""}
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
            <ul className={cn("flex flex-wrap gap-1.5", seen.rows.length > 0 && "mt-1 border-t border-[#5A2744]/10 pt-3")}>
              {evidence.map((e, i) => (
                <motion.li
                  key={e.label}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.12 + i * 0.03 }}
                  className="inline-flex max-w-full items-baseline gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px]"
                >
                  <span className="truncate text-dw-ink/65">{e.label}</span>
                  <span className="num font-semibold">{e.value}</span>
                </motion.li>
              ))}
            </ul>
          )}
          {seen.rows.length === 0 && insight.audience === "human" && (
            <p className="text-[12px] text-dw-ink/60">People don&apos;t leave tool calls behind, so these numbers come from their page events.</p>
          )}
          <span className="mt-auto truncate pt-2 font-dwmono text-[12px] text-[#8A6275]" title={insight.id}>
            {[insight.id.replace(/^ins_/, ""), insight.stage, `${fmtImpact(insight.impactScore)}/1k`].join(" · ")}
          </span>
        </div>

        {/* The fix */}
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[20px] bg-white px-[18px] py-4">
          <div className="flex items-center gap-2.5">
            <Mascot kind="designer" size={30} frame active={row.status !== "queued"} />
            <span className="text-[14px] font-semibold">The fix</span>
            {row.status === "test" && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-dw-ink/60">
                <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" /> testing
              </span>
            )}
          </div>
          <p className={cn("text-[15px] leading-[1.45]", row.status === "queued" && "text-dw-ink/75")}>{copy.text}</p>
          {row.status === "queued" && nowTesting && (
            <p className="rounded-2xl bg-dw-bg px-3.5 py-2.5 text-[13px] leading-snug text-dw-ink/75">
              {nowTesting.drafted ? "Drafted right now" : "In test right now"}: <span className="font-semibold text-dw-ink">{nowTesting.title}</span>
              {nowTesting.nums.length ? ` (issue ${nowTesting.nums.join(", ")})` : ""}.
            </p>
          )}
          {fix?.diff.length ? (
            <ul className="flex flex-col gap-1 font-dwmono text-[12px] text-dw-ink/60">
              {fix.diff.slice(0, 3).map((d) => (
                <li key={d} className="truncate" title={d}>
                  {d}
                </li>
              ))}
            </ul>
          ) : null}
          <PillButton href={copy.href} tone={row.status === "queued" ? "sand" : "ink"} className="group/cta mt-auto self-start">
            {copy.cta}
            <ArrowRight className="transition-transform group-hover/cta:translate-x-0.5" />
          </PillButton>
        </div>
      </div>
    </>
  );
}
