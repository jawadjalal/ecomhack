"use client";

/**
 * One shopper's journey: who they are, a path of five steps (Landed → Viewed product → Added to bag →
 * Checkout → Bought) drawn as connected nodes, with the exact step where they left marked, what happened
 * at each step in plain words (and the agent tool call in mono), Iris's read, and the page version they saw.
 * Rendered inside the blue panel on desktop and inside the full sheet on phones.
 */
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { AnalyticsSummary, GenerationRecord, LoopState } from "@/lib/contracts";
import { money, timeAgo } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { AgentTile } from "../agent-tile";
import { Mascot } from "../mascot";
import { humanDuration } from "../ui";
import { darwinNote, linkFor, type BoardRow, type Shopper, type ShopperStep, type TestView } from "./model";

export const STAGES = ["Landed", "Viewed product", "Added to bag", "Checkout", "Bought"] as const;

/** Card depth from the brief: a crisp top highlight and a soft contact shadow. */
export const DEPTH = "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_1px_2px_rgba(20,20,19,0.06),0_14px_30px_-20px_rgba(20,20,19,0.35)]";

const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

const AGENT_STAGE: Record<string, number> = {
  search_products: 0,
  get_product: 1,
  check_availability: 1,
  add_to_cart: 2,
  get_cart: 2,
  negotiate: 2,
  checkout: 3,
};
const PERSON_STAGE: Record<string, number> = {
  $pageview: 0,
  product_viewed: 1,
  product_added: 2,
  cart_viewed: 2,
  checkout_started: 3,
  shipping_cost_revealed: 3,
  checkout_step_completed: 3,
  checkout_abandoned: 3,
  order_completed: 4,
};

interface Stage {
  label: string;
  at?: string;
  steps: ShopperStep[];
}

/** Steps grouped under the five stages, in order (a step never moves the path backwards). */
export function stagesOf(s: Shopper): Stage[] {
  const out: Stage[] = STAGES.map((label) => ({ label, steps: [] }));
  const map = s.kind === "agent" ? AGENT_STAGE : PERSON_STAGE;
  let cur = 0;
  s.steps.forEach((st, i) => {
    let stage = Math.max(cur, map[st.tool] ?? cur);
    if (s.kind === "agent" && s.status === "bought" && st.tool === "checkout" && i === s.steps.length - 1) stage = 4;
    cur = Math.min(stage, 4);
    const box = out[cur];
    box.steps.push(st);
    box.at ??= st.t;
  });
  return out;
}

/** "people" → a plain person silhouette in a tile the same size as an agent's brand tile. */
export function PersonTile({ size = 40, bought, className }: { size?: number; bought?: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Person"
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden", bought ? "bg-dw-olive" : "bg-dw-sand", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 0 0 1px rgba(20,20,19,0.07), 0 2px 6px rgba(20,20,19,0.08)",
      }}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
        <circle cx="20" cy="15.5" r="6.6" fill={bought ? "#3E4520" : "#6B655A"} />
        <path d="M7 40c0-8.2 5.8-13.6 13-13.6S33 31.8 33 40z" fill={bought ? "#3E4520" : "#6B655A"} />
      </svg>
    </span>
  );
}

export function ShopperAvatar({ s, size = 40, className }: { s: Shopper; size?: number; className?: string }) {
  return s.kind === "agent" ? (
    <AgentTile brand={s.brand} size={size} className={className} />
  ) : (
    <PersonTile size={size} bought={s.status === "bought"} className={className} />
  );
}

/** "6 calls · Bought £225" / "mobile · left at checkout". */
export function rowLine(s: Shopper): string {
  const who = s.kind === "agent" ? `${s.steps.length} ${s.steps.length === 1 ? "call" : "calls"}` : s.model.toLowerCase();
  const what =
    s.status === "bought"
      ? `Bought${s.orderTotal ? ` ${money(s.orderTotal)}` : ""}`
      : s.status === "live"
        ? "shopping now"
        : `left at ${STAGES[Math.min(s.reach, 3)].toLowerCase()}`;
  return `${who} · ${what}`;
}

