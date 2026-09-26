"use client";

/**
 * Live shoppers list joined to the Journey panel. The selected row turns pink, extends into the gap and
 * fuses with the panel through two radial-gradient fillets; the panel's top-left corner squares off when
 * the first row is selected.
 */
import Link from "next/link";
import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { AnalyticsSummary, LoopState } from "@/lib/contracts";
import { timeAgo } from "@/lib/console/format";
import { useNow } from "@/lib/console/hooks";
import { cn } from "@/components/ui/cn";
import { AgentTile } from "../agent-tile";
import { Mascot, Silhouette } from "../mascot";
import { ArmChip, PillButton, Segmented, humanDuration } from "../ui";
import { EASE } from "./fx";
import { FUNNEL, darwinNote, linkFor, type BoardRow, type KeyTone, type Shopper, type TestView } from "./model";

type Filter = "all" | "people" | "agents";
const ROWS = 6;
const PINK = "#F3B5D5";

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
/** Side-by-side list + panel (lg and up); below that the journey opens under the selected row. */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function byRecent(a: Shopper, b: Shopper) {
  return Date.parse(b.lastAt) - Date.parse(a.lastAt);
}

/** Up to six rows: a mix of agents and people for "All", newest first. */
function visibleRows(filter: Filter, agents: Shopper[], people: Shopper[]): Shopper[] {
  if (filter === "agents") return agents.slice(0, ROWS);
  if (filter === "people") return people.slice(0, ROWS);
  const a = agents.slice(0, ROWS);
  const p = people.slice(0, ROWS);
  const half = ROWS / 2;
  const takeA = Math.min(a.length, Math.max(half, ROWS - p.length));
  const takeP = Math.min(p.length, ROWS - takeA);
  return [...a.slice(0, takeA), ...p.slice(0, takeP)].sort(byRecent);
}

