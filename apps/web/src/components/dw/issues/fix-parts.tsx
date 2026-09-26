"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { BookOpen, Check, CircleDashed, FlaskConical, Minus, PencilLine, Square, X } from "lucide-react";
import type { Insight } from "@/lib/contracts";
import { humanizePath, parseDiffLine, signedPct, sourceBadge } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { BrandGlyph, type BrandKey } from "../brand-logos";
import { FIX_STATUS_LABEL, fixLift, listJoin, type FixRow, type FixStatus, type IssueRow } from "./model";

/* ------------------------------------------------------------------ status mark */

const MARK: Record<FixStatus, { Icon: typeof Check; bg: string; fg: string }> = {
  test: { Icon: FlaskConical, bg: "#F3B5D5", fg: "#141413" },
  drafted: { Icon: PencilLine, bg: "#F6D76B", fg: "#141413" },
  shipped: { Icon: Check, bg: "#DDF3E8", fg: "#137A52" },
  rejected: { Icon: X, bg: "#DCE3B8", fg: "#141413" },
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
      return ["In test B", refs].filter(Boolean).join(" · ");
    case "drafted":
      return ["Drafted", refs].filter(Boolean).join(" · ");
    case "shipped":
      return f.generation !== undefined ? `Shipped in Gen ${f.generation}` : "Shipped";
    case "rejected":
      return "Rejected · lost its test";
    case "shelved":
      return "Shelved · no clear signal";
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

function glyphFor(source: string | undefined): BrandKey | undefined {
  const b = sourceBadge(source);
  if (!b) return undefined;
  if (b.label === "Grok") return "grok";
  if (b.label === "Claude") return "claude";
  if (b.label === "OpenRouter") return b.model && /deepseek/i.test(b.model) ? "deepseek" : "openrouter";
  return undefined;
}

/** Who wrote the fix: an LLM (named, with its model) or Darwin's built-in playbook. Honest either way. */
export function SourceChip({ source }: { source?: string }) {
  const b = sourceBadge(source);
  if (!b) return null;
  const glyph = glyphFor(source);
  const heuristic = b.label === "Heuristic";
  return (
    <span
      title={source}
      className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-white/80 px-2.5 text-[12px] font-medium text-dw-ink/80 shadow-[inset_0_0_0_1px_rgba(20,20,19,0.06)]"
    >
      {heuristic ? <BookOpen className="size-3.5" aria-hidden /> : glyph ? <BrandGlyph brand={glyph} size={13} /> : null}
      <span className="truncate">{heuristic ? "Written from Darwin's playbook, no LLM" : `Written by ${b.model ?? b.label}`}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ diff */

function prettyValue(v?: string): string {
  if (v === undefined) return "";
  const t = v.trim();
  if (/^\d{3,}$/.test(t)) return `£${(Number(t) / 100).toFixed(Number(t) % 100 ? 2 : 0)}`;
  return t.replace(/^"(.*)"$/, "$1");
}

/** The config diff as friendly setting rows: what the setting is, then A → B. */
export function SettingRows({ lines }: { lines: string[] }) {
  if (!lines.length) return <p className="text-[14px] text-dw-ink/60">The exact settings for this fix have aged out of Darwin&apos;s log.</p>;
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
            className="group grid gap-x-4 gap-y-1.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium">{humanizePath(d.path)}</div>
              <div className="truncate font-dwmono text-[11.5px] text-dw-ink/45">{d.path}</div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-dwmono text-[12.5px]">
              {d.before !== undefined && (
                <span className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-lg bg-[#FBE7E4] px-2 py-1 text-[#8E1D14]" title={d.before}>
                  <span className="font-dw text-[10px] font-semibold opacity-70">A</span>
                  <span className="truncate line-through decoration-[#8E1D14]/40">{prettyValue(d.before)}</span>
                </span>
              )}
              <span className="text-dw-ink/35 transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
              <span className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded-lg bg-[#E3F6EA] px-2 py-1 font-medium text-[#1B5E33]" title={d.after}>
                <span className="font-dw text-[10px] font-semibold opacity-70">B</span>
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
            <li key={id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/50 py-1 pr-3 pl-1 text-[13px] text-dw-ink/65" title={title}>
              <span className="grid size-6 place-items-center rounded-full bg-dw-win-bg text-dw-win">
                <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
              </span>
              <span className="truncate">{title}</span>
              <span className="shrink-0 text-[12px]">· no longer detected</span>
            </li>
          );
        }
        return (
          <li key={id} className="max-w-full">
            <Link
              href={`/console/issues?id=${encodeURIComponent(id)}`}
              className="group inline-flex max-w-full items-center gap-2 rounded-full bg-white py-1 pr-3 pl-1 text-[13px] transition-[transform,box-shadow] outline-none hover:-translate-y-px hover:shadow-[0_6px_14px_rgba(20,20,19,0.1)] focus-visible:ring-2 focus-visible:ring-dw-ink"
              title={title}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold" style={{ background: row.who === "Agents" ? "#F3B5D5" : row.who === "People" ? "#B8CAEE" : "#D5CCF5" }}>
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
