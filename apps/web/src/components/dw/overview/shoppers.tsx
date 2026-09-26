"use client";

/**
 * Live shoppers joined to the Journey, as one framed piece. Desktop: the list sits on the left of a cream
 * frame and the selected shopper's journey fills a blue panel on the right; the selected row carries a blue
 * tab that flows into the panel (concave fillets where they meet) and springs to the next row when you pick
 * or hover another shopper. Below desktop the list is compact and a tap opens the journey as a full sheet.
 * Empty: a Wayari painting and one action, "Send 50 simulated shoppers".
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import type { AnalyticsSummary, LoopState } from "@/lib/contracts";
import { timeAgo } from "@/lib/console/format";
import { useNow } from "@/lib/console/hooks";
import { cn } from "@/components/ui/cn";
import { Art } from "../art";
import { useDarwin } from "../provider";
import { Silhouette } from "../mascot";
import { ArmChip, PillButton } from "../ui";
import { EASE } from "./fx";
import { DEPTH, JourneyView, STAGES, ShopperAvatar, rowLine } from "./journey";
import type { BoardRow, Shopper, TestView } from "./model";
import { MoneyFeed } from "./money-feed";
import { StorePage } from "./store-view";

type Filter = "all" | "people" | "agents";
const ROWS = 6;
/** Gap between the list and the journey panel; the selected row's tab spans it. */
const GAP = 14;
/** Radius of the concave fillets where the tab meets the panel. */
const R = 18;
const BLUE = "#B8CAEE";
const SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 0.8 } as const;

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
/** Side-by-side list + panel (lg and up); below that a tap opens the journey sheet. */
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

/**
 * A calm, sticky list: new shoppers arrive at most every few seconds instead of on every poll, and an empty
 * poll (on Vercel it can land on a server instance that hasn't seen these shoppers) keeps the last list.
 */
function useCalmList<T>(list: T[], everyMs = 6000): T[] {
  const [shown, setShown] = useState(list);
  const lastAt = useRef(0);
  useEffect(() => {
    if (!list.length) return;
    const wait = Math.max(0, lastAt.current + everyMs - Date.now());
    const t = setTimeout(() => {
      lastAt.current = Date.now();
      setShown(list);
    }, wait);
    return () => clearTimeout(t);
  }, [list, everyMs]);
  return shown.length ? shown : list;
}

