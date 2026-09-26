"use client";

/**
 * ⌘K: a centred glass sheet with Darwin (the framed analyst). Type what you want in plain words
 * ("build a dashboard of coupon usage per hour for trail-shop", "send 200 shoppers", "roll back to gen 3",
 * "why are agents leaving?") or pick a suggestion (fuzzy filter, ↑↓ / ↵ / esc, recent commands).
 * Plans run as a live checklist; risky steps ask inline first. When a step changes page, the sheet
 * shrinks away and the toast carries on.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Bot,
  ChartColumn,
  CornerDownLeft,
  FlaskConical,
  History,
  ListTodo,
  MessageCircle,
  Newspaper,
  Pause,
  Rocket,
  ScanSearch,
  Sparkles,
  StepForward,
  Undo2,
  Users,
  WandSparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { pageOf, parseCommand, sayFor } from "@/lib/commands";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Tag } from "../ui";
import { useModKey, useNarrow } from "./keys";
import { RunView } from "./run-view";
import { useCommandRuntime, useCommandState, useWebMcpAvailable } from "./runtime";
import { isLive } from "./store";
import { filterSuggestions, suggestionsFor, type Suggestion, type SuggestionIcon, type SuggestionTone } from "./suggest";

const EASE = [0.2, 0.8, 0.2, 1] as const;

const ICONS: Record<SuggestionIcon, LucideIcon> = {
  chart: ChartColumn,
  users: Users,
  bot: Bot,
  step: StepForward,
  autopilot: Zap,
  pause: Pause,
  ask: MessageCircle,
  issue: ScanSearch,
  rollback: Undo2,
  flask: FlaskConical,
  wand: WandSparkles,
  brief: Newspaper,
  ship: Rocket,
  todo: ListTodo,
  go: ArrowRight,
  recent: History,
};

const TONES: Record<SuggestionTone, string> = {
  yellow: "bg-dw-yellow",
  pink: "bg-dw-pink",
  olive: "bg-dw-olive",
  blue: "bg-dw-blue",
  lilac: "bg-dw-lilac",
  sand: "bg-dw-sand",
};

const GROUPS: Record<Suggestion["group"], string> = { here: "On this page", recent: "Recent", do: "Commands", go: "Go to", team: "Team" };

function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-white px-1.5 font-dw text-[11.5px] font-medium text-dw-ink/70 shadow-[0_0_0_1px_#E4DACA,0_1px_0_#E4DACA]", className)}>
      {children}
    </kbd>
  );
}

interface Row {
  key: string;
  kind: "do" | "suggestion";
  s?: Suggestion;
}

export function CommandBar() {
  const rt = useCommandRuntime();
  const state = useCommandState();
  const reduce = useReducedMotion();
  const { mock } = useDarwin();
  if (!rt || !state) return null;
  const exitShrink = state.exit === "shrink";

  return (
    <AnimatePresence>
      {state.open && (
        <motion.div key="cmdk" className="fixed inset-0 z-[70]" data-modal-open="" initial={{ opacity: 1 }} exit={{ opacity: 1, transition: { duration: 0.3 } }}>
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-[#141413]/25 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.22 } }}
            onClick={() => rt.close()}
          />
          <div className="pointer-events-none absolute inset-x-0 top-[max(10px,min(11vh,120px))] flex justify-center px-2 sm:px-4">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Darwin command bar"
              className="pointer-events-auto flex max-h-[calc(100dvh-20px)] w-full max-w-[700px] flex-col overflow-hidden rounded-[26px] bg-[#FFFDF8]/[0.9] shadow-[0_0_0_1px_rgba(237,228,210,0.9),inset_0_1px_0_rgba(255,255,255,0.9),0_40px_100px_-28px_rgba(20,20,19,0.45),0_12px_30px_-12px_rgba(20,20,19,0.18)] backdrop-blur-2xl backdrop-saturate-150 sm:rounded-[30px]"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.26, ease: EASE } }}
              exit={
                reduce
                  ? { opacity: 0, transition: { duration: 0.12 } }
                  : exitShrink
                    ? { opacity: 0, scale: 0.42, y: -90, filter: "blur(2px)", transition: { duration: 0.32, ease: EASE } }
                    : { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.16 } }
              }
              style={{ transformOrigin: "50% 0%" }}
            >
              <Sheet mock={mock} />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Sheet({ mock }: { mock: boolean }) {
  const rt = useCommandRuntime()!;
  const state = useCommandState()!;
  const { autopilot } = useDarwin();
  const path = usePathname();
  const mod = useModKey();
  const narrow = useNarrow();
  const webmcp = useWebMcpAvailable();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [recent] = useState(() => rt.recent());
  const [sites, setSites] = useState<{ tracking: string[]; web: string[] }>();

  // Known sites (for the preview line and site-aware suggestions).
  useEffect(() => {
    let alive = true;
    void rt.sites().then((s) => alive && setSites(s));
    return () => {
      alive = false;
    };
  }, [rt]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const run = state.runId ? state.runs[state.runId] : undefined;
  const view: "run" | "home" = run && !query ? "run" : "home";
  const busy = !!run && isLive(run);

  const page = pageOf(path ?? "");
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : undefined;
  const site = params?.get("site") ?? undefined;
  const dev = params?.get("dev") === "1";
  const all = useMemo(() => suggestionsFor(page, { site, autopilot, recent }), [page, site, autopilot, recent]);
  const matches = useMemo(() => filterSuggestions(all, query, { dev }), [all, query, dev]);

  // What the words would do (local heuristic preview; the server may plan with an LLM).
  const preview = useMemo(() => {
    const q = query.trim();
    if (q.length < 3) return "";
    const p = parseCommand(q, { page: `${path ?? ""}${typeof window !== "undefined" ? window.location.search : ""}`, sites });
    return p.steps.length ? sayFor(p.steps) : "";
  }, [query, path, sites]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim();
    const s = matches.map((m) => ({ key: m.id, kind: "suggestion" as const, s: m }));
    if (!q) return s;
    const doRow: Row = { key: "__do", kind: "do" };
    // A strong title match ("iss" → Go to Issues) goes first; otherwise "do what I typed".
    const strong = matches[0] && matches[0].title.toLowerCase().startsWith(q.toLowerCase()) && q.split(/\s+/).length <= 2;
    return strong ? [...s.slice(0, 1), doRow, ...s.slice(1)] : [doRow, ...s];
  }, [matches, query]);

  const active = Math.min(sel, Math.max(0, rows.length - 1));

  // Keep the newest step / result in view while a plan runs.
  const progress = run ? `${run.id}:${run.status}:${run.steps.map((s) => s.status).join(",")}` : "";
  useEffect(() => {
    const el = scroller.current;
    if (el && view === "run") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [progress, view]);

  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "do") {
      const q = query.trim();
      if (!q) return;
      setQuery("");
      setSel(0);
      void rt.submit(q);
      return;
    }
    const s = row.s!;
    if (s.fill) {
      setQuery(s.fill);
      setSel(0);
      requestAnimationFrame(() => {
        const el = input.current;
        if (el) {
          el.focus();
          el.setSelectionRange(s.fill!.length, s.fill!.length);
        }
      });
      return;
    }
    setQuery("");
    setSel(0);
    if (s.text) void rt.submit(s.text);
    else if (s.steps) void rt.runSteps(s.steps, s.title);
  };

  const waitingIndex = run?.steps.findIndex((s) => s.status === "confirm") ?? -1;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (waitingIndex >= 0 && run && view === "run") {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        rt.approve(run.id, waitingIndex, true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        rt.approve(run.id, waitingIndex, false);
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) {
        setQuery("");
        setSel(0);
      } else rt.close();
      return;
    }
    if (view !== "home") {
      if (e.key === "Enter" && !query && run && !isLive(run)) {
        // ↵ on a finished run: back to the list for the next command.
        e.preventDefault();
        rt.store.set({ runId: undefined });
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((i) => Math.min(rows.length - 1, Math.min(i, rows.length - 1) + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((i) => Math.max(0, Math.min(i, rows.length - 1) - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(rows[active]);
    } else if (e.key === "Tab" && rows[active]?.s?.fill) {
      e.preventDefault();
      pick(rows[active]);
    }
  };

  const activeId = view === "home" && rows[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKey}>
      {/* input */}
      <div className="flex h-[68px] shrink-0 items-center gap-3 px-3.5 sm:h-[76px] sm:gap-3.5 sm:px-5">
        <Mascot kind="analyst" size={44} frame active={busy || query.length > 0} title="Darwin" />
        <label htmlFor={`${listId}-input`} className="sr-only">
          Tell Darwin what to do
        </label>
        <input
          ref={input}
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={view === "home"}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          placeholder={
            run && view === "run"
              ? run.status === "waiting"
                ? "Waiting for your OK…"
                : busy
                  ? narrow
                    ? "Darwin is on it…"
                    : "Darwin is on it… type another command"
                  : narrow
                    ? "Next command"
                    : "Next command, or ↵ for the list"
              : narrow
                ? "Tell Darwin what to do"
                : "Tell Darwin what to do, or ask anything"
          }
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] tracking-[-0.01em] text-dw-ink outline-none placeholder:text-dw-ink/40 sm:text-[19px]"
        />
        <button type="button" onClick={() => rt.close()} className="shrink-0 rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink" aria-label="Close">
          <Kbd>esc</Kbd>
        </button>
      </div>
      <div className="h-px shrink-0 bg-dw-hairline" />

      {/* body */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain sm:max-h-[min(470px,62vh)] max-sm:max-h-[62dvh]">
        {view === "run" && run ? (
          <RunView run={run} mock={mock} mod={mod} onApprove={(i, ok) => rt.approve(run.id, i, ok)} onNavigate={() => rt.close()} />
        ) : (
          <div id={listId} role="listbox" aria-label="Commands" className="flex flex-col p-2">
            {rows.map((row, i) => {
              const prev = rows[i - 1]?.s?.group;
              const header = row.s && row.s.group !== prev && !query ? GROUPS[row.s.group] : undefined;
              return (
                <div key={row.key}>
                  {header && <div className="px-3 pt-2.5 pb-1 text-[12.5px] font-medium text-dw-ink/50">{header}</div>}
                  <RowButton
                    id={`${listId}-${i}`}
                    index={i}
                    selected={i === active}
                    row={row}
                    query={query}
                    preview={preview}
                    onHover={() => setSel(i)}
                    onPick={() => pick(row)}
                  />
                </div>
              );
            })}
            {!rows.length && <p className="px-3 py-6 text-center text-[14px] text-dw-ink/55">Nothing matches. Press ↵ and Darwin will work it out.</p>}
          </div>
        )}
      </div>

      {/* footer */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-dw-hairline bg-dw-sand/35 px-4 text-[12px] text-dw-ink/55 sm:px-5">
        <div className="flex min-w-0 items-center gap-3 max-sm:hidden">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>
            run
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>{mod}</Kbd>
            <Kbd>K</Kbd> toggle
          </span>
        </div>
        <span className="truncate sm:hidden">Tap a command, or type one</span>
        <span
          className="flex shrink-0 items-center gap-1.5"
          title={webmcp ? "Darwin's commands are registered with this browser's WebMCP (navigator.modelContext): an AI agent here can use them." : "This browser has no WebMCP (navigator.modelContext). Agents can still use window.darwin."}
        >
          <span className={cn("size-1.5 rounded-full", webmcp ? "dw-live-dot bg-dw-live" : "bg-dw-ink/25")} />
          {webmcp ? "WebMCP on" : "window.darwin ready"}
        </span>
      </div>
    </div>
  );
}

function RowButton({ id, index, selected, row, query, preview, onHover, onPick }: { id: string; index: number; selected: boolean; row: Row; query: string; preview: string; onHover: () => void; onPick: () => void }) {
  const isDo = row.kind === "do";
  const s = row.s;
  const Icon = isDo ? Sparkles : ICONS[s!.icon];
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      data-row={index}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition-colors duration-150 outline-none",
        selected ? "bg-dw-sand" : "hover:bg-dw-sand/50",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-[12px] transition-transform duration-300",
          isDo ? "bg-dw-ink text-white" : TONES[s!.tone],
          selected && "-rotate-6 scale-105",
        )}
      >
        <Icon className="size-[17px]" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] leading-snug font-medium">{isDo ? <>“{query.trim()}”</> : s!.title}</span>
        <span className="truncate text-[12.5px] leading-snug text-dw-ink/55">{isDo ? preview || "Darwin works out the steps" : s!.hint}</span>
      </span>
      {s?.risk === "confirm" && <Tag tone="warn">Asks first</Tag>}
      {selected && (
        <span className="max-sm:hidden">
          <Kbd>
            <CornerDownLeft className="size-3" />
          </Kbd>
        </span>
      )}
    </button>
  );
}
