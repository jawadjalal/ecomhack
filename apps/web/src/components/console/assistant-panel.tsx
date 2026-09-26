"use client";

/**
 * "Ask Darwin": the merchant's managing assistant on every console page (design handoff: prompt bar /
 * chat sheet, screens/2-overview-chat.png). A bottom-centred prompt bar; drag its grip up (or click it)
 * to snap the chat sheet between bar, quarter and half height.
 *
 * Talks to POST /api/assistant, shows what Darwin did as inline result cards, asks before side-effecting
 * tools (Confirm / Cancel), and refreshes the console's live data (SWR) after anything ran.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSWRConfig } from "swr";
import { usePathname } from "next/navigation";
import { ArrowUp, ChevronDown, Maximize2, RotateCcw } from "lucide-react";
import type { AssistantAction, AssistantMessage, AssistantPendingConfirm, AssistantResponse } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { Mascot, MASCOT_CSS, type MascotKind } from "./mascot";

/* ------------------------------------------------------------------ design tokens (HANDOFF.md) */

const INK = "#141413";
const FONT: CSSProperties = { fontFamily: "var(--font-outfit), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" };
const MONO: CSSProperties = { fontFamily: "var(--font-dm-mono), var(--font-geist-mono), ui-monospace, monospace" };

type Mode = "bar" | "quarter" | "half";

interface ChatItem {
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAction[];
  pendingConfirm?: AssistantPendingConfirm;
  /** What the merchant did with the pending confirmation. */
  resolved?: "confirmed" | "cancelled";
  model?: string;
  error?: boolean;
}

/** How each tool's result card looks. Unknown tools (new ones added to the registry) get the sand default. */
const TOOL_STYLE: Record<string, { label: string; bg: string; mascot: MascotKind }> = {
  get_kpis: { label: "Store numbers", bg: "#F6D76B", mascot: "observer" },
  loop_status: { label: "Loop status", bg: "#B8CAEE", mascot: "leader" },
  step_loop: { label: "Loop stepped", bg: "#B8CAEE", mascot: "leader" },
  set_autopilot: { label: "Autopilot", bg: "#B8CAEE", mascot: "experimenter" },
  reset_loop: { label: "Reset to Gen 0", bg: "#EDE6D6", mascot: "experimenter" },
  list_experiments: { label: "Experiments", bg: "#F3B5D5", mascot: "experimenter" },
  ship_winner: { label: "Ship pull request", bg: "#DDF3E8", mascot: "shipper" },
  list_dashboards: { label: "Dashboards", bg: "#F6D76B", mascot: "observer" },
  add_chart: { label: "New chart", bg: "#F6D76B", mascot: "designer" },
  suggest_web_rules: { label: "Personalization ideas", bg: "#D5CCF5", mascot: "designer" },
  run_simulation: { label: "Simulated traffic", bg: "#D5CCF5", mascot: "experimenter" },
  audit_readiness: { label: "Agent readiness", bg: "#A9B46E", mascot: "observer" },
  certify_store: { label: "Certificate", bg: "#A9B46E", mascot: "shipper" },
  send_test_shopper: { label: "Test shopper", bg: "#D5CCF5", mascot: "experimenter" },
  agent_funnel: { label: "Agent funnel", bg: "#F3B5D5", mascot: "observer" },
};
const styleFor = (tool: string) => TOOL_STYLE[tool] ?? { label: tool.replace(/_/g, " "), bg: "#F3EDE0", mascot: "leader" as MascotKind };

const STARTERS: { text: string; bg: string; mascot: MascotKind }[] = [
  { text: "How are we doing?", bg: "#F3B5D5", mascot: "experimenter" },
  { text: "Run the loop", bg: "#F6D76B", mascot: "designer" },
  { text: "Send a test shopper", bg: "#B8CAEE", mascot: "observer" },
];

const STORAGE_KEY = "darwin.assistant.thread";
const BAR_H = 100;

function heightFor(mode: Mode): number {
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;
  if (mode === "half") return Math.min(620, vh - 16);
  if (mode === "quarter") return Math.min(340, vh - 16);
  return BAR_H;
}

