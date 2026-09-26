"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight, LoaderCircle, RotateCcw } from "lucide-react";
import { count, parseDiffLine, pct, signedPct, timeAgo } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { BrandGlyph } from "../brand-logos";
import { Card, CardTitle, LegendKey, LiveDot, PillButton, Tag } from "../ui";
import { appHref, audienceNoun, CARD_FILL, chance, measured, settingLabel, uplift, valueLabel, type ChangeEntry } from "./model";
import { Tip } from "./tip";

type Up = NonNullable<ReturnType<typeof uplift>>;

const rate = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const perK = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x))}`;

/* ------------------------------------------------------------------ uplift */

function Pair({ label, before, now, lift, delay }: { label: string; before: number; now: number; lift?: number; delay: number }) {
  const reduce = useReducedMotion();
  const H = 118;
  const max = Math.max(before, now, 0.0001) * 1.05;
  const pill = (v: number, solid: boolean, d: number) => (
    <Tip tip={`${solid ? "Now" : "Before Darwin"}: ${pct(v)} of ${label.toLowerCase()} bought`} align={label === "Everyone" ? "start" : label === "AI agents" ? "end" : "center"}>
      <span tabIndex={0} className="group/p flex flex-col items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
        <span className={solid ? "num text-[12px] font-semibold" : "num text-[12px] text-dw-ink/75"}>{rate(v)}</span>
        <motion.span
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: Math.max(22, Math.round((v / max) * H)), opacity: 1 }}
          transition={{ delay: d, type: "spring", stiffness: 160, damping: 20 }}
          className={
            solid
              ? "block w-[22px] rounded-full bg-dw-ink transition-[filter] group-hover/p:brightness-75"
              : "block w-[22px] rounded-full border-[1.5px] border-dashed border-dw-ink transition-colors group-hover/p:bg-dw-ink/10"
          }
        />
      </span>
    </Tip>
  );
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-end gap-2.5">
        {pill(before, false, delay)}
        {pill(now, true, delay + 0.08)}
      </div>
      <span className="text-[13px] text-dw-ink/80">{label}</span>
      <span className={cn("num inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold", lift !== undefined && lift < 0 ? "bg-dw-warn-bg text-dw-warn" : "bg-dw-ink text-white")}>
        {lift !== undefined ? signedPct(lift) : "–"}
      </span>
    </div>
  );
}

export function UpliftCards({ up, synthetic, shipped }: { up: Up; synthetic: boolean; shipped: number }) {
  const n = (h?: number, a?: number) => (h ?? 0) + (a ?? 0);
  const sim = synthetic ? " (simulated)" : "";
  return (
    <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
      <Card tone="white" className={`h-full ${CARD_FILL} [&>.relative]:gap-4`} aria-label="Before Darwin vs now">
        <CardTitle
          right={
            <span className="flex items-center gap-3">
              <LegendKey dashed>Before Darwin</LegendKey>
              <LegendKey>Now</LegendKey>
            </span>
          }
        >
          Before Darwin vs now
        </CardTitle>
        <div className="grid flex-1 grid-cols-3 items-end pt-2">
          <Pair label="Everyone" before={up.all.before} now={up.all.now} lift={up.all.lift} delay={0.15} />
          <Pair label="People" before={up.human.before} now={up.human.now} lift={up.human.lift} delay={0.27} />
          <Pair label="AI agents" before={up.agent.before} now={up.agent.now} lift={up.agent.lift} delay={0.39} />
        </div>
        <p className="text-[12.5px] leading-snug text-dw-ink/60">
          Share of shoppers who bought
          {n(up.base.humanVisitors, up.base.agentVisitors) > 0 && n(up.now.humanVisitors, up.now.agentVisitors) > 0
            ? `. Before: ${count(n(up.base.humanVisitors, up.base.agentVisitors))} shoppers on Gen 0; now: ${count(n(up.now.humanVisitors, up.now.agentVisitors))} on Gen ${up.now.generation}${sim}`
            : synthetic
              ? ", simulated shoppers"
              : ""}
          . &ldquo;Everyone&rdquo; uses your usual mix of people and agents, so it only moves when the store does.
        </p>
      </Card>

      <Card tone="yellow" shape="shipper" corner="br" className={`h-full ${CARD_FILL} [&>.relative]:gap-4`} aria-label="Extra buyers">
        <CardTitle>Extra buyers</CardTitle>
        <div className="flex flex-col">
          <span className="num text-[56px] leading-none font-semibold tracking-[-0.03em] sm:text-[64px]">{perK(up.all.per1000)}</span>
          <span className="mt-1 text-[15px] text-[#4F4417]">buyers per 1,000 visitors, from the same traffic</span>
        </div>
        <ul className="mt-auto flex flex-col gap-1.5 text-[14px]">
          {[
            ["People", up.human.per1000],
            ["AI agents", up.agent.per1000],
          ].map(([label, v]) => (
            <li key={label as string} className="flex items-center justify-between rounded-[14px] bg-white/45 px-3.5 py-2">
              <span>{label}</span>
              <span className="num font-semibold">{perK(v as number)} per 1,000</span>
            </li>
          ))}
        </ul>
        <p className="text-[12.5px] text-[#4F4417]">
          Across {shipped} shipped change{shipped === 1 ? "" : "s"}. Orders only; Darwin makes no revenue claims.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

function Node({ entry, on }: { entry: ChangeEntry; on: boolean }) {
  const base = "relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold ring-4 ring-dw-surface transition-transform";
  if (entry.kind === "rollback")
    return (
      <span className={cn(base, on ? "bg-dw-ink text-white" : "bg-dw-sand text-dw-ink")}>
        <RotateCcw className="size-4" aria-hidden />
      </span>
    );
  if (entry.kind === "baseline") return <span className={cn(base, "bg-dw-olive text-dw-ink")}>0</span>;
  return <span className={cn(base, entry.live === "undone" ? "bg-[#F2ECDF] text-[#6B655A]" : "bg-dw-ink text-white")}>{entry.generation}</span>;
}

function LiveTag({ entry }: { entry: ChangeEntry }) {
  if (entry.kind === "baseline") return <Tag tone="sand">Where Darwin started</Tag>;
  if (entry.live === "live")
    return (
      <Tag tone="win">
        <span className="size-1.5 rounded-full bg-dw-win" /> Live on your store
      </Tag>
    );
  if (entry.live === "partly")
    return (
      <Tip tip="A later change or rollback replaced some of these settings" wide align="start">
        <span tabIndex={0} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
          <Tag tone="warn">Partly live</Tag>
        </span>
      </Tip>
    );
  return <Tag tone="sand">Rolled back</Tag>;
}

function PrTag({ entry, mock }: { entry: ChangeEntry; mock: boolean }) {
  const pr = entry.pr;
  if (!pr) return null;
  if (pr.url && !pr.dryRun && !pr.queued)
    return (
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="relative z-10 inline-flex h-6 items-center gap-1.5 rounded-full bg-dw-ink px-2.5 text-[12px] font-medium text-white transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <BrandGlyph brand="github" size={12} /> Pull request{pr.number ? ` #${pr.number}` : ""} <ArrowUpRight className="size-3" aria-hidden />
      </a>
    );
  return (
    <Tip tip={pr.queued ? "GitHub was unavailable, so the PR is queued" : "Drafted as a dry run: nothing was opened on GitHub"} align="start">
      <span tabIndex={0} className="relative z-10 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink">
        <Tag tone="outline">
          <BrandGlyph brand="github" size={12} /> {pr.queued ? "PR queued" : `PR preview${mock ? "" : " (dry run)"}`}
        </Tag>
      </span>
    </Tip>
  );
}

