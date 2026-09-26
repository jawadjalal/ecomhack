"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Check, CircleDashed, FlaskConical, Minus, PencilLine, Square, X } from "lucide-react";
import type { Insight } from "@/lib/contracts";
import { humanizePath, parseDiffLine, signedPct, sourceBadge } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { Mascot } from "../mascot";
import { FIX_STATUS_LABEL, fixLift, listJoin, type FixRow, type FixStatus, type IssueRow } from "./model";

/** The loop ships a winner once the chance the new version is better reaches this (optimizer default config). */
export const SHIP_AT = 0.975;

/* ------------------------------------------------------------------ status mark */

const MARK: Record<FixStatus, { Icon: typeof Check; bg: string; fg: string }> = {
  test: { Icon: FlaskConical, bg: "#F3B5D5", fg: "#141413" },
  drafted: { Icon: PencilLine, bg: "#D5CCF5", fg: "#141413" },
  shipped: { Icon: Check, bg: "#DDF3E8", fg: "#137A52" },
  rejected: { Icon: X, bg: "#F4DCD7", fg: "#8E1D14" },
  shelved: { Icon: Minus, bg: "#EDE6D6", fg: "#6B655A" },
  stopped: { Icon: Square, bg: "#EDE6D6", fg: "#6B655A" },
  untested: { Icon: CircleDashed, bg: "#F2ECDF", fg: "#6B655A" },
};

export function FixMark({ status, size = 36 }: { status: FixStatus; size?: number }) {
  const m = MARK[status];
  return (
    <span className="dw-tilt relative grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: m.bg, color: m.fg }} aria-hidden>
      <m.Icon className="size-4" strokeWidth={2.4} />
      {status === "test" && <span className="dw-live-dot absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-dw-live" />}
    </span>
  );
}

/* ------------------------------------------------------------------ copy */

/** "issues 1, 2 and 3" / "issue 4" / "" from the current ranking. */
export function issueRefs(f: FixRow, rows: IssueRow[]): { nums: number[]; text: string } {
  const nums = f.insightIds
    .map((id) => rows.find((r) => r.insight.id === id)?.n)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b);
  return { nums, text: nums.length ? `issue${nums.length === 1 ? "" : "s"} ${listJoin(nums)}` : "" };
}

export function fixSub(f: FixRow, rows: IssueRow[]): string {
  const refs = issueRefs(f, rows).text;
  switch (f.status) {
    case "test":
      return ["Being tested", refs].filter(Boolean).join(" · ");
    case "drafted":
      return ["Drafted", refs].filter(Boolean).join(" · ");
    case "shipped":
      return f.generation !== undefined ? `Shipped in version ${f.generation}` : "Shipped";
    case "rejected":
      return "Lost its test";
    case "shelved":
      return "Set aside · no clear difference";
    case "stopped":
      return "Stopped before a result";
    default:
      return ["Never tested", refs].filter(Boolean).join(" · ");
  }
}

/** "+67% so far", "+18% expected", "+45% shipped", "−4%". */
export function liftText(f: FixRow, long = false): string {
  const l = fixLift(f);
  if (l.value === undefined) return "–";
  const v = signedPct(l.value);
  if (!long) return v;
  if (l.kind === "expected") return `${v} expected`;
  return f.status === "test" ? `${v} so far` : f.status === "shipped" ? `${v} when shipped` : v;
}

/* ------------------------------------------------------------------ source chip */

