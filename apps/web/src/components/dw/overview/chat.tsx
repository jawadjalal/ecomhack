"use client";

/**
 * "Ask Darwin about your shoppers": a bottom-centred prompt bar that becomes a chat sheet. Drag the grip
 * to snap between the bar, a middle and a tall sheet; clicking the grip cycles them. Desktop snaps at
 * 100 / 340 / 620px; phones at 88px / 50% / 88% of the visible viewport, above the on-screen keyboard
 * and the safe area. Answers come from POST /api/ask (LLM when configured, else a heuristic) with inline
 * result cards.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUp, ChevronDown, Maximize2 } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "../mascot";
import { Typing } from "../ui";
import { EASE } from "./fx";

type Mode = "bar" | "mid" | "full";
const MODES: Mode[] = ["bar", "mid", "full"];

/* ------------------------------------------------------------------ visible viewport */

interface Viewport {
  w: number;
  /** Height of the visible viewport (shrinks when the on-screen keyboard opens). */
  h: number;
  /** How far the keyboard pushes up from the layout viewport's bottom. */
  kb: number;
}
const SERVER_VIEWPORT = "1600|1000|0";
let vpCache = SERVER_VIEWPORT;
function readViewport(): string {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height ?? window.innerHeight);
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  const next = `${window.innerWidth}|${h}|${kb}`;
  if (next !== vpCache) vpCache = next;
  return vpCache;
}
function subscribeViewport(cb: () => void) {
  const vv = window.visualViewport;
  window.addEventListener("resize", cb);
  vv?.addEventListener("resize", cb);
  vv?.addEventListener("scroll", cb);
  return () => {
    window.removeEventListener("resize", cb);
    vv?.removeEventListener("resize", cb);
    vv?.removeEventListener("scroll", cb);
  };
}
function useViewport(): Viewport {
  const raw = useSyncExternalStore(subscribeViewport, readViewport, () => SERVER_VIEWPORT);
  const [w, h, kb] = raw.split("|").map(Number);
  return { w, h, kb };
}

/** Snap heights for this viewport. */
/** Phones keep a bottom tab bar (another area's) under the dock: 64px + the safe area. */
export const TAB_BAR = 64;

function snapHeights({ w, h, kb }: Viewport): Record<Mode, number> {
  // With the keyboard up the tab bar is hidden behind it; otherwise it takes the bottom 64px.
  if (w < 640) h = h - (kb ? 0 : TAB_BAR);
  if (w < 640) return { bar: 76, mid: Math.round(h * 0.5), full: Math.round(h * 0.88) };
  const cap = Math.max(260, h - 88);
  return { bar: 100, mid: Math.min(340, cap), full: Math.min(620, cap) };
}

interface AskCard {
  label: string;
  value: string;
}
interface Msg {
  id: number;
  role: "user" | "darwin";
  text: string;
  cards?: AskCard[];
  source?: "llm" | "heuristic";
  pending?: boolean;
  failed?: boolean;
}

export interface Suggestion {
  text: string;
  kind: MascotKind;
  tone: string;
}

