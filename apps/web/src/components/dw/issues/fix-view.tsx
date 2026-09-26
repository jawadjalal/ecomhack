"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, GitPullRequest, Play } from "lucide-react";
import type { Insight, LoopState } from "@/lib/contracts";
import { pct } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { Mascot, Silhouette } from "../mascot";
import { PillButton, Segmented, TONE } from "../ui";
import { SHIP_AT } from "./fix-cards";
import { FIX_STATUS_LABEL, FixMark, fixSub, IssueChips, issueRefs, liftText, RawDiff, SettingRows, SourceChip } from "./fix-parts";
import { JoinHighlight } from "./join";
import { fixLift, type FixRow, type IssueRow } from "./model";

/* ------------------------------------------------------------------ list */

export function FixList({ fixes, rows, selected, onSelect, panelId }: { fixes: FixRow[]; rows: IssueRow[]; selected?: string; onSelect: (id: string) => void; panelId: string }) {
  return (
    <section aria-label="All fixes" className="relative flex min-w-0 flex-col gap-2.5 rounded-[26px] border border-dw-hairline bg-dw-surface px-[22px] pt-[22px] pb-4">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">All fixes</h2>
        <span className="text-[13px] text-[#8A8478]">newest first</span>
      </div>
      <div role="listbox" aria-label="Fixes" aria-controls={panelId} className="flex flex-col gap-1">
        {fixes.map((f, i) => {
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
              transition={{ duration: 0.4, delay: Math.min(i, 10) * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
              className={cn(
                "group relative flex min-h-[66px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-dw-ink",
                !on && "dw-row hover:bg-[#F6F0E4]",
              )}
            >
              {on && <JoinHighlight layoutId="dw-fix-sel" color={TONE.blue.bg} soft="#E6EDFB" />}
              <FixMark status={f.status} />
              <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-[15px] leading-snug font-semibold" title={f.title}>
                  {f.title}
                </span>
                <span className={cn("truncate text-[13px]", on ? "text-[#2E3A55]" : "text-[#6B655A]")}>{fixSub(f, rows)}</span>
              </span>
              <span
                className={cn(
                  "num relative w-14 shrink-0 text-right text-[15px] font-semibold",
                  f.status === "rejected" || f.status === "shelved" ? "text-[#8A8478]" : l.kind === "expected" ? "text-dw-ink/55" : "",
                )}
                title={l.kind === "expected" ? "expected lift" : "measured lift"}
              >
                {liftText(f)}
              </span>
            </motion.button>
          );
        })}
      </div>
      <div className="mt-auto flex items-center gap-2 px-1 pt-4 text-[13px] text-[#8A8478]">
        <Mascot kind="shipper" size={20} active={false} />
        <span>Darwin keeps every fix it tried, winners and losers, so it never repeats a loser.</span>
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
    <section id={id} aria-live="polite" aria-label="Fix detail" className="relative isolate flex min-h-[480px] min-w-0 flex-col overflow-hidden rounded-[26px] px-6 py-6 sm:px-7" style={{ background: TONE.blue.bg }}>
      <Silhouette kind="observer" color={TONE.blue.shape} size={250} style={{ right: -90, top: -100, zIndex: -1 }} />
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
            <Body fix={fix} rows={rows} archive={archive} loop={loop} autopilot={autopilot} stepping={stepping} step={step} />
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
  const audience = r?.audience === "agent" ? "AI shoppers" : r?.audience === "human" ? "people" : "everyone";
  const seg = (v: NonNullable<typeof r>["control"]) =>
    r?.audience === "agent" ? v.byKind.agent : r?.audience === "human" ? v.byKind.human : { conversionRate: v.conversionRate, visitors: v.visitors };
  const canStart = fix.status === "drafted" && loop.phase === "propose" && !autopilot;

  return (
    <>
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-[#2E3A55]">
            {FIX_STATUS_LABEL[fix.status]}
            {refs.text ? ` · fixes ${refs.text}` : ""}
          </span>
          <h2 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance">{fix.title}</h2>
        </div>
        <span className="num inline-flex h-[34px] shrink-0 items-center rounded-full bg-white px-4 text-[14px] font-semibold whitespace-nowrap">{liftText(fix, true)}</span>
      </header>

      {fix.hypothesis && (
        <div className="flex items-start gap-3 rounded-[18px] bg-white/60 px-4 py-3.5">
          <Mascot kind="designer" size={32} frame active={fix.status === "test" || fix.status === "drafted"} />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-[15px] leading-[1.5]">{fix.hypothesis}</p>
            <SourceChip source={fix.source} />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-[18px] bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-dwmono text-[12.5px] text-[#8A8478]">storefront.config.json</span>
          {fix.diff.length > 0 && (
            <Segmented
              className="p-0.5 [&_button]:h-7 [&_button]:px-3 [&_button]:text-[12px]"
              value={view}
              onChange={setView}
              options={[
                { value: "settings", label: "Settings" },
                { value: "raw", label: "Raw diff" },
              ]}
            />
          )}
        </div>
        {view === "raw" && fix.diff.length ? <RawDiff lines={fix.diff} /> : <SettingRows lines={fix.diff} />}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] text-[#2E3A55]">What it fixes</span>
        <IssueChips ids={fix.insightIds} rows={rows} archive={archive} />
      </div>

      {r && (
        <div className="flex flex-col gap-2 rounded-[18px] bg-white/60 px-4 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
            <span>
              Measured on {audience}: A <span className="num font-semibold">{pct(seg(r.control).conversionRate)}</span> → B{" "}
              <span className="num font-semibold">{pct(seg(r.treatment).conversionRate)}</span>
            </span>
            <span className="text-[13px] text-[#2E3A55]">
              <span className="num font-semibold text-dw-ink">{pct(r.probabilityToBeat, 0)}</span> chance B wins
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-dw-ink/12">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-dw-ink"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, r.probabilityToBeat * 100)}%` }}
              transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
            />
            <span className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-dw-ink/60" style={{ left: `${SHIP_AT * 100}%` }} title={`Ships at ${pct(SHIP_AT)}`} aria-hidden />
          </div>
          <span className="text-[12px] text-[#2E3A55]">
            {seg(r.control).visitors + seg(r.treatment).visitors > 0 ? `${(seg(r.control).visitors + seg(r.treatment).visitors).toLocaleString("en-GB")} ${audience === "AI shoppers" ? "agents" : "visitors"} so far, simulated traffic included.` : ""}
          </span>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-1">
        {fix.status === "test" && (
          <PillButton href="/console/experiments" className="group/cta">
            Watch the test <ArrowRight className="transition-transform group-hover/cta:translate-x-0.5" />
          </PillButton>
        )}
        {canStart && (
          <PillButton onClick={() => void step()} disabled={stepping}>
            <Play /> {stepping ? "Starting…" : "Start the test"}
          </PillButton>
        )}
        {fix.status === "drafted" && !canStart && autopilot && <span className="text-[13px] text-[#2E3A55]">Autopilot starts the test on its next step.</span>}
        {fix.status === "shipped" && (
          <PillButton href="/console/pulls" tone="white">
            <GitPullRequest /> See the pull request
          </PillButton>
        )}
        {(fix.status === "rejected" || fix.status === "shelved") && <span className="text-[13px] text-[#2E3A55]">Darwin won&apos;t try this change again.</span>}
        {fix.experiment && fix.status !== "test" && (
          <span className="ml-auto text-[12px] text-[#2E3A55]">
            Test started {new Date(fix.experiment.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </>
  );
}
