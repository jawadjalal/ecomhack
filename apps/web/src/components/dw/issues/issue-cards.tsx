"use client";

import { motion } from "motion/react";
import { Bot, User, Users } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { fmtImpact, plural, STAGES, STATUS_LABEL, type IssueRow, type StageKey } from "./model";
import { Panel, Tip } from "./panel";

export type Focus = { kind: "who"; who: IssueRow["who"] } | { kind: "stage"; stage: StageKey } | null;

const EASE = [0.2, 0.8, 0.2, 1] as const;

/* ------------------------------------------------------------------ buyers lost */

export function BuyersLostCard({ rows, selected, onSelect }: { rows: IssueRow[]; selected?: string; onSelect: (id: string) => void }) {
  const total = rows.reduce((n, r) => n + r.insight.impactScore, 0);
  const inTest = rows.filter((r) => r.status === "test");
  const drafted = rows.filter((r) => r.status === "drafted");
  const fixed = inTest.reduce((n, r) => n + r.insight.impactScore, 0);
  const draftedLost = drafted.reduce((n, r) => n + r.insight.impactScore, 0);
  const max = Math.max(...rows.map((r) => r.insight.impactScore), 0.0001);
  const many = rows.length > 8;

  return (
    <Panel tone="yellow" shape="designer" corner="tr" silhouette={230} label="Buyers lost">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Buyers lost</h2>
        <span className="text-[13px] text-[#4F4417]">per 1,000 visits</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="num text-[40px] leading-none font-semibold tracking-[-0.02em]">{fmtImpact(total)}</span>
        <span className="text-[14px] text-[#4F4417]">
          {inTest.length
            ? `${fmtImpact(fixed)} of them tackled by test B`
            : drafted.length
              ? `${fmtImpact(draftedLost)} of them covered by the drafted fix`
              : "none being fixed yet"}
        </span>
      </div>
      <div
        className="mt-auto grid min-h-[150px] items-end gap-1.5 pt-4 sm:gap-2.5 lg:min-h-0 lg:flex-1"
        style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      >
        {rows.map((r, i) => {
          const v = r.insight.impactScore;
          const h = Math.max(10, Math.round((v / max) * (many ? 92 : 100)));
          const on = r.insight.id === selected;
          return (
            <button
              key={r.insight.id}
              type="button"
              onClick={() => onSelect(r.insight.id)}
              aria-label={`Issue ${r.n}: ${r.insight.title}. ${fmtImpact(v)} buyers lost per 1,000 visits. ${STATUS_LABEL[r.status]}.`}
              aria-pressed={on}
              className="group relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-dw-ink"
            >
              <Tip align={i < 2 ? "start" : i >= rows.length - 2 ? "end" : "center"}>
                #{r.n} · {STATUS_LABEL[r.status]} · {r.insight.title}
              </Tip>
              <span className={cn("num text-[12px] font-semibold transition-opacity", !on && selected && "opacity-70")}>{fmtImpact(v)}</span>
              <motion.span
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.7, delay: 0.1 + i * 0.05, ease: EASE }}
                style={{ height: h, transformOrigin: "bottom" }}
                className={cn(
                  "block w-[16px] rounded-full transition-[filter,box-shadow,background-color] duration-200 group-hover:brightness-75 sm:w-[22px]",
                  r.status === "test"
                    ? "bg-dw-ink"
                    : r.status === "drafted"
                      ? "border-[1.5px] border-dashed border-dw-ink bg-dw-ink/15"
                      : "border-[1.5px] border-dashed border-dw-ink group-hover:bg-dw-ink/10",
                  on && "shadow-[0_0_0_3px_#FFFDF8,0_0_0_4.5px_#141413]",
                )}
              />
              <span className={cn("num text-[12px] transition-colors", on ? "font-semibold text-dw-ink" : "text-[#4F4417]")}>#{r.n}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ who is affected */

const WHO_ICON = { Agents: Bot, People: User, Everyone: Users } as const;

export function WhoCard({ rows, onFocus, onSelect }: { rows: IssueRow[]; onFocus: (f: Focus) => void; onSelect: (id: string) => void }) {
  const groups = (["Agents", "People", "Everyone"] as const)
    .map((who) => {
      const list = rows.filter((r) => r.who === who);
      return { who, list, lost: list.reduce((n, r) => n + r.insight.impactScore, 0) };
    })
    .filter((g) => g.who !== "Everyone" || g.list.length > 0);
  const total = groups.reduce((n, g) => n + g.lost, 0) || 1;
  const sorted = [...groups].sort((a, b) => b.lost - a.lost);
  const top = sorted[0];
  const share = top ? Math.round((top.lost / total) * 100) : 0;
  const tie = sorted.length > 1 && Math.abs(sorted[0].lost - sorted[1].lost) / total < 0.06;

  return (
    <Panel tone="blue" shape="observer" corner="br" silhouette={220} label="Who is affected">
      <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Who is affected</h2>
      {top && top.lost > 0 && (
        <p className="mt-1.5 text-[14px] leading-snug text-[#2E3A55]">
          {tie
            ? `${sorted[0].who} and ${sorted[1].who.toLowerCase()} lose about as many buyers.`
            : `${top.who === "Everyone" ? "Issues that hit everyone" : top.who} account for ${share}% of lost buyers.`}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-3.5 pt-5" onMouseLeave={() => onFocus(null)}>
        {groups.map((g, i) => {
          const Icon = WHO_ICON[g.who];
          const w = g.lost / total;
          return (
            <button
              key={g.who}
              type="button"
              disabled={!g.list.length}
              onMouseEnter={() => onFocus({ kind: "who", who: g.who })}
              onFocus={() => onFocus({ kind: "who", who: g.who })}
              onBlur={() => onFocus(null)}
              onClick={() => g.list[0] && onSelect(g.list[0].insight.id)}
              className="group flex flex-col gap-1.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-dw-ink disabled:cursor-default"
            >
              <span className="flex w-full items-center justify-between gap-3 text-[14px]">
                <span className="flex items-center gap-1.5">
                  <Icon className="size-4 opacity-70" aria-hidden />
                  {g.who}
                </span>
                <span className="num font-semibold">
                  {plural(g.list.length, "issue")} · {fmtImpact(g.lost)} lost
                </span>
              </span>
              <span className="relative block h-3.5 w-full rounded-full bg-dw-ink/12">
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(g.lost > 0 ? 4 : 0, w * 100)}%` }}
                  transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: EASE }}
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-[filter] group-hover:brightness-75",
                    // ink rule: people = solid (series 1), agents = dashed outline (series 2)
                    g.who === "Agents" ? "border-[1.5px] border-dashed border-dw-ink group-hover:bg-dw-ink/10" : "bg-dw-ink",
                  )}
                />
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ where they happen */

export function WhereCard({ rows, selected, onFocus, onSelect }: { rows: IssueRow[]; selected?: string; onFocus: (f: Focus) => void; onSelect: (id: string) => void }) {
  const MAX_DOTS = 4;
  const cols = STAGES.map((s) => {
    const list = rows.filter((r) => r.stage === s.key);
    return { ...s, list, lost: list.reduce((n, r) => n + r.insight.impactScore, 0) };
  });
  // stagger index of each column's first dot, so dots pop in left to right
  const starts = cols.map((_, i) => cols.slice(0, i).reduce((n, c) => n + Math.min(MAX_DOTS, c.list.length), 0));
  const top = [...cols].sort((a, b) => b.lost - a.lost)[0];

  return (
    <Panel tone="olive" shape="analyst" corner="br" silhouette={210} label="Where they happen">
      <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Where they happen</h2>
      {top && top.lost > 0 && (
        <p className="mt-1.5 text-[14px] leading-snug text-[#2F3517]">
          The {top.label.toLowerCase()} {top.key === "home" ? "page" : top.key === "product" ? "pages" : "step"} lose{top.key === "product" ? "" : "s"} the most buyers.
        </p>
      )}
      <div className="mt-auto grid grid-cols-4 items-end gap-2 pt-5" onMouseLeave={() => onFocus(null)}>
        {cols.map((c, ci) => {
          const shown = c.list.slice(0, MAX_DOTS);
          const more = c.list.length - shown.length;
          return (
            <div
              key={c.key}
              className="group relative flex flex-col items-center gap-1.5"
              onMouseEnter={() => onFocus({ kind: "stage", stage: c.key })}
            >
              <Tip>{c.list.length ? `${plural(c.list.length, "issue")} · ${fmtImpact(c.lost)} lost` : "No issues"}</Tip>
              {more > 0 && <span className="num text-[11px] font-semibold text-[#2F3517]">+{more}</span>}
              <div className="flex flex-col-reverse items-center gap-1">
                {shown.map((r, di) => {
                  const on = r.insight.id === selected;
                  const k = starts[ci] + di;
                  return (
                    <motion.button
                      key={r.insight.id}
                      type="button"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: on ? 1.18 : 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 420, damping: 22, delay: on ? 0 : 0.25 + k * 0.04 }}
                      onClick={() => onSelect(r.insight.id)}
                      onFocus={() => onFocus({ kind: "stage", stage: c.key })}
                      aria-label={`Issue ${r.n} at ${c.label}: ${r.insight.title}`}
                      aria-pressed={on}
                      className={cn(
                        "size-[18px] rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white",
                        r.status === "test" ? "bg-dw-ink" : r.status === "drafted" ? "border-[1.5px] border-dashed border-dw-ink bg-dw-ink/20" : "border-[1.5px] border-dashed border-dw-ink",
                        on && "shadow-[0_0_0_2.5px_#FFFDF8]",
                      )}
                    />
                  );
                })}
                {!c.list.length && <span className="size-[18px] rounded-full border border-dw-ink/15" aria-hidden />}
              </div>
              <span className="text-[12px] text-[#2F3517]">{c.label}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