/** Plain words for Darwin's notes: no "test B", and the list belongs to Iris. */
export function plain(t: string): string {
  return t
    .replace(/\bTest B fixes this step\b/g, "The new version in Ada’s test fixes this step")
    .replace(/\bin test B\b/g, "on the new version")
    .replace(/\bA, the current store\b/g, "your current page")
    .replace(/Darwin’s list/g, "Iris’s list")
    .replace(/Darwin is still learning/g, "Iris is still learning")
    .replace(/\bPrincipal\b/g, "Its owner")
    .replace(/\bprincipal\b/g, "its owner");
}

/** The shipped version that was live when this shopper arrived (never version 0 or an undo). */
function versionSeen(s: Shopper, history: GenerationRecord[] | undefined): GenerationRecord | undefined {
  const at = Date.parse(s.startedAt);
  const live = (history ?? []).filter((h) => Date.parse(h.shippedAt) <= at).at(-1);
  if (!live || live.generation <= 0 || /rolled back|undo/i.test(live.label)) return undefined;
  return live;
}

export function JourneyHead({ s, now, big, showPill = false }: { s: Shopper; now: number; big?: boolean; showPill?: boolean }) {
  const won = s.status === "bought";
  const meta = [
    s.kind === "agent" ? `AI shopper · ${s.model}` : `Person · ${s.model.toLowerCase()}`,
    humanDuration(Date.parse(s.lastAt) - Date.parse(s.startedAt)),
    s.status === "live" ? "here now" : timeAgo(s.lastAt, now) ? `${timeAgo(s.lastAt, now)} ago` : undefined,
    s.synthetic ? "simulated" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const pill = (
    <span
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 self-start rounded-[8px] px-2.5 text-[13px] font-semibold tabular-nums",
        won ? "bg-dw-olive text-dw-ink" : s.status === "live" ? "bg-dw-surface text-dw-ink" : "bg-dw-ink text-white",
      )}
    >
      {s.status === "live" && <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" />}
      {won ? `Bought${s.orderTotal ? ` ${money(s.orderTotal)}` : ""}` : s.status === "live" ? "Shopping now" : `Left at ${STAGES[Math.min(s.reach, 3)].toLowerCase()}`}
    </span>
  );
  return (
    <div className={cn("flex gap-3.5", big ? "items-start" : "items-center")}>
      <ShopperAvatar s={s} size={big ? 52 : 46} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[20px] leading-tight font-semibold tracking-[-0.01em]">{s.name}</span>
        <span className={cn("text-[12.5px] text-[#3E4E70]", big ? "leading-snug" : "truncate")}>{meta}</span>
      </div>
      {/* On desktop the path's pin already says where they left or paid; the sheet keeps it in the path too. */}
      {showPill && pill}
    </div>
  );
}