/** How Pixel wrote the fix: with AI, or from Darwin's built-in rules. Honest either way, no model names. */
export function SourceChip({ source }: { source?: string }) {
  const b = sourceBadge(source);
  if (!b) return null;
  const rules = b.label === "Heuristic";
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1.5 self-start rounded-full bg-dw-surface/85 pr-2.5 pl-1 text-[12px] font-medium text-dw-ink/80 shadow-[inset_0_0_0_1px_rgba(20,20,19,0.06)]">
      <Mascot kind="designer" size={20} active={false} />
      <span className="truncate">{rules ? "Pixel used Darwin's rules" : "Pixel wrote it with AI"}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ diff */

function prettyValue(v?: string): string {
  if (v === undefined) return "";
  const t = v.trim();
  if (/^\d{3,}$/.test(t)) return `£${(Number(t) / 100).toFixed(Number(t) % 100 ? 2 : 0)}`;
  if (t === "true") return "on";
  if (t === "false") return "off";
  return t.replace(/^"(.*)"$/, "$1");
}

/** What changed, as friendly setting rows: what the setting is, then now → new. */
export function SettingRows({ lines, compact }: { lines: string[]; compact?: boolean }) {
  if (!lines.length) return <p className="text-[14px] text-dw-ink/60">The exact page settings for this fix are no longer in Darwin&apos;s log.</p>;
  return (
    <ul className="flex flex-col divide-y divide-dw-hairline">
      {lines.map((raw, i) => {
        const d = parseDiffLine(raw);
        return (
          <motion.li
            key={raw}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 + i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
            className={cn(
              "group grid gap-x-4 gap-y-1.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
              compact ? "py-2" : "py-2.5",
            )}
          >
            <div className="min-w-0" title={d.path}>
              <div className="truncate text-[14px] font-medium">{humanizePath(d.path)}</div>
              <div className={cn("truncate font-dwmono text-[11.5px] text-dw-ink/45", compact && "hidden")}>{d.path}</div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-dwmono text-[12.5px]">
              {d.before !== undefined && (
                <span className={cn("inline-flex items-center gap-1 truncate rounded-lg bg-[#FBE7E4] px-2 py-1 text-[#8E1D14]", compact ? "max-w-[8.5rem]" : "max-w-[12rem]")} title={d.before}>
                  <span className="font-dw text-[10px] font-semibold opacity-70">now</span>
                  <span className="truncate line-through decoration-[#8E1D14]/40">{prettyValue(d.before)}</span>
                </span>
              )}
              <span className="text-dw-ink/35 transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
              <span className={cn("inline-flex items-center gap-1 truncate rounded-lg bg-[#E3F6EA] px-2 py-1 font-medium text-[#1B5E33]", compact ? "max-w-[10rem]" : "max-w-[14rem]")} title={d.after}>
                <span className="font-dw text-[10px] font-semibold opacity-70">new</span>
                <span className="truncate">{prettyValue(d.after)}</span>
              </span>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

/** The same diff as raw +/- lines (what the pull request will contain). */
export function RawDiff({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-0.5 overflow-x-auto font-dwmono text-[12.5px] leading-[1.8]">
      {lines.flatMap((raw) => {
        const d = parseDiffLine(raw);
        const out = [];
        if (d.before !== undefined) out.push({ k: `-${raw}`, sign: "-", text: `${d.path}: ${d.before}` });
        out.push({ k: `+${raw}`, sign: "+", text: d.after !== undefined ? `${d.path}: ${d.after}` : raw });
        return out.map((l) => (
          <span
            key={l.k}
            className={cn("-mx-2.5 rounded-md px-2.5 whitespace-pre", l.sign === "+" ? "bg-[#E3F6EA] text-[#1B5E33]" : "bg-[#FBE7E4] text-[#8E1D14]")}
          >
            {l.sign} {l.text}
          </span>
        ));
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ issue chips */

export function IssueChips({ ids, rows, archive }: { ids: string[]; rows: IssueRow[]; archive: Map<string, Insight> }) {
  if (!ids.length) return <span className="text-[14px] text-dw-ink/60">A creative bet, not tied to one issue.</span>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const row = rows.find((r) => r.insight.id === id);
        const title = row?.insight.title ?? archive.get(id)?.title ?? id.replace(/^ins_/, "").replace(/_/g, " ");
        if (!row) {
          return (
            <li key={id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-dw-surface/60 py-1 pr-3 pl-1 text-[13px] text-dw-ink/65" title={title}>
              <span className="grid size-6 place-items-center rounded-full bg-dw-win-bg text-dw-win">
                <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
              </span>
              <span className="truncate">{title}</span>
              <span className="shrink-0 text-[12px]">· no longer seen</span>
            </li>
          );
        }
        return (
          <li key={id} className="max-w-full">
            <Link
              href={`/console/issues?id=${encodeURIComponent(id)}`}
              className="group inline-flex max-w-full items-center gap-2 rounded-full bg-dw-surface py-1 pr-3 pl-1 text-[13px] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_1px_2px_rgba(20,20,19,0.08),0_6px_14px_-10px_rgba(20,20,19,0.3)] transition-[transform,box-shadow] outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-dw-ink"
              title={title}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold" style={{ background: row.who === "Agents" ? "#B8CAEE" : row.who === "People" ? "#D5CCF5" : "#E3DAC6" }}>
                {row.n}
              </span>
              <span className="truncate">{title}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export { FIX_STATUS_LABEL };