export function LiveShoppers({
  agents: agentsNow,
  people: peopleNow,
  loop,
  test,
  board,
  summary,
}: {
  agents: Shopper[];
  people: Shopper[];
  loop?: LoopState;
  test?: TestView;
  board: BoardRow[];
  summary?: AnalyticsSummary;
  /** Kept for callers; the empty state sends a one-off batch of simulated shoppers itself. */
  onSendShoppers?: () => void;
}) {
  const agents = useCalmList(agentsNow);
  const people = useCalmList(peopleNow);
  const now = useNow();
  const { api, notify } = useDarwin();
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string>();
  /** While the pointer is over the list, keep its order still (rows update in place). */
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);

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
  const [sheetOpen, setSheetOpen] = useState(false);

  // Hover intent: resting on a row for a moment follows that shopper (moving across rows doesn't).
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hoverRow = useCallback(
    (id: string | undefined) => {
      clearTimeout(hoverTimer.current);
      if (!id || !wide) return;
      hoverTimer.current = setTimeout(() => setPicked(id), 260);
    },
    [wide],
  );

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      await api.simulate({ humans: 40, agents: 10, spreadMinutes: 2 });
      notify("Sent 50 simulated shoppers to the demo store.", "info");
    } catch (e) {
      notify(`Couldn’t send shoppers: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const status = liveCount ? `${liveCount} on the store` : lastMinute ? `${lastMinute} in the last minute` : "Quiet right now";
  const total = filter === "agents" ? agents.length : filter === "people" ? people.length : everyone.length;

  const head = (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex min-w-0 flex-col">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Live shoppers</h2>
        <span className="flex min-w-0 items-center gap-[7px] text-[12.5px] whitespace-nowrap text-dw-muted">
          <span className={cn("size-[7px] shrink-0 rounded-full", liveCount || lastMinute ? "dw-live-dot bg-dw-live" : "bg-dw-ink/25")} />
          <span className="truncate">
            {status}
            {simulated && <span className="font-medium text-dw-ink/70"> · simulated</span>}
          </span>
        </span>
      </div>
      <FilterTabs
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setFrozen(null);
          setPicked(undefined);
        }}
      />
    </div>
  );

  if (everyone.length === 0) {
    return (
      <section aria-label="Live shoppers" className={cn("relative overflow-hidden rounded-[28px] bg-dw-surface", DEPTH)}>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="flex flex-col justify-center gap-4 p-6 sm:p-7">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Quiet right now</h2>
              <p className="max-w-[26rem] text-[15px] leading-normal text-dw-muted">
                No one is on the demo store. Send some simulated people and AI shoppers, then pick one to follow their path, step by step.
              </p>
            </div>
            <PillButton onClick={send} disabled={sending} className="self-start">
              {sending ? "Sending…" : "Send 50 simulated shoppers"}
            </PillButton>
          </div>
          <div className="relative min-h-[200px] md:min-h-[260px]">
            <Art id="forest-path" position="50% 60%" sizes="(min-width: 768px) 60vw, 100vw" className="m-2 rounded-[20px]" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Live shoppers" className={cn("relative rounded-[28px] bg-dw-surface p-2", DEPTH)}>
      <div className={cn("grid grid-cols-1", wide && "grid-cols-[minmax(0,0.92fr)_minmax(0,1.5fr)]")} style={wide ? { columnGap: GAP } : undefined}>
        {/* the list */}
        <div className="flex min-w-0 flex-col gap-3 px-3 pt-3 pb-2 sm:px-4 lg:pr-0">
          <div className="lg:pr-3">{head}</div>
          {rows.length === 0 ? (
            <p className="rounded-[20px] border border-dw-hairline px-4 py-8 text-center text-[15px] text-dw-muted">
              {filter === "people" ? "No people on the store yet." : "No AI shoppers yet."}
            </p>
          ) : (
            <LayoutGroup id="dw-shoppers">
              <div
                aria-label="Shoppers"
                role="group"
                className={cn("flex flex-col", wide ? "gap-1.5" : "divide-y divide-dw-hairline")}
                onPointerEnter={() => setFrozen(rows.map((s) => s.id))}
                onPointerLeave={() => {
                  setFrozen(null);
                  hoverRow(undefined);
                }}
              >
                {rows.map((s) => (
                  <ShopperRow
                    key={s.id}
                    s={s}
                    on={wide && s.id === sel?.id}
                    now={now}
                    compact={!wide}
                    onHover={hoverRow}
                    onPick={() => {
                      clearTimeout(hoverTimer.current);
                      setPicked(s.id);
                      if (!wide) setSheetOpen(true);
                    }}
                  />
                ))}
              </div>
            </LayoutGroup>
          )}
          <span className="px-1 pt-1 text-[12.5px] text-dw-muted tabular-nums lg:pr-3">
            {rows.length ? `Newest ${rows.length} of ${total}` : " "}
            {simulated && rows.length ? " · simulated traffic" : ""}
          </span>
          <MoneyFeed agents={agents} className="mt-2 px-1 lg:pr-3" />
        </div>

        {/* the journey, joined to the selected row */}
        {wide && (
          <div
            id="dw-journey"
            role="region"
            aria-label={sel ? `Journey of ${sel.name}` : "Journey"}
            className="relative flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-[22px] bg-dw-blue p-6"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {sel && (
                <motion.div
                  key={sel.id}
                  className="relative flex flex-1 flex-col gap-5"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.24, ease: EASE }}
                >
                  <JourneyView s={sel} now={now} loop={loop} test={test} board={board} summary={summary} aside={<StorePage s={sel} test={test} />} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <JourneySheet open={!wide && sheetOpen && !!sel} onClose={() => setSheetOpen(false)} s={sel}>
        {sel && (
          <>
            <JourneyView s={sel} now={now} loop={loop} test={test} board={board} summary={summary} aside={<StorePage s={sel} test={test} />} stacked />
          </>
        )}
      </JourneySheet>
    </section>
  );
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "people", label: "People" },
  { value: "agents", label: "Agents" },
];

/** A plain underlined text toggle (no pills). */
function FilterTabs({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }) {
  const reduce = useReducedMotion();
  return (
    <div role="group" aria-label="Show shoppers" className="flex items-center gap-4">
      {FILTERS.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative h-8 text-[13.5px] font-medium outline-none transition-colors focus-visible:text-dw-ink focus-visible:underline",
              on ? "text-dw-ink" : "text-dw-muted hover:text-dw-ink",
            )}
          >
            {o.label}
            {on && (
              <motion.span
                layoutId="dw-shopper-filter"
                aria-hidden
                className="absolute inset-x-0 bottom-0.5 h-[2px] rounded-full bg-dw-ink"
                transition={reduce ? { duration: 0 } : SPRING}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Phones and tablets: the journey as a full-screen sheet that slides up (Esc or ✕ closes it; the page stops scrolling). */
function JourneySheet({ open, onClose, s, children }: { open: boolean; onClose: () => void; s?: Shopper; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    close.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      root.style.overflow = prev;
      window.removeEventListener("keydown", esc);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && s && (
        <motion.div
          key="journey-sheet"
          id="dw-journey"
          role="dialog"
          aria-modal="true"
          aria-label={`Journey of ${s.name}`}
          className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-dw-blue"
          initial={reduce ? false : { y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%", transition: { duration: 0.22, ease: EASE } }}
          transition={{ duration: 0.38, ease: EASE }}
        >
          <Silhouette kind="observer" color="#A8BCE7" size={260} style={{ right: -90, bottom: -80 }} />
          <div className="relative flex h-14 shrink-0 items-center gap-3 px-3 pt-[env(safe-area-inset-top)]">
            <button
              ref={close}
              type="button"
              onClick={onClose}
              aria-label="Close journey"
              className={cn("grid size-10 place-items-center rounded-full bg-dw-surface text-dw-ink transition-transform active:scale-90", DEPTH)}
            >
              <X className="size-[18px]" />
            </button>
            <span className="text-[17px] font-semibold">Journey</span>
            {s.synthetic && <span className="ml-auto text-[12.5px] text-[#3E4E70]">simulated</span>}
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(24px,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Concave corner where the tab meets the panel: blue outside a quarter circle. */
function Fillet({ at }: { at: "top" | "bottom" }) {
  return (
    <svg
      aria-hidden
      width={R}
      height={R}
      viewBox={`0 0 ${R} ${R}`}
      className="pointer-events-none absolute right-0"
      style={at === "top" ? { top: -R + 0.5 } : { bottom: -R + 0.5 }}
    >
      <path d={at === "top" ? `M${R} 0V${R}H0A${R} ${R} 0 0 0 ${R} 0Z` : `M0 0H${R}V${R}A${R} ${R} 0 0 0 0 0Z`} fill={BLUE} />
    </svg>
  );
}

/** Five tiny dots: the row's path in miniature, the same steps the journey draws. */
function MiniPath({ s }: { s: Shopper }) {
  const won = s.status === "bought";
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
      {STAGES.map((label, i) => {
        const done = i < s.reach || (i === s.reach && won);
        const here = i === s.reach && !won;
        return (
          <span
            key={label}
            className={cn(
              "size-[7px] rounded-full",
              done ? (i === 4 ? "bg-dw-olive-shape" : "bg-dw-ink") : here ? (s.status === "live" ? "dw-live-dot bg-dw-live" : "bg-dw-hot") : "bg-dw-ink/15",
            )}
          />
        );
      })}
    </span>
  );
}

function ShopperRow({
  s,
  on,
  now,
  compact,
  onHover,
  onPick,
}: {
  s: Shopper;
  on: boolean;
  now: number;
  compact?: boolean;
  onHover: (id: string | undefined) => void;
  onPick: () => void;
}) {
  const reduce = useReducedMotion();
  const when = s.status === "live" ? "now" : timeAgo(s.lastAt, now);
  return (
    <motion.button
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      type="button"
      aria-pressed={compact ? undefined : on}
      aria-controls="dw-journey"
      aria-label={`${s.name}: ${rowLine(s)}${s.synthetic ? ", simulated" : ""}`}
      onClick={onPick}
      onPointerEnter={() => onHover(s.id)}
      onPointerLeave={() => onHover(undefined)}
      className={cn(
        "group relative flex shrink-0 items-center gap-3 text-left text-dw-ink outline-none focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:ring-offset-dw-surface",
        compact ? "h-[64px] px-1 active:bg-dw-sand/60" : "h-[66px] rounded-l-[20px] pr-5 pl-3",
      )}
    >
      {!compact && !on && (
        <span aria-hidden className="absolute inset-0 rounded-[20px] bg-dw-sand/0 transition-colors duration-200 group-hover:bg-dw-sand/70" />
      )}
      {on && (
        <motion.span
          layoutId="dw-shopper-tab"
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-l-[20px] bg-dw-blue"
          style={{ right: -GAP }}
          transition={reduce ? { duration: 0 } : SPRING}
        >
          <Fillet at="top" />
          <Fillet at="bottom" />
        </motion.span>
      )}
      <span className="relative flex shrink-0">
        <ShopperAvatar s={s} size={compact ? 38 : 40} />
      </span>
      <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">{s.name}</span>
          <span className={cn("flex shrink-0 items-center font-dwmono text-[12px] whitespace-nowrap tabular-nums", on ? "text-[#3E4E70]" : "text-dw-muted")}>
            {s.status === "live" && <span className="dw-live-dot mr-1.5 inline-block size-1.5 rounded-full bg-dw-live" />}
            {when}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {s.arm && <ArmChip arm={s.arm} />}
          <span className={cn("truncate text-[13px]", on ? "text-dw-ink/80" : "text-dw-muted")}>{rowLine(s)}</span>
          <span className="ml-auto pl-1">
            <MiniPath s={s} />
          </span>
        </span>
      </span>
      {compact && <ChevronRight aria-hidden className="relative size-4 shrink-0 text-dw-ink/35" />}
    </motion.button>
  );
}