function loadThread(): ChatItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ChatItem[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

function saveThread(items: ChatItem[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-40)));
  } catch {
    /* storage blocked: the thread lives for this page only */
  }
}

/** Where the merchant is asking from: the console path and the darwin.js site (?site=) it shows. */
function pageContext(): { path?: string; site?: string } {
  if (typeof window === "undefined") return {};
  const site = new URLSearchParams(window.location.search).get("site") ?? undefined;
  return { path: window.location.pathname.slice(0, 200), site: site && /^[\w.-]{1,64}$/.test(site) ? site : undefined };
}

const toHistory = (items: ChatItem[]): AssistantMessage[] =>
  items.filter((m) => !m.error && m.content.trim()).map((m) => ({ role: m.role, content: m.content }));

/* ------------------------------------------------------------------ panel */

export function AssistantPanel() {
  const [mode, setMode] = useState<Mode>("bar");
  const [dragH, setDragH] = useState<number | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const { mutate } = useSWRConfig();
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const hydrated = useRef(false);

  const inSheet = mode !== "bar" || dragH !== null;
  const height = dragH ?? heightFor(mode);

  /* thread survives page navigation within the console (per tab) */
  useEffect(() => {
    const t = setTimeout(() => {
      const saved = loadThread();
      if (saved.length) {
        setItems(saved);
        setModel(saved.findLast((m) => m.model)?.model);
      }
      hydrated.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (hydrated.current) saveThread(items);
  }, [items]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, busy, inSheet]);

  useEffect(() => {
    if (!inSheet) return;
    const t = setTimeout(() => sheetInput.current?.focus({ preventScroll: true }), 150);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("bar");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [inSheet]);

  /* grip: drag to resize, snap on release; a click cycles bar → quarter → half → bar */
  const gripDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    drag.current = { y: e.clientY, h: heightFor(mode), moved: false };
  };
  const gripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setDragH(Math.min(window.innerHeight - 8, Math.max(80, d.h + dy)));
  };
  const gripUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setMode((m) => (m === "bar" ? "quarter" : m === "quarter" ? "half" : "bar"));
      setDragH(null);
      return;
    }
    const h = dragH ?? d.h;
    setMode(h < 200 ? "bar" : h < 480 ? "quarter" : "half");
    setDragH(null);
  };

  /** After Darwin did something, refresh whatever the page shows. */
  const refresh = useCallback(
    (actions: AssistantAction[]) => {
      if (!actions.some((a) => a.ok)) return;
      void mutate(() => true);
      window.dispatchEvent(new CustomEvent("darwin:assistant-action", { detail: { tools: actions.map((a) => a.tool) } }));
    },
    [mutate],
  );

  const call = useCallback(
    async (history: ChatItem[], confirm?: { tool: string; args: Record<string, unknown>; approved: boolean }) => {
      setBusy(true);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: toHistory(history), confirm, context: pageContext() }),
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as Partial<AssistantResponse> & { error?: string };
        if (!res.ok || typeof body.reply !== "string") {
          const why = res.status === 401 ? "You're signed out. Open /console and sign in with the admin key." : (body.error ?? `Darwin didn't answer (${res.status}).`);
          setItems((all) => [...all, { role: "assistant", content: why, error: true }]);
          return;
        }
        setItems((all) => [...all, { role: "assistant", content: body.reply!, actions: body.actions ?? [], pendingConfirm: body.pendingConfirm, model: body.model }]);
        setSuggestions(body.suggestions ?? []);
        if (body.model) setModel(body.model);
        refresh(body.actions ?? []);
      } catch (e) {
        setItems((all) => [...all, { role: "assistant", content: `Couldn't reach Darwin: ${(e as Error).message}`, error: true }]);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      // A new message supersedes an unanswered confirmation.
      const next: ChatItem[] = [
        ...items.map((m) => (m.pendingConfirm && !m.resolved ? { ...m, resolved: "cancelled" as const } : m)),
        { role: "user", content: t.slice(0, 2000) },
      ];
      setItems(next);
      setDraft("");
      setMode("half");
      setDragH(null);
      void call(next);
    },
    [busy, items, call],
  );

  const answer = useCallback(
    (index: number, approved: boolean) => {
      const item = items[index];
      if (!item?.pendingConfirm || item.resolved || busy) return;
      const next: ChatItem[] = [
        ...items.map((m, i) => (i === index ? { ...m, resolved: approved ? ("confirmed" as const) : ("cancelled" as const) } : m)),
        { role: "user", content: approved ? "Yes, go ahead." : "No, cancel that." },
      ];
      setItems(next);
      void call(next, { tool: item.pendingConfirm.tool, args: item.pendingConfirm.args, approved });
    },
    [items, busy, call],
  );

  const clear = () => {
    setItems([]);
    setSuggestions([]);
  };

  // The redesigned Overview has its own "Ask Darwin" bar for now; one bar per page.
  if (pathname === "/console") return null;

  return (
    <div style={FONT} data-assistant>
      <style>{MASCOT_CSS}</style>
      {/* room under the page for the prompt bar (mission control reserves its own) */}
      {pathname !== "/console/classic" && <div aria-hidden className="h-[104px]" />}

      {/* prompt bar */}
      {!inSheet && (
        <div className="fixed bottom-4 left-1/2 z-50 flex w-[min(760px,calc(100vw-24px))] -translate-x-1/2 flex-col items-center gap-1.5 sm:bottom-[22px]">
          <button
            type="button"
            aria-label="Drag up to open Darwin"
            onPointerDown={gripDown}
            onPointerMove={gripMove}
            onPointerUp={gripUp}
            className="flex h-3.5 w-20 cursor-grab touch-none items-center justify-center"
          >
            <span className="h-[5px] w-11 rounded-full bg-[#CFC7B6]" />
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex h-[60px] w-full items-center gap-3 rounded-full bg-white pr-2 pl-3.5 shadow-[0_0_0_1px_#E8DFCC,0_16px_40px_rgba(20,20,19,0.10)]"
          >
            <Mascot kind="leader" size={30} state={busy ? "thinking" : undefined} title="Darwin" />
            <label htmlFor="dw-ask-bar" className="sr-only">
              Ask Darwin
            </label>
            <input
              id="dw-ask-bar"
              type="text"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={() => setMode("quarter")}
              placeholder="Ask Darwin about your store"
              maxLength={2000}
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#8C8676]"
              style={{ color: INK }}
            />
            <SendButton size={44} disabled={busy} />
          </form>
        </div>
      )}

      {/* chat sheet */}
      <AnimatePresence>
        {inSheet && (
          <motion.section
            key="sheet"
            aria-label="Darwin chat"
            data-assistant-panel
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 box-border flex flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_0_0_1px_#EDE4D2,0_-24px_60px_rgba(20,20,19,0.10)] sm:inset-x-7 sm:rounded-t-[28px]"
            style={{
              ...FONT,
              color: INK,
              height: Math.max(BAR_H, height),
              transition: dragH !== null ? "none" : "height 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)",
            }}
          >
            <button
              type="button"
              aria-label="Drag to resize Darwin"
              onPointerDown={gripDown}
              onPointerMove={gripMove}
              onPointerUp={gripUp}
              className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
            >
              <span className="h-[5px] w-12 rounded-full bg-[#DDD5C4]" />
            </button>

            <header className="flex h-[50px] shrink-0 items-center justify-between gap-3 pr-4 pl-5 sm:pr-5 sm:pl-7">
              <div className="flex min-w-0 items-center gap-3">
                <Mascot kind="leader" size={32} state={busy ? "thinking" : undefined} title="Darwin" />
                <span className="text-[18px] font-semibold">Darwin</span>
                {model && (
                  <span
                    title={model === "heuristic" ? "No LLM key: a keyword router over the same tools" : `Model: ${model}`}
                    className="truncate rounded-full bg-[#F3EDE0] px-2.5 py-1 text-[11px] text-[#4A463D]"
                    style={MONO}
                  >
                    {model.replace(/^llm:/, "")}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {items.length > 0 && (
                  <RoundButton label="New conversation" onClick={clear} disabled={busy}>
                    <RotateCcw className="size-[15px]" />
                  </RoundButton>
                )}
                <RoundButton label="Expand" onClick={() => (setMode("half"), setDragH(null))}>
                  <Maximize2 className="size-[15px]" />
                </RoundButton>
                <RoundButton label="Collapse to the prompt bar" onClick={() => (setMode("bar"), setDragH(null))}>
                  <ChevronDown className="size-4" />
                </RoundButton>
              </div>
            </header>

            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5 pb-3 sm:px-7">
              <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4">
                {items.length === 0 && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.2fr_1fr]">
                    {STARTERS.map((s) => (
                      <button
                        key={s.text}
                        type="button"
                        onClick={() => send(s.text)}
                        disabled={busy}
                        className="flex h-[76px] flex-col items-start justify-between rounded-[20px] px-[18px] py-3.5 text-left text-[16px] font-medium transition-transform hover:-translate-y-0.5 disabled:opacity-50 sm:h-[92px] sm:py-4 motion-reduce:transition-none"
                        style={{ background: s.bg, color: INK }}
                      >
                        <Mascot kind={s.mascot} size={26} />
                        {s.text}
                      </button>
                    ))}
                  </div>
                )}

                {items.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="max-w-[85%] self-end rounded-[20px_20px_6px_20px] px-[18px] py-[11px] text-[16px] leading-[1.4] break-words text-white sm:max-w-[60%]" style={{ background: INK }}>
                      {m.content}
                    </div>
                  ) : (
                    <div key={i} className="flex flex-col gap-3">
                      {/* the confirm card carries the question itself */}
                      {replyText(m) && <Reply text={replyText(m)} error={m.error} />}
                      {!!m.actions?.length && <ResultCards actions={m.actions} reply={m.content} />}
                      {m.pendingConfirm && <ConfirmCard pending={m.pendingConfirm} resolved={m.resolved} busy={busy} onAnswer={(ok) => answer(i, ok)} />}
                    </div>
                  ),
                )}

                {busy && (
                  <span className="flex h-7 items-center gap-1.5" aria-label="Darwin is working">
                    <Mascot kind="leader" size={26} state="working" className="mr-1" />
                    {[0, 1, 2].map((k) => (
                      <motion.span key={k} className="size-2 rounded-full" style={{ background: INK }} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: k * 0.15 }} />
                    ))}
                  </span>
                )}
              </div>
            </div>

            <div className="shrink-0 px-4 pt-2 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-7">
              <div className="mx-auto w-full max-w-[980px]">
                {suggestions.length > 0 && items.length > 0 && (
                  <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        disabled={busy}
                        className="h-8 shrink-0 rounded-full bg-[#EDE6D6] px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-[#E4DBC7] disabled:opacity-50"
                        style={{ color: INK }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(draft);
                  }}
                  className="flex h-[54px] items-center gap-3 rounded-full bg-[#F3EDE0] pr-[7px] pl-[18px]"
                >
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
                    placeholder={items.length ? "Ask a follow-up" : "Ask Darwin about your store"}
                    maxLength={2000}
                    className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#8C8676]"
                    style={{ color: INK }}
                  />
                  <SendButton size={40} disabled={busy} />
                </form>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** The reply without the confirmation question (shown on the confirm card instead). */
function replyText(m: ChatItem): string {
  const q = m.pendingConfirm?.prompt;
  return q && m.content.trim().endsWith(q) ? m.content.trim().slice(0, -q.length).trim() : m.content;
}

const flat = (s: string) => s.replace(/^- /gm, "").replace(/\s+/g, " ").trim();

function SendButton({ size, disabled }: { size: number; disabled?: boolean }) {
  return (
    <button
      type="submit"
      aria-label="Send"
      disabled={disabled}
      className="grid shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-40"
      style={{ width: size, height: size, background: INK }}
    >
      <ArrowUp className="size-[18px]" strokeWidth={2} />
    </button>
  );
}

function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center rounded-full bg-[#F3EDE0] transition-colors hover:bg-[#EAE2D0] disabled:opacity-40"
      style={{ color: INK }}
    >
      {children}
    </button>
  );
}

