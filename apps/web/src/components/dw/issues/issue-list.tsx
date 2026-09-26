"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { DEPTH, Tag, TONE } from "../ui";
import { JoinHighlight, MoreButton, useCollapsed } from "./join";
import { fmtImpact, STATUS_LABEL, type IssueRow, type StageKey } from "./model";
import { WhoMark, whoLabel } from "./who";

/** What the summary strip is pointing at: the list dims every other row. */
export type Focus = { kind: "who"; who: IssueRow["who"] } | { kind: "stage"; stage: StageKey } | null;

/** Number bubble colour: blue for AI agents, lilac for people, sand when it hits everyone. */
const NUM_BG: Record<IssueRow["who"], string> = { Agents: TONE.blue.bg, People: TONE.lilac.bg, Everyone: TONE.sand.shape };

function inFocus(r: IssueRow, focus: Focus) {
  if (!focus) return true;
  if (focus.kind === "stage") return r.stage === focus.stage;
  // "Everyone" issues hit both groups.
  return r.who === focus.who || r.who === "Everyone";
}

export function StatusTag({ status }: { status: IssueRow["status"] }) {
  return (
    <Tag tone={status === "test" ? "pink" : status === "drafted" ? "white" : "sand"} className="h-[26px] px-2.5">
      {status === "test" && <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" aria-hidden />}
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
  children,
}: {
  rows: IssueRow[];
  selected?: string;
  focus: Focus;
  onSelect: (id: string) => void;
  panelId: string;
  /** Rendered under the open issues (the greyed "Already fixed" list). */
  children?: ReactNode;
}) {
  const list = useCollapsed(rows, rows.findIndex((r) => r.insight.id === selected));
  return (
    <section aria-label="All issues" className={cn("relative flex min-w-0 flex-col gap-2.5 rounded-[28px] border border-dw-hairline bg-dw-surface px-4 pt-[22px] pb-4 sm:px-[22px]", DEPTH)}>
      <div className="flex items-baseline justify-between px-1 pb-1">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Where shoppers get stuck</h2>
        <span className="text-[12.5px] text-[#8A8478]">biggest first</span>
      </div>
      <div role="listbox" aria-label="Issues" aria-controls={panelId} className="flex flex-col gap-1">
        {list.visible.map((r, i) => {
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
              {on && <JoinHighlight layoutId="dw-issue-sel" color={TONE.yellow.bg} soft="#FBEFC4" />}
              <span
                className={cn("dw-tilt relative grid size-[34px] shrink-0 place-items-center rounded-full text-[14px] font-semibold", on && "lg:bg-white!")}
                style={{ background: NUM_BG[r.who] }}
              >
                {r.n}
              </span>
              <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="line-clamp-2 text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]" title={r.insight.title}>{r.insight.title}</span>
                <span className={cn("text-[13px]", on ? "text-[#4F4417]" : "text-[#6B655A]")}>
                  <WhoMark who={r.who} /> {whoLabel(r.who)} · {r.where}
                  {r.status !== "queued" && <span className="font-medium text-dw-ink sm:hidden"> · {STATUS_LABEL[r.status]}</span>}
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
      <MoreButton hidden={list.hidden} canCollapse={list.canCollapse} noun={list.hidden === 1 ? "issue" : "issues"} onClick={list.toggle} />
      {children}
    </section>
  );
}
