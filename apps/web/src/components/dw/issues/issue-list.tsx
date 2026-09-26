"use client";

import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { Tag } from "../ui";
import type { Focus } from "./issue-cards";
import { JoinHighlight } from "./join";
import { fmtImpact, STATUS_LABEL, type IssueRow } from "./model";

const NUM_BG: Record<IssueRow["who"], string> = { Agents: "#F3B5D5", People: "#B8CAEE", Everyone: "#D5CCF5" };

function inFocus(r: IssueRow, focus: Focus) {
  if (!focus) return true;
  return focus.kind === "who" ? r.who === focus.who : r.stage === focus.stage;
}

export function StatusTag({ status }: { status: IssueRow["status"] }) {
  return (
    <Tag tone={status === "test" ? "ink" : status === "drafted" ? "yellow" : "sand"} className="h-[26px] px-2.5">
      {status === "test" && <span className="size-1.5 rounded-full bg-dw-pink" aria-hidden />}
      {STATUS_LABEL[status]}
    </Tag>
  );
}

/**
 * All issues, biggest first. The selected row turns pink and (on wide screens) reaches across the gap
 * into the detail panel, with two fillets smoothing the join.
 */
export function IssueList({
  rows,
  selected,
  focus,
  onSelect,
  panelId,
}: {
  rows: IssueRow[];
  selected?: string;
  focus: Focus;
  onSelect: (id: string) => void;
  panelId: string;
}) {
  return (
    <section aria-label="All issues" className="relative flex min-w-0 flex-col gap-2.5 rounded-[26px] border border-dw-hairline bg-dw-surface px-[22px] pt-[22px] pb-4">
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">All issues</h2>
        <span className="text-[13px] text-[#8A8478]">biggest first</span>
      </div>
      <div role="listbox" aria-label="Issues" aria-controls={panelId} className="flex flex-col gap-1">
        {rows.map((r, i) => {
          const on = r.insight.id === selected;
          const dim = !inFocus(r, focus);
          return (
            <motion.button
              key={r.insight.id}
              type="button"
              role="option"
              aria-selected={on}
              data-sel-id={r.insight.id}
              onClick={() => onSelect(r.insight.id)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: dim ? 0.35 : 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i, 10) * 0.035, ease: [0.2, 0.8, 0.2, 1] }}
              className={cn(
                "group relative flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-dw-ink",
                !on && "dw-row hover:bg-[#F6F0E4]",
              )}
            >
              {on && <JoinHighlight layoutId="dw-issue-sel" color="#F3B5D5" soft="#FCE6F0" />}
              <span
                className={cn("dw-tilt relative grid size-[34px] shrink-0 place-items-center rounded-full text-[14px] font-semibold", on && "lg:bg-white!")}
                style={{ background: NUM_BG[r.who] }}
              >
                {r.n}
              </span>
              <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]" title={r.insight.title}>{r.insight.title}</span>
                <span className={cn("text-[13px]", on ? "text-[#5A2744]" : "text-[#6B655A]")}>
                  {r.who} · {r.where}
                </span>
              </span>
              <span className="relative hidden sm:inline-flex">
                <StatusTag status={r.status} />
              </span>
              <span className="num relative w-11 shrink-0 text-right text-[15px] font-semibold">−{fmtImpact(r.insight.impactScore)}</span>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