/** The five steps as connected nodes along a line. */
export function JourneyPath({ s }: { s: Shopper }) {
  const reduce = useReducedMotion();
  const stages = stagesOf(s);
  const won = s.status === "bought";
  const live = s.status === "live";
  return (
    <ol aria-label="Path through the store" className="flex flex-col">
      {stages.map((st, i) => {
        const done = i < s.reach || (i === s.reach && won);
        const here = i === s.reach && !won;
        const ahead = i > s.reach;
        const last = i === stages.length - 1;
        const shown = st.steps.slice(-2);
        const more = st.steps.length - shown.length;
        return (
          <li key={st.label} className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-3">
            <div className="flex flex-col items-center">
              <motion.span
                initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ ...SPRING, delay: reduce ? 0 : i * 0.05 }}
                className={cn(
                  "relative z-[1] grid size-[26px] shrink-0 place-items-center rounded-full",
                  done && (i === 4 ? "bg-dw-olive text-dw-ink" : "bg-dw-ink text-white"),
                  here && live && "bg-dw-surface",
                  here && !live && "bg-dw-hot text-white",
                  ahead && "border-[1.5px] border-dashed border-dw-ink/35",
                  (done || here) && "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_5px_-1px_rgba(20,20,19,0.3)]",
                )}
              >
                {done && (
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    <path d="M3.5 8.4l3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {here && live && <span className="dw-live-dot size-2.5 rounded-full bg-dw-live" />}
                {here && !live && (
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
              </motion.span>
              {!last && (
                <motion.span
                  aria-hidden
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1], delay: reduce ? 0 : 0.06 + i * 0.06 }}
                  className={cn(
                    "-my-0.5 w-0 flex-1 origin-top border-l-2",
                    i < s.reach ? "border-dw-ink" : "border-dashed border-dw-ink/25",
                    "min-h-3",
                  )}
                />
              )}
            </div>
            <div className={cn("flex min-w-0 flex-col gap-1", last ? "pb-0" : ahead ? "pb-3" : "pb-4")}>
              <div className="flex min-h-[26px] items-center gap-2">
                <span className={cn("truncate text-[15px] font-semibold", ahead && "font-medium text-dw-ink/45")}>{st.label}</span>
                {here && !live && (
                  <span className="shrink-0 rounded-full bg-dw-hot px-2 py-0.5 text-[11.5px] font-semibold text-white">Left here</span>
                )}
                {here && live && <span className="shrink-0 rounded-full bg-dw-surface px-2 py-0.5 text-[11.5px] font-semibold">Here now</span>}
                {st.at && <span className="ml-auto shrink-0 font-dwmono text-[12px] text-[#3E4E70] tabular-nums">{st.at}</span>}
              </div>
              {shown.map((e, j) => (
                <div key={`${e.tool}-${j}`} className="flex min-w-0 flex-col">
                  <span className={cn("text-[13.5px] leading-snug", e.tone === "warn" || e.tone === "fail" ? "text-dw-ink" : "text-dw-ink/80")}>
                    {e.text}
                  </span>
                  {s.kind === "agent" && (
                    <span className="truncate font-dwmono text-[11.5px] text-[#3E4E70]">
                      {e.tool}
                      {e.tool === "abandon"
                        ? " → left"
                        : e.tone === "warn"
                          ? " → not shown"
                          : e.tone === "fail"
                            ? " → failed"
                            : e.tone === "live"
                              ? " → working"
                              : " → ok"}
                    </span>
                  )}
                </div>
              ))}
              {more > 0 && <span className="text-[12px] text-[#3E4E70]">and {more} more before that</span>}
              {here && !live && (
                <p className="mt-1 rounded-[14px] border border-dw-ink/10 bg-dw-surface/80 px-3 py-2 text-[13.5px] leading-snug">{plain(s.key.text)}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Iris's read, the page version they saw, the issue it links to and what the page showed them. */
export function JourneyNotes({
  s,
  now,
  loop,
  test,
  board,
  summary,
}: {
  s: Shopper;
  now: number;
  loop?: LoopState;
  test?: TestView;
  board: BoardRow[];
  summary?: AnalyticsSummary;
}) {
  const note = plain(darwinNote(s, { loop, test, board, summary }));
  const link = linkFor(s, loop, test);
  const inTest = test && s.experimentId === test.experiment.id ? s.arm : undefined;
  const seen = versionSeen(s, loop?.history);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={cn("flex flex-col gap-2 rounded-[20px] bg-dw-surface px-4 py-3.5", DEPTH)}>
        <div className="flex items-center gap-2.5">
          <Mascot kind="observer" size={30} frame active />
          <span className="text-[14px] font-semibold">Iris</span>
          <span className="text-[12.5px] text-dw-muted">watcher</span>
        </div>
        <p className="text-[14px] leading-normal">{note}</p>
        {link && (
          <Link
            href={link.href}
            className="inline-flex max-w-full items-center gap-1.5 self-start truncate text-[12.5px] font-medium underline decoration-dw-ink/25 underline-offset-[3px] hover:decoration-dw-ink"
          >
            <span className="size-[7px] shrink-0 rounded-full bg-dw-hot" />
            <span className="truncate">{link.label.replace(/^Test B · /, "Ada’s test · ")}</span>
          </Link>
        )}
      </div>

      {inTest === "B" ? (
        <div className="flex items-start gap-3 rounded-[20px] bg-dw-pink px-4 py-3">
          <Mascot kind="experimenter" size={30} frame active />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-semibold">Saw the new version in Ada’s test</span>
            <span className="text-[13px] leading-snug text-[#5A2744]">{test?.experiment.name}</span>
          </div>
        </div>
      ) : inTest === "A" ? (
        <div className="flex items-start gap-3 rounded-[20px] border border-dw-ink/10 bg-dw-surface/70 px-4 py-3">
          <Mascot kind="experimenter" size={30} frame active={false} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-semibold">Saw your current page in Ada’s test</span>
            <span className="text-[13px] leading-snug text-dw-muted">{test?.experiment.name}</span>
          </div>
        </div>
      ) : seen ? (
        <div className="flex items-start gap-3 rounded-[20px] bg-dw-olive px-4 py-3">
          <Mascot kind="shipper" size={30} frame active />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[14px] font-semibold">
              {s.kind === "human" && /\b(ai|agents?)\b/i.test(seen.label) ? "Shopped on" : "Saw"} version {seen.generation}
            </span>
            <span className="text-[13px] leading-snug text-[#2F3515]">
              {seen.label.replace(/^(gen|version)\s*\d+\s*[:·-]\s*/i, "")}. Max shipped it {timeAgo(seen.shippedAt, now) ? `${timeAgo(seen.shippedAt, now)} ago` : "just now"}.
            </span>
          </div>
        </div>
      ) : null}

      {s.key.rows.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[20px] border border-dw-ink/10 bg-dw-surface/60 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-[#3E4E70]">What the page showed</span>
            <span className="truncate text-[12.5px] font-semibold">{s.key.mockTitle}</span>
          </div>
          {s.key.rows.map((r) => (
            <div key={r.k} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate text-dw-ink/70">{r.k}</span>
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap tabular-nums",
                  r.tone === "bad"
                    ? "rounded-full border border-dashed border-[#C2306F] px-2 font-semibold text-[#C2306F]"
                    : r.tone === "good"
                      ? "font-semibold text-dw-win"
                      : r.tone === "live"
                        ? "font-semibold text-[#C2306F]"
                        : "font-medium",
                )}
              >
                {r.v}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the journey, top to bottom */

/** The simulator's templated reasons, in plain words (formatting only; nothing is added). */
const CATEGORY_WORDS: Record<string, [string, string]> = {
  road: ["road-running shoe", "road-running shoes"],
  trail: ["trail shoe", "trail shoes"],
  racing: ["racing shoe", "racing shoes"],
  carbon: ["carbon racing shoe", "carbon racing shoes"],
  accessories: ["accessory", "accessories"],
  products: ["product", "products"],
};
export function humanReason(t: string): string {
  let out = t
    .replace(/£(\d[\d,]*)\.00\b/g, "£$1")
    .replace(/\b(no) (road|trail|racing|carbon|accessories|products)\b/gi, (_m, no: string, c: string) => `${no} ${CATEGORY_WORDS[c.toLowerCase()]?.[0] ?? c}`)
    .replace(/\bwithin (£\d[\d,.]*)/g, "under $1")
    .replace(/\bno delivery ETA exposed\b/gi, "the store didn’t show a delivery date")
    .replace(/\bno landed price exposed\b/gi, "the store didn’t show the price with delivery")
    .replace(/\bno stock levels exposed\b/gi, "the store didn’t show stock by size")
    .replace(/\bincl\. shipping\b/g, "including delivery");
  // "X: can't Y" → "X, so it couldn’t Y".
  out = out.replace(/:\s+can[’']t\s+/i, ", so it couldn’t ");
  return capitalise(out.trim());
}

const capitalise = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

/** "03:12" → 192. */
function secs(t: string | undefined): number | undefined {
  const m = t ? /^(\d+):(\d{2})$/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}
function gapText(s: number): string {
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `+${m}m ${r}s` : `+${m}m`;
}

const LEFT_AT = ["landing", "the product page", "the bag", "checkout"] as const;

/** "Left at landing" / "Paid £115" / "Here now". */
export function outcomeText(s: Shopper): string {
  if (s.status === "bought") return s.orderTotal ? `Paid ${money(s.orderTotal)}` : "Paid";
  if (s.status === "live") return "Here now";
  return `Left at ${LEFT_AT[Math.min(s.reach, 3)]}`;
}

const TOOL_RESULT = (st: ShopperStep) =>
  st.tool === "abandon" ? "left" : st.tone === "warn" ? "not shown" : st.tone === "fail" ? "failed" : st.tone === "live" ? "working" : "ok";

/** A step's name: the stage in plain words, specific where the data says what they looked at. */
function stepName(i: number, st: Stage, s: Shopper): string {
  if (i === 4) return s.orderTotal ? `Paid ${money(s.orderTotal)}` : "Paid";
  if (i === 1) {
    const viewed = st.steps.map((x) => /^(?:Viewed|Opened) (.+)$/.exec(x.text)?.[1]).find(Boolean);
    if (viewed && !/product page|a product/i.test(viewed)) return `Viewed ${viewed}`;
    return "Viewed a product";
  }
  return ["Landed", "", "Added to bag", "Checkout"][i];
}

/** One plain header line: "Gemini shopper · 2 tool calls · simulated" / "Person on mobile · 14 seconds · simulated". */
function headLine(s: Shopper, now: number): string {
  const ago = s.status === "live" ? undefined : timeAgo(s.lastAt, now);
  return [
    s.kind === "agent" ? `${s.model} shopper` : `Person on ${s.model.toLowerCase()}`,
    s.kind === "agent" ? `${s.steps.length} tool ${s.steps.length === 1 ? "call" : "calls"}` : humanDuration(Date.parse(s.lastAt) - Date.parse(s.startedAt)) + " on the store",
    ago && ago !== "now" ? `${ago} ago` : undefined,
    s.synthetic ? "simulated" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function JourneyHeader({ s, now }: { s: Shopper; now: number }) {
  const left = s.status === "left";
  return (
    <div className="flex items-center gap-4">
      <ShopperAvatar s={s} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[20px] leading-tight font-semibold tracking-[-0.01em]">{s.name}</span>
        <span className="truncate text-[12.5px] text-[#3E4E70]">{headLine(s, now)}</span>
      </div>
      <span className={cn("flex shrink-0 items-center gap-2 text-[20px] leading-tight font-semibold tracking-[-0.01em] tabular-nums", left && "text-[#C2306F]")}>
        {s.status === "live" && <span className="dw-live-dot size-2 rounded-full bg-dw-live" />}
        {outcomeText(s)}
      </span>
    </div>
  );
}

/** The steps top to bottom on a thin rail: reached steps in ink, the step they left on in pink, the rest faint. */
export function JourneyTimeline({ s }: { s: Shopper }) {
  const reduce = useReducedMotion();
  const stages = stagesOf(s);
  const won = s.status === "bought";
  const live = s.status === "live";
  const stopAt = Math.min(s.reach, 4);
  // Seconds since the previous reached step, per step.
  const gaps: (number | undefined)[] = [];
  let prev: number | undefined;
  stages.forEach((st, i) => {
    const at = secs(st.at);
    gaps.push(i > 0 && i <= s.reach && at !== undefined && prev !== undefined ? at - prev : undefined);
    if (i <= s.reach && at !== undefined) prev = at;
  });
  return (
    <ol aria-label="Path through the store" className="flex flex-col">
      {stages.map((st, i) => {
        const reached = i <= s.reach;
        const here = i === stopAt && !won;
        const last = i === stages.length - 1;
        const gap = gaps[i];
        const name = stepName(i, st, s);
        const detail = st.steps.at(-1)?.text;
        const showDetail = reached && i < 4 && detail && detail.toLowerCase() !== name.toLowerCase() && !(here && /^gave up$/i.test(detail));
        const calls = s.kind === "agent" ? st.steps.slice(-2) : [];
        return (
          <motion.li
            key={st.label}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: reduce ? 0 : i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
            className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-4"
          >
            {/* rail + node */}
            <div className="relative flex flex-col items-center">
              <span className="flex h-6 items-center">
                <span
                  className={cn(
                    "relative z-[1] grid place-items-center rounded-full",
                    here && !live && "size-4 bg-[#C2306F] ring-4 ring-[#C2306F]/20",
                    here && live && "size-4 bg-dw-surface ring-4 ring-dw-surface/50",
                    !here && reached && (i === 4 ? "size-4 bg-dw-ink" : "size-2.5 bg-dw-ink"),
                    !reached && "size-2.5 border-[1.5px] border-dashed border-dw-ink/40",
                  )}
                >
                  {here && live && <span className="dw-live-dot size-2 rounded-full bg-dw-live" />}
                  {!here && reached && i === 4 && (
                    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden className="text-white">
                      <path d="M3.5 8.4l3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </span>
              {!last && (
                <span
                  aria-hidden
                  className={cn("w-0 flex-1 border-l-[1.5px]", i < s.reach ? "border-dw-ink/70" : "border-dashed border-dw-ink/20")}
                />
              )}
            </div>
            {/* the step */}
            <div className={cn("flex min-w-0 flex-col gap-1", last ? "pb-0" : reached ? "pb-6" : "pb-4")}>
              <div className="flex min-h-6 items-baseline gap-3">
                <span className={cn("min-w-0 flex-1 truncate text-[15px] font-medium", !reached && "text-dw-ink/40")}>{name}</span>
                {reached && (
                  <span className="shrink-0 text-[12.5px] text-[#3E4E70] tabular-nums">
                    {gap !== undefined ? gapText(gap) : i === 0 ? "start" : ""}
                    {st.at && <span className="ml-2 text-dw-ink/40">{st.at}</span>}
                  </span>
                )}
                {!reached && <span className="shrink-0 text-[12.5px] text-dw-ink/35">not reached</span>}
              </div>
              {showDetail && <span className="text-[13.5px] leading-snug text-dw-ink/70">{detail}</span>}
              {calls.map((c, j) => (
                <span key={`${c.tool}-${j}`} className="truncate font-dwmono text-[12px] text-dw-ink/55">
                  {c.tool} → {TOOL_RESULT(c)}
                </span>
              ))}
              {here && !live && (
                <div className="mt-1 flex flex-col gap-0.5">
                  <span className="text-[12.5px] font-semibold text-[#C2306F]">Left here</span>
                  <span className="text-[14px] leading-snug text-dw-ink">{humanReason(plain(s.key.text))}</span>
                </div>
              )}
              {here && live && <span className="mt-1 text-[12.5px] font-semibold">Here now</span>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

/** Iris's read and the page version they saw, as quiet text blocks split by hairlines. */
export function JourneyWhy({ s, now, loop, test, board, summary }: { s: Shopper; now: number; loop?: LoopState; test?: TestView; board: BoardRow[]; summary?: AnalyticsSummary }) {
  const note = humanReason(plain(darwinNote(s, { loop, test, board, summary })));
  const link = linkFor(s, loop, test);
  const inTest = test && s.experimentId === test.experiment.id ? s.arm : undefined;
  const seen = versionSeen(s, loop?.history);
  const version = inTest
    ? { head: inTest === "B" ? "Saw the new version in the test" : "Saw your current page in the test", body: test?.experiment.name ?? "" }
    : seen
      ? {
          head: `Saw version ${seen.generation}`,
          body: `${seen.label.replace(/^(gen|version)\s*\d+\s*[:·-]\s*/i, "")}. Shipped ${timeAgo(seen.shippedAt, now) ? `${timeAgo(seen.shippedAt, now)} ago` : "just now"}.`,
        }
      : undefined;
  return (
    <div className="flex min-w-0 flex-col divide-y divide-dw-ink/10 border-t border-dw-ink/10">
      <div className="flex flex-col gap-1 py-4">
        <span className="text-[12.5px] text-[#3E4E70]">Why · the watcher’s read</span>
        <p className="text-[14px] leading-normal">{note}</p>
        {link && (
          <Link href={link.href} className="self-start truncate text-[12.5px] font-medium underline decoration-dw-ink/25 underline-offset-[3px] hover:decoration-dw-ink">
            {link.label.replace(/^Test B · /, "Test · ")}
          </Link>
        )}
      </div>
      {version && (
        <div className="flex flex-col gap-1 py-4">
          <span className="text-[12.5px] text-[#3E4E70]">{version.head}</span>
          <p className="text-[14px] leading-normal">{version.body}</p>
        </div>
      )}
    </div>
  );
}

/** The whole panel: header, then the timeline beside what they saw and why (stacked on narrow screens). */
export function JourneyView({
  s,
  now,
  loop,
  test,
  board,
  summary,
  aside,
  stacked,
}: {
  s: Shopper;
  now: number;
  loop?: LoopState;
  test?: TestView;
  board: BoardRow[];
  summary?: AnalyticsSummary;
  /** What they saw (the store page or the agent's last call). */
  aside: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6">
      <JourneyHeader s={s} now={now} />
      <div className="h-px bg-dw-ink/10" />
      <div className={cn("grid min-w-0 gap-8", stacked ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <JourneyTimeline s={s} />
        <div className="flex min-w-0 flex-col gap-4">
          {aside}
          <JourneyWhy s={s} now={now} loop={loop} test={test} board={board} summary={summary} />
        </div>
      </div>
    </div>
  );
}