function Settings({ diff }: { diff: string[] }) {
  if (!diff.length) return null;
  const lines = diff.map(parseDiffLine);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lines.slice(0, 3).map((l) => (
        <span key={l.path} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-dw-bg px-2.5 py-1 text-[12.5px]">
          <span className="min-w-[3rem] truncate">{settingLabel(l.path)}</span>
          <span className="max-w-[6rem] shrink-0 truncate font-dwmono text-[11.5px] text-[#8A8478] line-through">{valueLabel(l.path, l.before)}</span>
          <ArrowRight className="size-3 shrink-0" aria-label="becomes" />
          <span className="max-w-[8rem] min-w-0 truncate font-dwmono text-[11.5px] font-medium">{valueLabel(l.path, l.after)}</span>
        </span>
      ))}
      {lines.length > 3 && <span className="text-[12.5px] text-dw-ink/55">+{lines.length - 3} more</span>}
    </div>
  );
}

function proofLine(e: ChangeEntry, synthetic: boolean): string {
  const r = e.experiment?.result;
  if (e.kind === "baseline") {
    const rec = e.record;
    return `${pct(rec.overallConversionRate)} of shoppers bought · people ${pct(rec.humanConversionRate)} · AI agents ${pct(rec.agentConversionRate)}`;
  }
  if (e.kind === "rollback") return `Gen ${e.restores}'s settings restored · no test needed`;
  if (r) {
    const m = measured(r);
    return `${signedPct(e.record.lift ?? r.lift)} more ${audienceNoun(m.audience)} bought · ${chance(r.probabilityToBeat)} sure · ${count(m.visitors)} ${audienceNoun(m.audience)} tested${synthetic ? " (simulated)" : ""}`;
  }
  return e.record.lift !== undefined ? `${signedPct(e.record.lift)} conversion in its A/B test` : "Shipped by Darwin";
}

export interface TimelineProps {
  entries: ChangeEntry[];
  selected?: string;
  onSelect: (key: string) => void;
  now: number;
  mock: boolean;
  synthetic: boolean;
  testing?: { id: string; name: string; p?: number };
  confirming?: string;
  onConfirm: (key: string | undefined) => void;
  onRollback: (entry: ChangeEntry) => void;
  rollingBack: boolean;
  githubLive: boolean;
}