/** Inline markdown for replies: **bold**, [links](url), `code`. */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>);
    else if (m[2] !== undefined) {
      const href = /^(https?:\/\/|\/)/.test(m[3]) ? m[3] : undefined;
      parts.push(
        href ? (
          <a key={m.index} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="underline underline-offset-2">
            {m[2]}
          </a>
        ) : (
          m[2]
        ),
      );
    } else if (m[4] !== undefined) {
      parts.push(
        <code key={m.index} className="rounded-md bg-[#F3EDE0] px-1.5 py-0.5 text-[0.88em]" style={MONO}>
          {m[4]}
        </code>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}

/** Darwin's reply: plain paragraphs (17/1.55) and "- " bullet lists, no bubble. */
function Reply({ text, error }: { text: string; error?: boolean }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.split("\n"));
  return (
    <div className={cn("flex flex-col gap-2.5 text-[16px] leading-[1.55] sm:text-[17px]", error && "rounded-[20px] bg-[#FBE7D3] px-[18px] py-3 text-[#B8621B]")}>
      {blocks.map((lines, i) =>
        lines.every((l) => /^\s*[-•]\s+/.test(l)) ? (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-5">
            {lines.map((l, j) => (
              <li key={j}>
                <Inline text={l.replace(/^\s*[-•]\s+/, "")} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="m-0">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

function Pill({ children, tone }: { children: ReactNode; tone: "warn" | "win" | "sand" }) {
  const s = tone === "warn" ? { background: "#FBE7D3", color: "#B8621B" } : tone === "win" ? { background: "#DDF3E8", color: "#137A52" } : { background: "rgba(255,255,255,0.6)", color: INK };
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium tracking-[0.02em]" style={{ ...s, ...MONO }}>
      {children}
    </span>
  );
}

/** What Darwin did this turn, as pastel result cards (the handoff's inline result cards). */
function ResultCards({ actions, reply }: { actions: AssistantAction[]; reply: string }) {
  const said = flat(reply);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {actions.map((a, i) => {
        const s = styleFor(a.tool);
        return (
          <div key={i} className="flex min-w-0 flex-col gap-2.5 rounded-[20px] px-5 py-4" style={{ background: a.ok ? s.bg : "#FBE7D3" }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <Mascot kind={s.mascot} size={26} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{s.label}</span>
              {!a.ok && <Pill tone="warn">didn&apos;t work</Pill>}
              {a.synthetic && <Pill tone="sand">simulated</Pill>}
            </div>
            {/* the heuristic reply already says it; an LLM reply may not */}
            {!said.includes(flat(a.summary).slice(0, 60)) && (
              <p className="m-0 line-clamp-3 text-[14px] leading-[1.45] text-[#4A463D]" title={a.summary}>
                {a.summary.replace(/^- /gm, "").replace(/\n+/g, " · ")}
              </p>
            )}
            {a.link && (
              <a
                href={a.link.href}
                target={/^https?:\/\//.test(a.link.href) ? "_blank" : undefined}
                rel="noreferrer"
                className="mt-auto flex h-9 items-center self-start rounded-full px-4 text-[14px] font-medium text-white no-underline"
                style={{ background: INK }}
              >
                {a.link.label}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfirmCard({
  pending,
  resolved,
  busy,
  onAnswer,
}: {
  pending: AssistantPendingConfirm;
  resolved?: "confirmed" | "cancelled";
  busy: boolean;
  onAnswer: (approved: boolean) => void;
}) {
  const s = styleFor(pending.tool);
  return (
    <div className="flex flex-col gap-2.5 rounded-[20px] bg-[#F3EDE0] px-5 py-4 sm:max-w-[520px]">
      <div className="flex items-center gap-2.5">
        <Mascot kind={s.mascot} size={26} active={!resolved} />
        <span className="flex-1 text-[15px] font-semibold">{s.label}</span>
        {resolved ? <Pill tone={resolved === "confirmed" ? "win" : "sand"}>{resolved}</Pill> : <Pill tone="warn">needs your OK</Pill>}
      </div>
      <p className="m-0 text-[14px] leading-[1.45] text-[#4A463D]">{pending.prompt}</p>
      {!resolved && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(true)}
            className="flex h-10 items-center rounded-full px-[18px] text-[14px] font-medium text-white disabled:opacity-40"
            style={{ background: INK }}
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(false)}
            className="flex h-10 items-center rounded-full bg-white px-[18px] text-[14px] font-medium shadow-[0_0_0_1px_#E8DFCC] disabled:opacity-40"
            style={{ color: INK }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
