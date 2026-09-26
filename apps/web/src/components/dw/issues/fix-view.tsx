"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, GitPullRequest, Play } from "lucide-react";
import type { Insight, LoopState } from "@/lib/contracts";
import { pct } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { Mascot, Silhouette } from "../mascot";
import { DEPTH, PillButton, Segmented, TONE } from "../ui";
import {
  FIX_STATUS_LABEL,
  FixMark,
  fixSub,
  IssueChips,
  issueRefs,
  liftText,
  RawDiff,
  SettingRows,
  SHIP_AT,
  SourceChip,
} from "./fix-parts";
import { JoinHighlight, MoreButton, useCollapsed } from "./join";
import { fixLift, type FixRow, type IssueRow } from "./model";

/* ------------------------------------------------------------------ list */

export function FixList({
  fixes,
  rows,
  selected,
  onSelect,
  panelId,
}: {
  fixes: FixRow[];
  rows: IssueRow[];
  selected?: string;
  onSelect: (id: string) => void;
  panelId: string;
}) {
  const list = useCollapsed(
    fixes,
    fixes.findIndex((f) => f.id === selected),
  );
  return (
    <section
      aria-label="All fixes"
      className={cn(
        "relative flex min-w-0 flex-col gap-2.5 rounded-[28px] border border-dw-hairline bg-dw-surface px-4 pt-[22px] pb-4 sm:px-[22px]",
        DEPTH,
      )}
    >
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">
          Pixel&apos;s fixes
        </h2>
        <span className="text-[12.5px] text-[#8A8478]">newest first</span>
      </div>
      <div
        role="listbox"
        aria-label="Fixes"
        aria-controls={panelId}
        className="flex flex-col gap-1"
      >
        {list.visible.map((f, i) => {
          const on = f.id === selected;
          const l = fixLift(f);
          return (
            <motion.button
              key={f.id}
              type="button"
              role="option"
              aria-selected={on}
              data-sel-id={f.id}
              onClick={() => onSelect(f.id)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.4,
                delay: Math.min(i, 10) * 0.04,
                ease: [0.2, 0.8, 0.2, 1],
              }}
              className={cn(
                "group relative flex min-h-[66px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-dw-ink",
                !on && "dw-row hover:bg-[#F6F0E4]",
              )}
            >
              {on && (
                <JoinHighlight
                  layoutId="dw-fix-sel"
                  color={TONE.lilac.bg}
                  soft="#EEEAFB"
                />
              )}
              <FixMark status={f.status} />
              <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className="line-clamp-2 text-[15px] leading-snug font-semibold"
                  title={f.title}
                >
                  {f.title}
                </span>
                <span
                  className={cn(
                    "truncate text-[13px]",
                    on ? "text-[#3B2F6B]" : "text-[#6B655A]",
                  )}
                >
                  {fixSub(f, rows)}
                </span>
              </span>
              <span
                className={cn(
                  "num relative w-14 shrink-0 text-right text-[15px] font-semibold",
                  f.status === "rejected" || f.status === "shelved"
                    ? "text-[#8A8478]"
                    : l.kind === "expected"
                      ? "text-dw-ink/55"
                      : "",
                )}
                title={
                  l.kind === "expected" ? "Pixel's guess before testing" : "measured in its test"
                }
              >
                {liftText(f)}
              </span>
            </motion.button>
          );
        })}
      </div>
      <MoreButton
        hidden={list.hidden}
        canCollapse={list.canCollapse}
        noun={list.hidden === 1 ? "fix" : "fixes"}
        onClick={list.toggle}
      />
      <div className="mt-auto flex items-center gap-2 px-1 pt-4 text-[13px] text-[#8A8478]">
        <Mascot kind="designer" size={20} active={false} />
        <span>
          Every fix stays here, winners and losers, so Pixel never repeats a
          loser.
        </span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ detail */

export function FixDetail({
  fix,
  rows,
  archive,
  loop,
  autopilot,
  stepping,
  step,
  id,
}: {
  fix?: FixRow;
  rows: IssueRow[];
  archive: Map<string, Insight>;
  loop: LoopState;
  autopilot: boolean;
  stepping: boolean;
  step: () => Promise<void>;
  id: string;
}) {
  return (
    <section
      id={id}
      aria-live="polite"
      aria-label="Fix detail"
      className={cn(
        "relative isolate flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[28px] px-5 py-[22px] sm:px-6",
        DEPTH,
      )}
      style={{ background: TONE.lilac.bg }}
    >
      <Silhouette
        kind="designer"
        color={TONE.lilac.shape}
        size={250}
        style={{ right: -90, top: -100, zIndex: -1 }}
      />
      <AnimatePresence mode="wait" initial={false}>
        {fix && (
          <motion.div
            key={fix.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-1 flex-col gap-4"
          >
            <Body
              fix={fix}
              rows={rows}
              archive={archive}
              loop={loop}
              autopilot={autopilot}
              stepping={stepping}
              step={step}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Body({
  fix,
  rows,
  archive,
  loop,
  autopilot,
  stepping,
  step,
}: {
  fix: FixRow;
  rows: IssueRow[];
  archive: Map<string, Insight>;
  loop: LoopState;
  autopilot: boolean;
  stepping: boolean;
  step: () => Promise<void>;
}) {
  const [view, setView] = useState<"settings" | "raw">("settings");
  const refs = issueRefs(fix, rows);
  const r = fix.experiment?.result;
  const audience =
    r?.audience === "agent"
      ? "AI shoppers"
      : r?.audience === "human"
        ? "people"
        : "everyone";
  const seg = (v: NonNullable<typeof r>["control"]) =>
    r?.audience === "agent"
      ? v.byKind.agent
      : r?.audience === "human"
        ? v.byKind.human
        : { conversionRate: v.conversionRate, visitors: v.visitors };
  const canStart =
    fix.status === "drafted" && loop.phase === "propose" && !autopilot;

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12.5px] text-[#3B2F6B]">
            {FIX_STATUS_LABEL[fix.status]}
            {refs.text ? ` · fixes ${refs.text}` : ""}
          </span>
          <h2 className="text-[24px] lg:line-clamp-2 leading-[1.2] font-semibold tracking-[-0.015em] text-balance">
            {fix.title}
          </h2>
        </div>
        <span className="num inline-flex h-[34px] shrink-0 items-center rounded-full bg-dw-surface px-4 text-[14px] font-semibold whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(20,20,19,0.08),0_6px_14px_-10px_rgba(20,20,19,0.3)]">
          {liftText(fix, true)}
        </span>
      </header>

      {fix.hypothesis && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] px-4 py-3"
          style={{ background: TONE.lilac.shape }}
        >
          <Mascot
            kind="designer"
            size={30}
            frame
            active={fix.status === "test" || fix.status === "drafted"}
          />
          <p
            className="min-w-[14rem] flex-1 text-[14.5px] lg:line-clamp-2 leading-[1.45]"
            title={fix.hypothesis}
          >
            {fix.hypothesis}
          </p>
          <SourceChip source={fix.source} />
        </div>
      )}

      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[20px] border border-dw-hairline bg-dw-surface px-[18px] py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">
              What changes on the page
            </span>
            {fix.diff.length > 0 && (
              <Segmented
                className="p-0.5 [&_button]:h-7 [&_button]:px-3 [&_button]:text-[12px]"
                value={view}
                onChange={setView}
                options={[
                  { value: "settings", label: "In words" },
                  { value: "raw", label: "As code" },
                ]}
              />
            )}
          </div>
          {view === "raw" && fix.diff.length ? (
            <RawDiff lines={fix.diff} />
          ) : (
            <SettingRows lines={fix.diff} compact />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] text-[#3B2F6B]">What it fixes</span>
            <IssueChips ids={fix.insightIds} rows={rows} archive={archive} />
          </div>

          {r && (
            <div
              className="flex flex-col gap-2 rounded-[20px] px-4 py-3"
              style={{ background: TONE.lilac.shape }}
            >
              <span className="text-[12.5px] text-[#3B2F6B]">
                % who buy, {audience}
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[14px]">
                <span>
                  Your page{" "}
                  <span className="num font-semibold">
                    {pct(seg(r.control).conversionRate)}
                  </span>{" "}
                  → new{" "}
                  <span className="num font-semibold">
                    {pct(seg(r.treatment).conversionRate)}
                  </span>
                </span>
                <span className="text-[13px] text-[#3B2F6B]">
                  <span className="num font-semibold text-dw-ink">
                    {pct(r.probabilityToBeat, 0)}
                  </span>{" "}
                  chance it&apos;s better
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-dw-ink/12">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-dw-ink"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.max(2, r.probabilityToBeat * 100)}%`,
                  }}
                  transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
                />
                <span
                  className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-dw-ink/60"
                  style={{ left: `${SHIP_AT * 100}%` }}
                  title={`Ships at ${pct(SHIP_AT)}`}
                  aria-hidden
                />
              </div>
              <span className="text-[12px] leading-snug text-[#3B2F6B]">
                {seg(r.control).visitors + seg(r.treatment).visitors > 0
                  ? `${(seg(r.control).visitors + seg(r.treatment).visitors).toLocaleString("en-GB")} ${audience === "AI shoppers" ? "AI shoppers" : "visitors"}, simulated shoppers included`
                  : "No visitors yet"}
                {fix.experiment && fix.status !== "test"
                  ? ` · started ${new Date(fix.experiment.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            {fix.status === "test" && (
              <PillButton href="/console/experiments" className="group/cta">
                Watch the test{" "}
                <ArrowRight className="transition-transform group-hover/cta:translate-x-0.5" />
              </PillButton>
            )}
            {canStart && (
              <PillButton onClick={() => void step()} disabled={stepping}>
                <Play /> {stepping ? "Starting…" : "Start the test"}
              </PillButton>
            )}
            {fix.status === "drafted" && !canStart && autopilot && (
              <span className="text-[13px] text-[#3B2F6B]">
                Fizz starts the test on autopilot&apos;s next step.
              </span>
            )}
            {fix.status === "shipped" && (
              <PillButton href="/console/changes" tone="white">
                <GitPullRequest /> See the change
              </PillButton>
            )}
            {(fix.status === "rejected" || fix.status === "shelved") && (
              <span className="text-[13px] text-[#3B2F6B]">
                Pixel won&apos;t try this change again.
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