export function LiveShoppers({
  agents,
  people,
  loop,
  test,
  board,
  summary,
  onSendShoppers,
}: {
  agents: Shopper[];
  people: Shopper[];
  loop?: LoopState;
  test?: TestView;
  board: BoardRow[];
  summary?: AnalyticsSummary;
  onSendShoppers?: () => void;
}) {
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string>();
  /** While the pointer is over the list, keep its order still (rows update in place). */
  const [frozen, setFrozen] = useState<string[] | null>(null);

  const all = useMemo(() => new Map([...agents, ...people].map((s) => [s.id, s])), [agents, people]);
  const rows = useMemo(() => {
    let list = frozen ? frozen.map((id) => all.get(id)).filter((s): s is Shopper => !!s) : visibleRows(filter, agents, people);
    const chosen = picked ? all.get(picked) : undefined;
    const fits = chosen && (filter === "all" || (filter === "agents") === (chosen.kind === "agent"));
    if (chosen && fits && !list.some((s) => s.id === chosen.id)) list = [...list.slice(0, ROWS - 1), chosen];
    return list;
  }, [frozen, all, filter, agents, people, picked]);

  // Follow the first shopper once, then stay with them as new shoppers arrive (no jumping panel).
  if (!picked && rows[0]) setPicked(rows[0].id);
  const selIdx = Math.max(
    0,
    rows.findIndex((s) => s.id === picked),
  );
  const sel = rows[selIdx];
  const everyone = [...agents, ...people];
  const liveCount = everyone.filter((s) => s.status === "live").length;
  const lastMinute = now ? everyone.filter((s) => now - Date.parse(s.lastAt) < 60_000).length : 0;
  const simulated = everyone.some((s) => s.synthetic);
  const wide = useWide();

  const panel = (
    <div
      id="dw-journey"
      aria-label={wide ? undefined : "Journey"}
      role={wide ? undefined : "region"}
      className={cn(
        "relative flex flex-1 flex-col overflow-hidden rounded-[26px] px-5 py-6 sm:px-7",
        wide ? selIdx === 0 && rows.length > 0 && "rounded-tl-none" : "-mt-2 rounded-t-none px-4 pt-3 pb-5",
      )}
      style={{ background: PINK }}
    >
      <Silhouette kind="experimenter" color="#EDA5C9" size={260} style={{ right: -90, top: -110 }} />
      <AnimatePresence mode="wait" initial={false}>
        {sel ? (
          <motion.div
            key={sel.id}
            className="relative flex flex-1 flex-col gap-[22px]"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <Journey s={sel} loop={loop} test={test} board={board} summary={summary} compact={!wide} />
          </motion.div>
        ) : (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center text-[15px] text-[#5A2744]">
            <Mascot kind="experimenter" size={58} frame active />
            <p className="max-w-[24rem]">
              {rows.length
                ? "Pick a shopper to follow their path through the store, step by step."
                : "When shoppers arrive, pick one to follow their path through the store, step by step."}
            </p>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <section aria-label="Live shoppers" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 px-1 sm:flex-nowrap">
          <div className="flex min-w-0 items-baseline gap-3">
            <h2 className="shrink-0 text-[22px] font-semibold tracking-[-0.02em]">Live shoppers</h2>
            <span className="flex min-w-0 items-center gap-[7px] text-[13px] whitespace-nowrap text-[#6B655A]">
              <span className={cn("size-[7px] shrink-0 rounded-full", liveCount || lastMinute ? "dw-live-dot bg-dw-live" : "bg-dw-ink/25")} />
              <span className="truncate">
                {liveCount ? `${liveCount} on the store` : lastMinute ? `${lastMinute} in the last minute` : "Quiet right now"}
                {simulated && <span className="text-[#8A8478]"> · simulated</span>}
              </span>
            </span>
          </div>
          <Segmented<Filter>
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setFrozen(null);
              setPicked(undefined);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "people", label: "People" },
              { value: "agents", label: "Agents" },
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-[22px] bg-dw-sand px-6 py-10 text-center text-[15px] text-dw-ink/70">
            <Mascot kind="observer" size={56} frame active />
            <p className="max-w-[22rem]">
              {filter === "people" ? "No people on the store yet." : filter === "agents" ? "No AI shoppers yet." : "No one’s shopping right now."} Send some
              shoppers and watch them arrive.
            </p>
            {onSendShoppers && <PillButton onClick={onSendShoppers}>Send shoppers</PillButton>}
          </div>
        ) : (
          <LayoutGroup>
            <div
              aria-label="Shoppers"
              role="group"
              className="flex flex-col gap-2 lg:pb-6"
              onPointerEnter={() => setFrozen(rows.map((s) => s.id))}
              onPointerLeave={() => setFrozen(null)}
            >
              {rows.map((s, i) => (
                <Fragment key={s.id}>
                  <ShopperRow s={s} on={i === selIdx} first={i === 0} now={now} onPick={() => setPicked(s.id)} />
                  {!wide && i === selIdx && panel}
                </Fragment>
              ))}
            </div>
          </LayoutGroup>
        )}
      </section>

      {wide && (
        <section aria-label="Journey" className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 px-1">
            <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Journey</h2>
            {sel && (
              <span className="truncate text-[14px] text-[#6B655A]">
                {[
                  sel.kind === "agent" ? "Agent" : "Person",
                  sel.model,
                  sel.arm ? `test ${sel.arm}` : undefined,
                  humanDuration(Date.parse(sel.lastAt) - Date.parse(sel.startedAt)),
                  sel.synthetic ? "simulated" : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          {panel}
        </section>
      )}
    </div>
  );
}

function ShopperRow({ s, on, first, now, onPick }: { s: Shopper; on: boolean; first: boolean; now: number; onPick: () => void }) {
  const reduce = useReducedMotion();
  const when = s.status === "live" ? timeAgo(s.lastAt, now) || "now" : timeAgo(s.lastAt, now);
  return (
    <motion.button
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      type="button"
      aria-pressed={on}
      aria-controls="dw-journey"
      onClick={onPick}
      className={cn(
        "relative flex h-[90px] shrink-0 items-center gap-3.5 px-4 text-left text-dw-ink outline-none focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:ring-offset-dw-bg",
        on
          ? "rounded-[22px] bg-dw-pink max-lg:rounded-b-none lg:-mr-[18px] lg:rounded-r-none lg:pr-[34px]"
          : "dw-row rounded-[22px] bg-dw-sand hover:bg-[#e8e0cd]",
      )}
    >
      {on && !first && (
        <span
          aria-hidden
          className="absolute -top-5 right-0 hidden size-5 lg:block"
          style={{
            background: `radial-gradient(circle at 0 0, transparent 19.5px, ${PINK} 20px)`,
          }}
        />
      )}
      {on && (
        <span
          aria-hidden
          className="absolute right-0 -bottom-5 hidden size-5 lg:block"
          style={{
            background: `radial-gradient(circle at 0 100%, transparent 19.5px, ${PINK} 20px)`,
          }}
        />
      )}
      <span className="dw-tilt relative flex shrink-0">
        <Mascot kind={s.mascot} size={48} frame active={s.status === "live"} title={s.kind === "agent" ? `${s.brand.name} agent` : "Person"} />
        {s.kind === "agent" && <AgentTile brand={s.brand} size={20} invert={on} className="absolute -right-1.5 -bottom-1.5 z-[2]" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2.5">
          <span className="truncate text-[15px] font-semibold">{s.name}</span>
          <span className={cn("flex shrink-0 items-center font-dwmono text-[12px] whitespace-nowrap", on ? "text-[#5A2744]" : "text-[#8A8478]")}>
            {s.status === "live" && <span className="dw-live-dot mr-1.5 inline-block size-1.5 rounded-full bg-dw-live" />}
            {when}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {s.arm && <ArmChip arm={s.arm} />}
          <span className="truncate text-[13px] text-[#6B655A]">{s.sub}</span>
        </span>
      </span>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ journey */

const PILL: Record<KeyTone, string> = {
  warn: "bg-dw-warn-bg text-dw-warn",
  live: "bg-[#FCE1EE] text-[#C2306F]",
  won: "bg-dw-win-bg text-dw-win",
  fail: "bg-dw-sand text-dw-ink",
};
const STAGE: Record<KeyTone, string> = {
  warn: "linear-gradient(160deg, #8FA7D8 0%, #E9B8C9 55%, #E79A62 100%)",
  live: "linear-gradient(160deg, #B8CAEE 0%, #F3B5D5 55%, #F6D76B 100%)",
  won: "linear-gradient(160deg, #A8BCE7 0%, #C9D39A 55%, #7FA05A 100%)",
  fail: "linear-gradient(160deg, #B9B2A4 0%, #E3C9C0 55%, #C98D6E 100%)",
};
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function Journey({
  s,
  loop,
  test,
  board,
  summary,
  compact,
}: {
  s: Shopper;
  loop?: LoopState;
  test?: TestView;
  board: BoardRow[];
  summary?: AnalyticsSummary;
  /** Under its row on phones: the row already shows who it is, so the header is one line. */
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const won = s.status === "bought";
  const duration = humanDuration(Date.parse(s.lastAt) - Date.parse(s.startedAt));
  const link = linkFor(s, loop, test);
  const note = darwinNote(s, { loop, test, board, summary });
  const progress = won ? "5 of 5 steps · bought" : `${s.reach} of 5 steps · ${s.status === "live" ? "live" : `left at ${FUNNEL[s.reach].toLowerCase()}`}`;
  const shownSteps = s.steps.length > 1 ? s.steps.slice(0, -1).slice(-3) : [];
  const facts = [
    { k: "Shopper", v: s.kind === "agent" ? "Agent" : "Person" },
    { k: s.kind === "agent" ? "Model" : "Device", v: s.model },
    { k: "Test arm", v: s.arm ?? "Not in a test" },
    { k: "Session", v: duration },
  ];

  return (
    <>
      {compact ? (
        <div className="relative flex items-center justify-between gap-3">
          <span className="text-[13px] text-[#5A2744]">
            {duration} on the store{s.synthetic ? " · simulated" : ""}
          </span>
          <span
            className={cn(
              "flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-semibold",
              won ? "bg-dw-ink text-white" : "bg-white text-dw-ink",
            )}
          >
            {s.outcome}
          </span>
        </div>
      ) : (
        <div className="relative flex flex-wrap items-center gap-3.5 sm:flex-nowrap">
          <span className="relative flex shrink-0">
            <Mascot kind={s.mascot} size={58} frame active title={s.kind === "agent" ? `${s.brand.name} agent` : "Person"} />
            {s.kind === "agent" && <AgentTile brand={s.brand} size={24} className="absolute -right-1.5 -bottom-1.5 z-[2]" />}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[22px] font-semibold tracking-[-0.01em]">{s.name}</span>
            <span className="text-[14px] text-[#5A2744]">
              {duration} on the store{s.synthetic ? " · simulated" : ""}
            </span>
          </div>
          <span
            className={cn(
              "flex h-[34px] shrink-0 items-center rounded-full px-4 text-[14px] font-semibold",
              won ? "bg-dw-ink text-white" : "bg-white text-dw-ink",
            )}
          >
            {s.outcome}
          </span>
        </div>
      )}

      <div className="relative flex flex-col gap-2.5">
        <div className="flex justify-between gap-3 text-[13px] text-[#5A2744]">
          <span className="max-sm:hidden">Path through the store</span>
          <span className="font-dwmono text-[12px] text-dw-ink sm:text-[13px]">{progress}</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {FUNNEL.map((label, i) => {
            const reached = i < s.reach || (i === s.reach && won);
            const here = i === s.reach && !won;
            const live = here && s.status === "live";
            return (
              <div key={label} className="group flex min-w-0 flex-col gap-2">
                <motion.span
                  className={cn(
                    "block h-2 origin-left rounded-full transition-transform duration-200 group-hover:scale-y-150",
                    reached ? "bg-dw-ink" : here && !live ? "border-[1.5px] border-dashed border-dw-ink" : !here ? "bg-white/50" : "",
                    live && "animate-pulse motion-reduce:animate-none",
                  )}
                  style={
                    live
                      ? {
                          background: "linear-gradient(90deg, #141413 0 50%, rgba(20,20,19,0.14) 50%)",
                        }
                      : undefined
                  }
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    duration: 0.45,
                    ease: EASE,
                    delay: 0.05 + i * 0.07,
                  }}
                />
                <span
                  className={cn(
                    "flex items-center truncate text-[11.5px] whitespace-nowrap sm:text-[13px]",
                    reached || here ? "font-semibold text-dw-ink" : "text-[#8A6275]",
                  )}
                >
                  <span
                    className={cn(
                      "mr-1.5 hidden size-2 shrink-0 rounded-[2px] sm:inline-block",
                      reached ? "bg-dw-ink" : live ? "dw-live-dot bg-dw-hot" : here ? "border-[1.5px] border-dw-ink" : "bg-dw-ink/[0.14]",
                    )}
                  />
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[22px] bg-white/[0.62] px-[18px] py-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-[#5A2744]">Session</span>
            <span className="font-dwmono text-[12px] text-[#8A6275]">
              {s.steps.length} {s.kind === "agent" ? (s.steps.length === 1 ? "tool call" : "tool calls") : s.steps.length === 1 ? "event" : "events"}
            </span>
          </div>
          {s.brief && (
            <div className="max-w-[78%] self-end rounded-[16px_16px_4px_16px] bg-dw-ink px-3.5 py-2 text-[14px] leading-snug text-white">{s.brief}</div>
          )}
          {shownSteps.length > 0 && (
            <ol className="flex flex-col gap-0.5">
              {shownSteps.map((e, i) => (
                <li
                  key={`${e.tool}-${i}`}
                  className="-mx-2 grid h-7 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] px-2 transition-colors hover:bg-white/70"
                >
                  <StepIcon tone={e.tone} />
                  <span className="truncate text-[14px]">
                    {e.text} <span className="font-dwmono text-[12px] text-[#8A6275]">{e.tool}</span>
                  </span>
                  <span className="font-dwmono text-[12px] text-[#8A6275]">{e.t}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="group/tool flex flex-col gap-2.5 rounded-[18px] bg-white p-3 shadow-[0_0_0_1px_rgba(20,20,19,0.06)]">
            <div className="flex items-center justify-between gap-2.5 px-0.5">
              <span className="truncate font-dwmono text-[13px] font-medium">{s.key.tool}</span>
              <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-semibold", PILL[s.key.tone])}>
                {s.key.tone === "live" && (
                  <span className="inline-block size-[9px] animate-spin rounded-full border-[1.5px] border-current border-r-transparent motion-reduce:animate-none" />
                )}
                {s.key.pill}
              </span>
            </div>
            <span className="px-0.5 text-[14px] leading-snug">{s.key.text}</span>
            <div
              className="relative flex min-h-[112px] items-center justify-center overflow-hidden rounded-[12px] py-3"
              style={{ background: STAGE[s.key.tone] }}
            >
              <span aria-hidden className="pointer-events-none absolute inset-0 opacity-35 mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
              <div className="relative z-[1] w-[68%] overflow-hidden rounded-[10px] bg-white shadow-[0_10px_30px_rgba(20,20,19,0.18)] transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/tool:-translate-y-1 group-hover/tool:scale-[1.03]">
                <div className="flex h-[18px] items-center gap-1 border-b border-[#EFEAE0] px-2">
                  <span className="size-[5px] rounded-full bg-[#E4DDCF]" />
                  <span className="size-[5px] rounded-full bg-[#E4DDCF]" />
                  <span className="size-[5px] rounded-full bg-[#E4DDCF]" />
                </div>
                <div className="flex flex-col gap-1 px-3 pt-[7px] pb-2">
                  <span className="truncate text-[12px] font-semibold">{s.key.mockTitle}</span>
                  {s.key.rows.map((r) => (
                    <div key={r.k} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-[#6B655A]">{r.k}</span>
                      <span
                        className={cn(
                          "shrink-0 whitespace-nowrap",
                          r.tone === "bad"
                            ? "rounded-full border border-dashed border-[#C2306F] px-[7px] py-px font-semibold text-[#C2306F]"
                            : r.tone === "good"
                              ? "font-semibold text-dw-win"
                              : r.tone === "live"
                                ? "font-semibold text-[#C2306F]"
                                : "font-medium text-dw-ink",
                        )}
                      >
                        {r.v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {link && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 text-[13px] text-[#8A6275]">
              Darwin linked this to
              <Link
                href={link.href}
                className="inline-flex h-7 max-w-full items-center gap-1.5 truncate rounded-full bg-white px-2.5 text-[12.5px] font-medium text-dw-ink shadow-[0_0_0_1px_rgba(20,20,19,0.06)] transition-transform hover:-translate-y-px"
              >
                <span className="size-[7px] shrink-0 rounded-full bg-dw-ink" />
                <span className="truncate">{link.label}</span>
              </Link>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2.5 rounded-[22px] bg-white px-[18px] py-4">
            <div className="flex items-center gap-2.5">
              <Mascot kind="leader" size={34} frame active />
              <span className="text-[14px] font-semibold">Darwin</span>
            </div>
            <p className="text-[14px] leading-normal">{note}</p>
          </div>
          <dl className="grid flex-1 grid-cols-2 content-start gap-x-3 gap-y-3.5 rounded-[22px] bg-white/[0.62] px-[18px] py-4">
            {facts.map((x) => (
              <div key={x.k} className="flex min-w-0 flex-col gap-[3px]">
                <dt className="text-[12px] text-[#8A6275]">{x.k}</dt>
                <dd className="truncate text-[15px] font-semibold">{x.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </>
  );
}

function StepIcon({ tone }: { tone: "ok" | "warn" | "fail" | "live" }) {
  if (tone === "live") return <span className="dw-live-dot mx-auto block size-2.5 rounded-full bg-dw-hot" aria-label="happening now" />;
  if (tone === "fail")
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="failed">
        <circle cx="8" cy="8" r="6.2" fill="none" stroke="#141413" strokeWidth="1.6" />
        <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="#141413" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  if (tone === "warn")
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="missing data">
        <circle cx="8" cy="8" r="7" fill="#E08A2E" />
        <path d="M8 4.4v4.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="1" fill="#fff" />
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-label="done">
      <circle cx="8" cy="8" r="7" fill="#141413" />
      <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
