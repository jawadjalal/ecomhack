"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { GitPullRequest } from "lucide-react";
import { count, signedPct, timeAgo } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { BrandGlyph } from "../brand-logos";
import { Card, Tag } from "../ui";
import { audienceNoun, CARD_FILL, chance, diffCode, measured, type PrRow } from "./model";
import { Tip } from "./tip";

const rate = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}`;

/* ------------------------------------------------------------------ the change */

export function DiffCard({ row, configPath, live }: { row: PrRow; configPath: string; live: boolean }) {
  const reduce = useReducedMotion();
  const lines = diffCode(row.diff);
  const branch = row.pr.branch ?? (row.kind === "install" ? "darwin/install-analytics" : undefined);
  const meta = [branch && `${branch} → ${row.pr.base ?? "main"}`, row.kind === "spec" ? "1 file" : undefined, row.state === "preview" ? "dry run" : row.pr.repo].filter(Boolean).join(" · ");
  return (
    <Card tone="white" hover={false} className={`h-full px-5 sm:px-7 ${CARD_FILL} [&>.relative]:gap-5`} aria-label="The change">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[22px] leading-snug font-semibold tracking-[-0.01em] sm:text-[24px]">{row.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {meta && <span className="min-w-0 font-dwmono text-[12.5px] break-all text-[#6B655A]">{meta}</span>}
          {row.state === "preview" &&
            (live ? (
              <Tag tone="warn">Preview: drafted as a dry run</Tag>
            ) : (
              <Link href="/onboarding" className="rounded-full focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none">
                <Tag tone="warn" className="transition-colors hover:bg-[#f7dcc0]">
                  Preview: connect GitHub to open it for real
                </Tag>
              </Link>
            ))}
          {row.state === "queued" && <Tag tone="warn">Queued: GitHub was unavailable</Tag>}
        </div>
      </div>
      <div className="flex min-h-[300px] flex-1 flex-col overflow-x-auto rounded-[18px] bg-dw-ink px-5 py-4 font-dwmono text-[13px] leading-[1.85] text-[#E8E6DF] sm:px-6 sm:text-[14px]">
        <span className="mb-1.5 text-[#8F8B82]">{row.kind === "install" ? "your store's root layout" : configPath}</span>
        {row.kind === "install" ? (
          <>
            <motion.span initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="whitespace-pre text-[#8EF0C0]">
              {'+ <script src="…/darwin.js" defer></script>'}
            </motion.span>
            <span className="mt-3 font-dw text-[13px] leading-snug text-[#8F8B82]">One script tag that lets Darwin see people and AI agents shop. It records events only; it never changes your pages.</span>
          </>
        ) : lines.length === 0 ? (
          <span className="font-dw text-[13px] text-[#8F8B82]">Darwin didn&apos;t log the settings for this pull request.</span>
        ) : (
          lines.map((l, i) => (
            <motion.span
              key={`${row.key}-${i}`}
              initial={reduce ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.035, duration: 0.25 }}
              className={cn("block whitespace-pre", l.kind === "add" && "-mx-2 rounded-[6px] bg-[#8EF0C0]/[0.07] px-2 text-[#8EF0C0]", l.kind === "del" && "-mx-2 rounded-[6px] bg-[#FF9A8F]/[0.07] px-2 text-[#FF9A8F]")}
            >
              {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
              {"  ".repeat(l.depth + 1)}
              {l.text}
            </motion.span>
          ))
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ proof */

function Tile({ value, label, tip, i }: { value: string; label: string; tip?: string; i: number }) {
  const reduce = useReducedMotion();
  const body = (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.25 + i * 0.07, type: "spring", stiffness: 300, damping: 26 }}
      tabIndex={tip ? 0 : undefined}
      className="flex w-full flex-col rounded-[16px] bg-white/55 px-4 py-3.5 transition-colors outline-none hover:bg-white/75 focus-visible:ring-2 focus-visible:ring-dw-ink"
    >
      <span className="num text-[22px] leading-tight font-semibold tracking-[-0.02em]">{value}</span>
      <span className="text-[13px] text-[#2F3517]">{label}</span>
    </motion.div>
  );
  return tip ? (
    <Tip tip={tip} wide align={i % 2 === 0 ? "start" : "end"} className="flex">
      {body}
    </Tip>
  ) : (
    body
  );
}

export function ProofCard({ row, synthetic }: { row: PrRow; synthetic: boolean }) {
  const result = row.experiment?.result;
  const m = result ? measured(result) : undefined;
  const lift = row.lift ?? result?.lift;
  return (
    <Card tone="olive" shape="shipper" corner="br" className={`h-full px-5 sm:px-7 ${CARD_FILL} [&>.relative]:gap-5`} aria-label="Proof">
      <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{row.kind === "install" ? "Why it matters" : "Proof"}</h2>
      {row.kind === "install" ? (
        <p className="max-w-[26rem] text-[16px] leading-snug text-[#2F3517]">
          Darwin can&apos;t fix what it can&apos;t see. This pull request is how every later test gets its shoppers: people in the browser, agents through the store API.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-col">
            <span className="num text-[56px] leading-none font-semibold tracking-[-0.03em] sm:text-[64px]">{lift !== undefined ? signedPct(lift) : "–"}</span>
            <span className="mt-1 text-[15px] text-[#2F3517]">more {audienceNoun(m?.audience ?? "all")} bought</span>
          </div>
          {result && m ? (
            <div className="grid grid-cols-2 gap-2.5">
              <Tile i={0} value={chance(result.probabilityToBeat)} label="chance it wins" tip="Darwin's Bayesian read of the test: how sure it is that B beats A." />
              <Tile i={1} value={count(m.visitors)} label={`${audienceNoun(m.audience)} tested${synthetic ? " (simulated)" : ""}`} tip={`${count(m.a.visitors)} saw A, ${count(m.b.visitors)} saw B`} />
              <Tile
                i={2}
                value={`${rate(result.control.byKind.human.conversionRate)} → ${rate(result.treatment.byKind.human.conversionRate)}%`}
                label="people convert"
                tip={`${count(result.control.byKind.human.visitors)} people saw A, ${count(result.treatment.byKind.human.visitors)} saw B`}
              />
              <Tile
                i={3}
                value={`${rate(result.control.byKind.agent.conversionRate)} → ${rate(result.treatment.byKind.agent.conversionRate)}%`}
                label="agents convert"
                tip={`${count(result.control.byKind.agent.visitors)} agents saw A, ${count(result.treatment.byKind.agent.visitors)} saw B`}
              />
            </div>
          ) : (
            <p className="text-[14px] text-[#2F3517]">The test behind this pull request isn&apos;t in Darwin&apos;s memory any more, so only its lift is shown.</p>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ all PRs */

function Bubble({ row, on }: { row: PrRow; on: boolean }) {
  return (
    <span
      className={cn(
        "dw-tilt grid size-[38px] shrink-0 place-items-center rounded-full text-[13px] font-semibold transition-colors",
        on ? "bg-dw-ink text-white" : row.kind === "install" ? "bg-dw-olive text-dw-ink" : row.state === "open" ? "bg-dw-ink/85 text-white" : "bg-[#F2ECDF] text-[#6B655A]",
      )}
    >
      {row.pr.number ?? (row.kind === "install" ? <BrandGlyph brand="github" size={15} /> : <GitPullRequest className="size-4" aria-hidden />)}
    </span>
  );
}

function statusText(row: PrRow, live: boolean): string {
  if (row.state === "queued") return "Queued: GitHub was unavailable";
  if (row.state === "open") return row.kind === "install" ? "Opened on GitHub" : "Open on GitHub";
  return live ? "Preview (dry run)" : "Preview: connect GitHub";
}

export function PrList({ rows, selected, onSelect, now, live }: { rows: PrRow[]; selected?: string; onSelect: (key: string) => void; now: number; live: boolean }) {
  const reduce = useReducedMotion();
  return (
    <Card tone="white" hover={false} className="p-5 sm:px-6" aria-label="All pull requests">
      <div className="flex items-center gap-2.5 px-1.5 pb-3">
        <BrandGlyph brand="github" size={22} />
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">All pull requests</h2>
        <span className="num ml-auto text-[13px] text-dw-ink/55">{rows.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((r, i) => {
          const on = r.key === selected;
          return (
            <motion.li key={r.key} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3 }} className="relative">
              {on && <motion.span layoutId="dw-pr-sel" className="absolute inset-0 rounded-[16px] bg-dw-sand" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <button
                type="button"
                onClick={() => onSelect(r.key)}
                aria-pressed={on}
                className={cn(
                  "dw-row relative grid w-full grid-cols-[38px_1fr_auto] items-center gap-x-4 gap-y-0.5 rounded-[16px] px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-dw-ink md:grid-cols-[38px_2.4fr_0.6fr_1fr_60px]",
                  !on && "hover:bg-[#F6F0E4]",
                )}
              >
                <Bubble row={r} on={on} />
                <span className="min-w-0 truncate text-[15px] font-semibold">{r.title}</span>
                <span className={cn("num text-[15px] font-semibold max-md:hidden", (r.lift ?? 0) < 0 && "text-dw-ink/55")}>{r.lift !== undefined ? signedPct(r.lift) : "–"}</span>
                <span className="col-start-2 row-start-2 text-[13px] text-[#4A463D] md:col-start-auto md:row-start-auto md:text-[15px]">
                  {r.state === "preview" && <span className="mr-2 inline-block size-2 rounded-full bg-dw-warn align-middle" aria-hidden />}
                  {r.state === "open" && <span className="mr-2 inline-block size-2 rounded-full bg-dw-live align-middle" aria-hidden />}
                  {statusText(r, live)}
                </span>
                <span className="row-span-2 text-right text-[13px] text-[#8A8478] md:row-span-1">{timeAgo(r.at, now)}</span>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
}