export function DarwinChat({ suggestions }: { suggestions: Suggestion[] }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>("bar");
  const [dragH, setDragH] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const busy = msgs.some((m) => m.pending);

  const vp = useViewport();
  const phone = vp.w < 640;
  const snaps = snapHeights(vp);
  const maxH = Math.max(snaps.full, vp.h - 12);
  const inSheet = mode !== "bar" || dragH !== null;
  const h = Math.min(dragH ?? snaps[mode], vp.h - 8);

  // Newest message in view.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [msgs, reduce]);

  const open = useCallback((m: Mode) => {
    setMode(m);
    setDragH(null);
    if (m !== "bar") requestAnimationFrame(() => sheetInput.current?.focus({ preventScroll: true }));
    else requestAnimationFrame(() => barInput.current?.focus({ preventScroll: true }));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      const history = msgs.filter((m) => !m.pending && !m.failed).map((m) => ({ role: m.role, text: m.text }));
      const userId = nextId.current++;
      const replyId = nextId.current++;
      setMsgs((m) => [...m, { id: userId, role: "user", text: question }, { id: replyId, role: "darwin", text: "", pending: true }]);
      try {
        const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, history }) });
        const body = (await res.json()) as { answer?: string; cards?: AskCard[]; source?: Msg["source"]; error?: string };
        if (!res.ok || !body.answer) throw new Error(body.error ?? "No answer");
        setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, text: body.answer ?? "", cards: body.cards, source: body.source, pending: false } : x)));
      } catch (e) {
        setMsgs((m) =>
          m.map((x) =>
            x.id === replyId
              ? { ...x, text: `I couldn’t answer that just now (${(e as Error).message}). Try again in a moment.`, pending: false, failed: true }
              : x,
          ),
        );
      }
    },
    [busy, msgs],
  );

  const submitBar = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return open("mid");
    void send(q);
    setQ("");
    open("full");
  };
  const submitSheet = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    void send(draft);
    setDraft("");
    if (mode === "bar") open("full");
  };

  /* grip: drag to resize, click (or Enter/Space) to cycle, arrows to step */
  const gripDown = (e: PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    drag.current = { y: e.clientY, h: inSheet ? h : snaps.bar, moved: false };
  };
  const gripMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setDragH(Math.min(maxH, Math.max(80, d.h + dy)));
  };
  const gripUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    suppressClick.current = d.moved;
    if (!d.moved) return;
    // Snap to the nearest height.
    const hh = dragH ?? d.h;
    open(MODES.reduce((best, m) => (Math.abs(snaps[m] - hh) < Math.abs(snaps[best] - hh) ? m : best), "bar" as Mode));
  };
  const gripClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    open(mode === "bar" ? "mid" : mode === "mid" ? "full" : "bar");
  };
  const gripKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      open(mode === "bar" ? "mid" : "full");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      open(mode === "full" ? "mid" : "bar");
    }
  };
  const grip = { onPointerDown: gripDown, onPointerMove: gripMove, onPointerUp: gripUp, onPointerCancel: gripUp, onClick: gripClick, onKeyDown: gripKey };

  const lastDarwin = [...msgs].reverse().find((m) => m.role === "darwin");

  return (
    <>
      {/* Phones: a full-width ink dock pinned above the bottom tab bar (or the keyboard). */}
      <div
        className="pointer-events-none fixed inset-x-0 z-40 mx-auto w-full max-w-[1600px] px-3 max-sm:px-0 sm:px-7"
        style={{ bottom: vp.kb ? vp.kb : phone ? `calc(${TAB_BAR}px + env(safe-area-inset-bottom))` : 0 }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {!inSheet ? (
            <motion.div
              key="bar"
              className="pointer-events-auto mx-auto flex w-full max-w-[760px] flex-col items-center gap-1.5 max-sm:max-w-none max-sm:gap-0 max-sm:rounded-t-[22px] max-sm:bg-dw-ink max-sm:px-3 max-sm:pt-1 max-sm:pb-2 sm:mb-[22px]"
              initial={reduce ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12, transition: { duration: 0.12 } }}
              transition={{ duration: 0.45, ease: EASE, delay: 0.1 }}
            >
              <button
                type="button"
                aria-label="Open Darwin chat. Drag up to resize."
                className="flex h-3.5 w-20 cursor-grab touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-dw-ink active:cursor-grabbing max-sm:h-3"
                {...grip}
              >
                <span className="h-[5px] w-11 rounded-full bg-[#CFC7B6] max-sm:h-1 max-sm:bg-white/25" />
              </button>
              <form
                onSubmit={submitBar}
                className="flex h-[60px] w-full items-center gap-3 rounded-full bg-white pr-2 pl-3 shadow-[0_0_0_1px_#E8DFCC,0_16px_40px_rgba(20,20,19,0.10)] transition-shadow focus-within:shadow-[0_0_0_1.5px_#141413,0_16px_40px_rgba(20,20,19,0.14)] max-sm:h-12 max-sm:bg-transparent max-sm:pr-0 max-sm:pl-0 max-sm:shadow-none max-sm:focus-within:shadow-none"
              >
                <Mascot kind="leader" size={phone ? 36 : 40} frame active title="Darwin" />
                <label htmlFor="dw-ask-bar" className="sr-only">
                  Ask Darwin
                </label>
                <input
                  ref={barInput}
                  id="dw-ask-bar"
                  type="text"
                  autoComplete="off"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Ask Darwin about your shoppers"
                  className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-dw-ink outline-none placeholder:text-[#8A8478] max-sm:text-dw-bg max-sm:placeholder:text-dw-bg/55"
                />
                {lastDarwin && (
                  <button
                    type="button"
                    onClick={() => open("full")}
                    className="hidden h-9 shrink-0 items-center rounded-full bg-dw-sand px-3.5 text-[13px] font-medium transition-colors hover:bg-[#e4dccb] sm:flex"
                  >
                    Show chat
                  </button>
                )}
                <button
                  type="submit"
                  aria-label="Send"
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-transform hover:scale-105 active:scale-95 max-sm:size-10 max-sm:bg-dw-bg max-sm:text-dw-ink"
                >
                  <ArrowUp className="size-[18px]" />
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.section
              key="sheet"
              aria-label="Darwin chat"
              onKeyDown={(e) => {
                if (e.key === "Escape") open("bar");
              }}
              className="pointer-events-auto flex flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_0_0_1px_#EDE4D2,0_-24px_60px_rgba(20,20,19,0.10)] max-sm:rounded-t-[22px] max-sm:bg-dw-ink max-sm:text-dw-bg max-sm:shadow-none sm:rounded-t-[28px]"
              style={{ height: Math.max(80, h), transition: dragH !== null || reduce ? "none" : "height 0.35s cubic-bezier(0.2,0.8,0.2,1)" }}
              initial={reduce ? false : { y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0, transition: { duration: 0.18 } }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              <button
                type="button"
                aria-label="Resize Darwin chat: drag, or click to change size"
                className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center outline-none focus-visible:bg-dw-sand active:cursor-grabbing"
                {...grip}
              >
                <span className="h-[5px] w-12 rounded-full bg-[#DDD5C4] max-sm:h-1 max-sm:bg-white/25" />
              </button>
              <div className="flex h-[50px] shrink-0 items-center justify-between pr-3 pl-4 sm:pr-5 sm:pl-7">
                <div className="flex items-center gap-3">
                  <Mascot kind="leader" size={38} frame active={busy} title="Darwin" />
                  <span className="text-[18px] font-semibold">Darwin</span>
                  {lastDarwin?.source && !lastDarwin.pending && (
                    <span className="hidden rounded-full bg-dw-sand px-2 py-0.5 text-[11.5px] text-dw-ink/60 sm:inline">
                      {lastDarwin.source === "llm" ? "AI answer" : "Answered from your numbers"}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-label="Expand"
                    onClick={() => open("full")}
                    className="grid size-9 place-items-center rounded-full bg-[#F3EDE0] transition-colors hover:bg-dw-sand max-sm:bg-white/10 max-sm:text-dw-bg"
                  >
                    <Maximize2 className="size-[15px]" />
                  </button>
                  <button
                    type="button"
                    aria-label="Collapse to the prompt bar"
                    onClick={() => open("bar")}
                    className="grid size-9 place-items-center rounded-full bg-[#F3EDE0] transition-colors hover:bg-dw-sand max-sm:bg-white/10 max-sm:text-dw-bg"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                </div>
              </div>

              <div ref={scroller} className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 pt-3.5 pb-3 sm:px-7">
                <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4" aria-live="polite">
                  {msgs.length === 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.2fr_1fr]">
                      {suggestions.map((s, i) => (
                        <motion.button
                          key={s.text}
                          type="button"
                          onClick={() => {
                            void send(s.text);
                            open("full");
                          }}
                          initial={reduce ? false : { opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, ease: EASE, delay: 0.08 * i }}
                          className="group flex min-h-[60px] items-center gap-3 rounded-[20px] px-[18px] py-3 text-left text-[15px] font-medium text-dw-ink active:scale-[0.98] sm:min-h-[92px] sm:flex-col sm:items-start sm:justify-between sm:py-4 sm:text-[16px] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
                          style={{ background: s.tone }}
                        >
                          <span className="transition-transform duration-300 group-hover:-rotate-6">
                            <Mascot kind={s.kind} size={26} active={false} />
                          </span>
                          {s.text}
                        </motion.button>
                      ))}
                    </div>
                  ) : (
                    msgs.map((m) => <Message key={m.id} m={m} />)
                  )}
                </div>
              </div>

              <form onSubmit={submitSheet} className="flex shrink-0 justify-center px-3 pt-2.5 pb-3 sm:px-7 sm:pb-5">
                <div className="flex h-[54px] w-full max-w-[980px] items-center gap-3 rounded-full bg-[#F3EDE0] pr-[7px] pl-[18px] transition-shadow focus-within:shadow-[0_0_0_1.5px_#141413] max-sm:h-12 max-sm:bg-white/10 max-sm:focus-within:shadow-[0_0_0_1.5px_#F7F1E5]">
                  <label htmlFor="dw-ask-sheet" className="sr-only">
                    Ask Darwin
                  </label>
                  <input
                    ref={sheetInput}
                    id="dw-ask-sheet"
                    type="text"
                    autoComplete="off"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={msgs.length ? "Ask a follow-up" : "Ask Darwin about your shoppers"}
                    className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-dw-ink outline-none placeholder:text-[#8A8478] max-sm:text-dw-bg max-sm:placeholder:text-dw-bg/55"
                  />
                  <button
                    type="submit"
                    aria-label="Send"
                    disabled={busy}
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-[transform,opacity] hover:scale-105 active:scale-95 disabled:opacity-40 max-sm:size-9 max-sm:bg-dw-bg max-sm:text-dw-ink"
                  >
                    <ArrowUp className="size-[17px]" />
                  </button>
                </div>
              </form>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function Message({ m }: { m: Msg }) {
  const reduce = useReducedMotion();
  if (m.role === "user") {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="max-w-[80%] self-end rounded-[20px_20px_6px_20px] bg-dw-ink px-[18px] py-[11px] text-[16px] leading-snug text-white max-sm:bg-dw-bg max-sm:text-dw-ink sm:max-w-[60%]"
      >
        {m.text}
      </motion.div>
    );
  }
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="flex gap-3"
    >
      <span className="hidden shrink-0 pt-0.5 sm:block">
        <Mascot kind="leader" size={34} frame active={!!m.pending} title="Darwin" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {m.pending ? (
          <div className="flex h-8 items-center max-sm:[&_span]:bg-dw-bg">
            <Typing />
          </div>
        ) : (
          <p className={cn("text-[16px] leading-[1.55] sm:text-[17px]", m.failed && "text-dw-warn")}>{m.text}</p>
        )}
        {!!m.cards?.length && <ResultCards cards={m.cards} />}
      </div>
    </motion.div>
  );
}

const TONES = ["#F6D76B", "#B8CAEE", "#A9B46E"];

function num(v: string): number | undefined {
  const m = /-?\d+(\.\d+)?/.exec(v.replace(/,/g, ""));
  return m ? Number(m[0]) : undefined;
}

function ResultCards({ cards }: { cards: AskCard[] }) {
  const reduce = useReducedMotion();
  const a = cards.find((c) => c.label === "A");
  const b = cards.find((c) => c.label === "B");
  const chance = cards.find((c) => /chance/i.test(c.label));
  const issue = cards.some((c) => /^Issue \d+/.test(c.label));
  if (a && b) {
    const av = num(a.value) ?? 0;
    const bv = num(b.value) ?? 0;
    const max = Math.max(av, bv, 1e-9);
    return (
      <div className="grid grid-cols-1 gap-3 text-dw-ink sm:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-3 rounded-[20px] bg-dw-pink px-5 py-[18px]">
          <span className="text-[15px] font-semibold">Who buys, A vs B</span>
          {[
            { label: "A", v: a.value, w: av / max, cls: "bg-dw-ink/35" },
            { label: "B", v: b.value, w: bv / max, cls: "bg-dw-ink" },
          ].map((x, i) => (
            <div key={x.label} className="grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 text-[14px]">
              <span>{x.label}</span>
              <div className="h-2.5 rounded-full bg-dw-ink/[0.12]">
                <motion.div
                  className={cn("h-2.5 rounded-full", x.cls)}
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${Math.max(3, x.w * 100)}%` }}
                  transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.1 }}
                />
              </div>
              <span className="num text-right font-semibold">{x.v}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2.5 rounded-[20px] bg-[#F3EDE0] px-5 py-[18px]">
          <div className="flex items-center gap-2.5">
            <Mascot kind="experimenter" size={26} active />
            <span className="text-[15px] font-semibold">{chance ? `${chance.value} chance B wins` : "The test"}</span>
          </div>
          <span className="text-[14px] leading-snug text-[#4A463D]">Darwin ships B on its own once it’s sure.</span>
          <Link
            href="/console/experiments"
            className="mt-auto inline-flex h-10 items-center self-start rounded-full bg-dw-ink px-[18px] text-[14px] font-medium text-white transition-colors hover:bg-black"
          >
            See the test
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-dw-ink">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.slice(0, 3).map((c, i) => (
          <motion.div
            key={c.label}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.08 * i }}
            className="flex min-w-0 flex-col gap-1 rounded-[20px] px-[18px] py-4"
            style={{ background: TONES[i % TONES.length] }}
          >
            <span className="truncate text-[13px] text-dw-ink/70">{c.label}</span>
            <span className="num truncate text-[24px] leading-tight font-semibold tracking-[-0.02em]">{c.value}</span>
          </motion.div>
        ))}
      </div>
      {issue && (
        <Link
          href="/console/issues"
          className="inline-flex h-10 items-center self-start rounded-full bg-dw-ink px-[18px] text-[14px] font-medium text-white transition-colors hover:bg-black max-sm:bg-dw-bg max-sm:text-dw-ink"
        >
          See issues
        </Link>
      )}
    </div>
  );
}