export function Timeline(props: TimelineProps) {
  const { entries, selected, onSelect, now, mock, synthetic, testing, confirming, onConfirm, onRollback, rollingBack, githubLive } = props;
  const reduce = useReducedMotion();
  return (
    <Card tone="white" hover={false} className="p-5 sm:px-6" aria-label="Every change">
      <div className="flex items-center gap-2.5 px-1.5 pb-4">
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Every change</h2>
        <span className="text-[13px] text-dw-ink/55">newest first</span>
      </div>
      <ol className="relative flex flex-col">
        <span aria-hidden className="absolute top-5 bottom-8 left-[19px] w-0.5 rounded-full bg-dw-hairline" />
        {testing && (
          <li className="relative flex gap-3.5 pb-3">
            <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full border-2 border-dashed border-dw-hot bg-dw-surface ring-4 ring-dw-surface">
              <LiveDot className="bg-dw-hot" />
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] px-3.5 py-2.5">
              <span className="min-w-0 text-[15px]">
                <span className="text-dw-ink/60">Testing now:</span> <span className="font-semibold">{testing.name}</span>
                {testing.p !== undefined && <span className="text-dw-ink/60"> · {chance(testing.p)} chance so far</span>}
              </span>
              <Link
                href={appHref(`/console/experiments#${testing.id}`, mock)}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-full bg-dw-sand px-3 text-[12.5px] font-medium transition-colors hover:bg-[#e4dccb] focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none"
              >
                See the test <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </li>
        )}
        {entries.map((e, i) => {
          const on = e.key === selected;
          const canUndo = e.kind !== "baseline" && e.live !== "undone" && e.undoTo !== undefined;
          const newer = entries.slice(0, i).filter((x) => x.kind !== "baseline").length;
          const confirm = confirming === e.key;
          return (
            <motion.li
              key={e.key}
              id={e.key}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 + i * 0.06, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative flex scroll-mt-24 gap-3.5 pb-3 last:pb-0"
            >
              <span className="pt-2.5">
                <Node entry={e} on={on} />
              </span>
              <div className="relative min-w-0 flex-1">
                {on && <motion.span layoutId="dw-change-sel" className="absolute inset-0 rounded-[18px] bg-dw-yellow" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <div className={cn("dw-row relative flex flex-col gap-2 rounded-[18px] px-3.5 py-3", !on && "hover:bg-[#F6F0E4]")}>
                  <div className="flex items-baseline gap-3">
                    <button
                      type="button"
                      onClick={() => onSelect(e.key)}
                      aria-pressed={on}
                      className="min-w-0 flex-1 text-left text-[16px] leading-snug font-semibold outline-none after:absolute after:inset-0 after:rounded-[18px] focus-visible:after:ring-2 focus-visible:after:ring-dw-ink"
                    >
                      <span className="mr-2 font-normal text-dw-ink/55">Gen {e.generation}</span>{" "}
                      {e.title}
                    </button>
                    <span className="num shrink-0 text-[12.5px] text-dw-ink/55">{e.kind === "baseline" ? "" : timeAgo(e.record.shippedAt, now) === "now" ? "just now" : `${timeAgo(e.record.shippedAt, now)} ago`}</span>
                  </div>
                  <Settings diff={e.diff} />
                  <p className="text-[13.5px] text-dw-ink/70">{proofLine(e, synthetic)}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <LiveTag entry={e} />
                    <PrTag entry={e} mock={mock} />
                    {on && canUndo && !confirm && (
                      <button
                        type="button"
                        onClick={() => onConfirm(e.key)}
                        className="relative z-10 ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-medium shadow-[0_1px_0_rgba(20,20,19,0.06)] transition-[background-color,transform] hover:bg-[#fffaf0] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        {e.kind === "rollback" ? "Undo this rollback" : "Roll back to before this"}
                      </button>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {confirm && e.undoTo !== undefined && (
                      <motion.div
                        key="confirm"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                        className="relative z-10 overflow-hidden"
                      >
                        <div role="alertdialog" aria-label="Confirm rollback" className="mt-1 flex flex-col gap-3 rounded-[14px] bg-dw-ink p-3.5 text-white sm:flex-row sm:items-center">
                          <p className="flex-1 text-[13.5px] leading-snug">
                            Put Gen {e.undoTo}&apos;s store back live? Shoppers see it right away
                            {newer > 0 ? `, and the ${newer} newer change${newer === 1 ? "" : "s"} above ${newer === 1 ? "goes" : "go"} too` : ""}.
                            {testing ? ` The running test stops without a verdict.` : ""}
                            {githubLive ? " Darwin also opens a pull request." : ""}
                          </p>
                          <div className="flex shrink-0 gap-2">
                            <PillButton tone="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => onConfirm(undefined)} disabled={rollingBack}>
                              Keep it
                            </PillButton>
                            <PillButton tone="white" size="sm" onClick={() => onRollback(e)} disabled={rollingBack} aria-busy={rollingBack} autoFocus>
                              {rollingBack ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                              Roll back
                            </PillButton>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </Card>
  );
}
