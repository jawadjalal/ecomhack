"use client";

/**
 * "Ask Darwin": the merchant's lead agent, always at the bottom of every console page. It never hides.
 *
 * - Closed: an ink prompt bar (desktop: a centred pill ≤ 760px; phones: a full-width dock) with the Darwin
 *   mascot, the input, a mic and send. It sits above any phone tab bar (`--dw-tabbar-h`).
 * - Tap or drag the bar (or its grip) up: a sheet springs open (half, then full) and the bar becomes the
 *   sheet's composer. Drag down, the chevron or Escape closes it.
 * - Talks to POST /api/assistant: inline result cards, Confirm / Cancel for side effects, agent-to-agent
 *   threads, and navigation when Darwin opens a page. Refreshes the console's live data (SWR) after actions.
 * - Voice (./voice): hold or tap the mic to talk; "Read aloud" speaks replies.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSWRConfig } from "swr";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, ChevronDown, Maximize2, Minimize2, RotateCcw, Store, X } from "lucide-react";
import type { AgentThread, AssistantAction, AssistantMessage, AssistantPendingConfirm, AssistantResponse, CrewId } from "@/lib/contracts";
import { CREW, crewMember, SIMULATED_SHOPPER, type CrewMember } from "@/lib/crew";
import { BrandGlyph } from "@/components/dw/brand-logos";
import { cn } from "@/components/ui/cn";
import { Mascot, MASCOT_CSS, type MascotKind } from "./mascot";
import { LevelMeter, MicButton, SpeakerToggle, useRecorder, useSpeaker, useVoiceStatus } from "./voice";

/* ------------------------------------------------------------------ design tokens (dw) */

const INK = "#141413";
const CREAM = "#F7F1E5";
const SURFACE = "#FFFDF8";
const FONT: CSSProperties = { fontFamily: "var(--font-outfit), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" };
const MONO: CSSProperties = { fontFamily: "var(--font-dm-mono), var(--font-geist-mono), ui-monospace, monospace" };
const SPRING = { type: "spring", stiffness: 420, damping: 40, mass: 0.9 } as const;

/** Bottom gap (16px desktop, the safe area on phones) and the page reserve under the bar. */
const ASK_CSS = `[data-ask-root]{--ask-gap:16px}
@media (max-width:639px){[data-ask-root]{--ask-gap:max(8px,calc(env(safe-area-inset-bottom,0px) - var(--dw-tabbar-h,0px)))}}
[data-assistant-spacer]{height:calc(var(--dw-tabbar-h,0px) + 104px)}
:root:has([data-dw]) [data-assistant-spacer]{height:var(--dw-tabbar-h,0px)}`;

type Mode = "bar" | "half" | "full";

/** An agent-to-agent exchange Darwin ran this turn (AssistantResponse.threads). */
type ThreadView = AgentThread;

/* ------------------------------------------------------------------ the crew (tabs, avatars, colours) */

/** Each crew member's pastel (the active tab, its thinking row). Grok is ink. */
const CREW_TONE: Record<CrewId, { bg: string; fg: string }> = {
  darwin: { bg: "#EDE6D6", fg: INK },
  iris: { bg: "#B8CAEE", fg: INK },
  theo: { bg: "#F3B5D5", fg: INK },
  ada: { bg: "#F6D76B", fg: INK },
  max: { bg: "#A9B46E", fg: INK },
  mika: { bg: "#D5CCF5", fg: INK },
  grok: { bg: INK, fg: CREAM },
};
/** What to ask each of them about (the bar's placeholder). */
const ASK_ABOUT: Record<CrewId, string> = {
  darwin: "about your store, or tell it what to do",
  iris: "where shoppers get stuck",
  theo: "about page changes",
  ada: "about your tests",
  max: "about shipping winners",
  mika: "about selling to AI shoppers",
  grok: "about your briefing",
};
const AGENT_KEY = "darwin.assistant.agent";
const crewById = (id: CrewId): CrewMember => CREW.find((c) => c.id === id) ?? CREW[0];

/** A crew member's face: their mascot, or a round badge for Mika (the store) and Grok. */
function CrewAvatar({ member, size = 26, active, thinking }: { member?: CrewMember; size?: number; active?: boolean; thinking?: boolean }) {
  const m = member ?? CREW[0];
  if (m.mascot) return <Mascot kind={m.mascot as MascotKind} size={size} active={active} thinking={thinking} label={m.name} />;
  const tone = m.brand === "grok" ? { bg: INK, fg: CREAM } : { bg: "#D5CCF5", fg: INK };
  return (
    <span role="img" aria-label={m.name} className="inline-block shrink-0" style={{ width: size, height: size }}>
      <span className={cn("grid size-full place-items-center rounded-full", thinking ? "dm-think" : active && "dm-bob")} style={{ background: tone.bg, color: tone.fg, boxShadow: m.brand === "grok" ? "none" : "inset 0 0 0 1px rgba(20,20,19,0.08)" }}>
        {m.brand === "grok" ? <BrandGlyph brand="grok" size={Math.round(size * 0.56)} /> : <Store style={{ width: size * 0.52, height: size * 0.52 }} strokeWidth={2} />}
      </span>
    </span>
  );
}

/** Who a thread name is: a crew member, the simulated shopper, or unknown (shown as-is). */
function whoIs(name: string): { name: string; member?: CrewMember; shopper?: boolean } {
  const n = name.trim();
  if (/^(shopper|buyer|simulated shopper|buyer agent)$/i.test(n)) return { name: SIMULATED_SHOPPER.label, shopper: true };
  const legacy: Record<string, CrewId> = { analyst: "iris", watcher: "iris", designer: "theo", tester: "ada", experimenter: "ada", shipper: "max", "store agent": "mika", store: "mika" };
  const member = crewMember(n) ?? (legacy[n.toLowerCase()] ? crewById(legacy[n.toLowerCase()]) : undefined);
  return member ? { name: member.name, member } : { name: n.replace(/^./, (c) => c.toUpperCase()) };
}

function ThreadFace({ name, size = 22, thinking }: { name: string; size?: number; thinking?: boolean }) {
  const w = whoIs(name);
  if (w.shopper) return <Mascot kind={SIMULATED_SHOPPER.mascot as MascotKind} size={size} thinking={thinking} label="Simulated shopper" />;
  return <CrewAvatar member={w.member ?? CREW[0]} size={size} thinking={thinking} />;
}

interface ChatItem {
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAction[];
  pendingConfirm?: AssistantPendingConfirm;
  threads?: ThreadView[];
  /** What the merchant did with the pending confirmation. */
  resolved?: "confirmed" | "cancelled";
  error?: boolean;
  /** Came from the mic. */
  voice?: boolean;
  /** Arrived this session: play its agent threads message by message. */
  fresh?: boolean;
}

/** How each tool's result card looks. Unknown tools (new ones added to the registry) get the sand default. */
const TOOL_STYLE: Record<string, { label: string; bg: string; mascot: MascotKind }> = {
  get_kpis: { label: "Store numbers", bg: "#F6D76B", mascot: "observer" },
  loop_status: { label: "Loop status", bg: "#B8CAEE", mascot: "analyst" },
  step_loop: { label: "Loop stepped", bg: "#B8CAEE", mascot: "analyst" },
  set_autopilot: { label: "Autopilot", bg: "#B8CAEE", mascot: "analyst" },
  reset_loop: { label: "Reset to Gen 0", bg: "#EDE6D6", mascot: "analyst" },
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
  navigate: { label: "Opened", bg: "#EDE6D6", mascot: "analyst" },
};
const styleFor = (tool: string) => TOOL_STYLE[tool] ?? { label: tool.replace(/_/g, " "), bg: "#F3EDE0", mascot: "analyst" as MascotKind };

/* ------------------------------------------------------------------ starters (per page, or from the page itself) */

export interface Starter {
  text: string;
  kind?: string;
  tone?: string;
}

const DEFAULT_STARTERS: Starter[] = [
  { text: "How are we doing?", kind: "experimenter", tone: "#F3B5D5" },
  { text: "Run the loop", kind: "designer", tone: "#F6D76B" },
  { text: "Send a test shopper", kind: "observer", tone: "#B8CAEE" },
];
const PAGE_STARTERS: [RegExp, Starter[]][] = [
  [/^\/console\/issues/, [
    { text: "What’s the biggest leak?", kind: "experimenter", tone: "#F3B5D5" },
    { text: "Why do agents drop off?", kind: "observer", tone: "#B8CAEE" },
    { text: "Run the loop", kind: "designer", tone: "#F6D76B" },
  ]],
  [/^\/console\/(experiments|fixes|changes|pulls)/, [
    { text: "Is the test safe to ship?", kind: "experimenter", tone: "#F3B5D5" },
    { text: "What should we test next?", kind: "designer", tone: "#F6D76B" },
    { text: "Show the loop status", kind: "analyst", tone: "#B8CAEE" },
  ]],
  [/^\/console\/agents/, [
    { text: "Send a test shopper", kind: "experimenter", tone: "#F3B5D5" },
    { text: "How do agents buy?", kind: "observer", tone: "#B8CAEE" },
    { text: "Is my store agent-ready?", kind: "shipper", tone: "#A9B46E" },
  ]],
  [/^\/console\/dashboards/, [
    { text: "Add a chart of revenue by day", kind: "designer", tone: "#F6D76B" },
    { text: "How are we doing?", kind: "experimenter", tone: "#F3B5D5" },
    { text: "Which agents buy most?", kind: "observer", tone: "#B8CAEE" },
  ]],
];

/** First questions for each specialist's own tab. */
const CREW_STARTERS: Record<Exclude<CrewId, "darwin">, string[]> = {
  iris: ["Where do shoppers get stuck?", "Why do AI agents drop off?", "Which agents buy most?"],
  theo: ["Draft a fix for the biggest leak", "What would you change on the product page?", "Show your latest draft"],
  ada: ["Is the test safe to ship?", "What should we test next?", "How sure are you about B?"],
  max: ["What's ready to ship?", "What did we ship last?", "Can you undo the last change?"],
  mika: ["What do AI shoppers ask you?", "What are you selling?", "How many agents bought today?"],
  grok: ["What's in my briefing?", "Anything I should act on?", "Summarise yesterday"],
};

/** Suggestions a page hands the bar (the Overview's live questions); null = use the per-page defaults. */
let pageStarters: Starter[] | null = null;
const starterListeners = new Set<() => void>();
const subscribeStarters = (cb: () => void) => {
  starterListeners.add(cb);
  return () => starterListeners.delete(cb);
};
function setPageStarters(next: Starter[] | null) {
  if (JSON.stringify(next) === JSON.stringify(pageStarters)) return;
  pageStarters = next;
  starterListeners.forEach((l) => l());
}

/** Render on a page to offer its own suggested questions in the bar (cleared when the page unmounts). */
export function AssistantSuggestions({ suggestions }: { suggestions: Starter[] }) {
  const key = JSON.stringify(suggestions.map((s) => [s.text, s.kind, s.tone]));
  useEffect(() => {
    setPageStarters(JSON.parse(key).map(([text, kind, tone]: [string, string?, string?]) => ({ text, kind, tone })));
    return () => setPageStarters(null);
  }, [key]);
  return null;
}

const MASCOTS: MascotKind[] = ["observer", "analyst", "designer", "experimenter", "shipper"];
const asMascot = (k?: string): MascotKind => (MASCOTS.includes(k as MascotKind) ? (k as MascotKind) : "analyst");

/* ------------------------------------------------------------------ thread persistence */

const STORAGE_KEY = "darwin.assistant.thread";
/** Darwin keeps the original key; each crew member has its own conversation. */
const threadKey = (agent: CrewId) => (agent === "darwin" ? STORAGE_KEY : `${STORAGE_KEY}.${agent}`);

function loadThread(agent: CrewId): ChatItem[] {
  try {
    const raw = sessionStorage.getItem(threadKey(agent));
    const parsed = raw ? (JSON.parse(raw) as ChatItem[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

function saveThread(agent: CrewId, items: ChatItem[]) {
  try {
    sessionStorage.setItem(threadKey(agent), JSON.stringify(items.slice(-40).map((m) => ({ ...m, fresh: undefined }))));
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

/* ------------------------------------------------------------------ visible viewport (keyboard-aware) */

const SERVER_VP = "1440|900|0|0";
let vpCache = SERVER_VP;
function readVp(): string {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height ?? window.innerHeight);
  const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
  const tab = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dw-tabbar-h")) || 0;
  const next = `${window.innerWidth}|${h}|${kb}|${Math.round(tab)}`;
  if (next !== vpCache) vpCache = next;
  return vpCache;
}
function subscribeVp(cb: () => void) {
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
function useVp() {
  const raw = useSyncExternalStore(subscribeVp, readVp, () => SERVER_VP);
  const [w, h, kb, tab] = raw.split("|").map(Number);
  return { w, h, kb, tab };
}

/* ------------------------------------------------------------------ panel */

export function AssistantPanel() {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>("bar");
  const [dragH, setDragH] = useState<number | null>(null);
  const [agent, setAgent] = useState<CrewId>("darwin");
  const [byAgent, setByAgent] = useState<Partial<Record<CrewId, ChatItem[]>>>({});
  /** Which crew member is working on a reply (one at a time). */
  const [working, setWorking] = useState<CrewId | null>(null);
  const busy = working !== null;
  const items = useMemo(() => byAgent[agent] ?? [], [byAgent, agent]);
  const setItemsFor = useCallback((who: CrewId, fn: (all: ChatItem[]) => ChatItem[]) => setByAgent((m) => ({ ...m, [who]: fn(m[who] ?? []) })), []);
  const member = crewById(agent);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const pathname = usePathname();
  const given = useSyncExternalStore(subscribeStarters, () => pageStarters, () => null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const hydrated = useRef(false);
  const sendRef = useRef<(text: string, voice?: boolean) => void>(() => undefined);

  const voice = useVoiceStatus();
  const rec = useRecorder({ stt: voice.stt, ready: voice.ready, onText: useCallback((t: string) => sendRef.current(t, true), []) });
  const speaker = useSpeaker(voice.tts);

  /* sheet heights for this viewport (the bar block itself is ~84px) */
  const vp = useVp();
  const phone = vp.w < 640;
  const avail = Math.max(220, vp.h - vp.tab - (phone ? 8 : 16) - 84 - (phone ? 12 : 28));
  const snaps: Record<Mode, number> = { bar: 0, half: Math.round(Math.min(avail, Math.max(260, avail * 0.52))), full: avail };
  const open = mode !== "bar" || dragH !== null;
  const bodyH = Math.max(0, Math.min(avail, dragH ?? snaps[mode]));
  const recording = rec.phase === "recording" || rec.phase === "starting";

  const starters: Starter[] =
    agent !== "darwin"
      ? CREW_STARTERS[agent].map((text) => ({ text, tone: CREW_TONE[agent].bg }))
      : (pathname === "/console" && given) || PAGE_STARTERS.find(([re]) => re.test(pathname ?? ""))?.[1] || given || DEFAULT_STARTERS;

  /* conversations (one per crew member) survive page navigation within the console (per browser tab) */
  useEffect(() => {
    const t = setTimeout(() => {
      const all: Partial<Record<CrewId, ChatItem[]>> = {};
      for (const c of CREW) {
        const saved = loadThread(c.id);
        if (saved.length) all[c.id] = saved;
      }
      setByAgent(all);
      try {
        const a = sessionStorage.getItem(AGENT_KEY);
        if (a && CREW.some((c) => c.id === a)) setAgent(a as CrewId);
      } catch {
        /* storage blocked */
      }
      hydrated.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    for (const [who, list] of Object.entries(byAgent)) saveThread(who as CrewId, list ?? []);
  }, [byAgent]);
  const pickAgent = useCallback((id: CrewId) => {
    setAgent(id);
    setFollowUps([]);
    try {
      sessionStorage.setItem(AGENT_KEY, id);
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [items, busy, open, reduce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (recording) rec.cancel();
      else if (open) setMode("bar");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, recording, rec]);

  const openTo = useCallback((m: Mode) => {
    setMode(m);
    setDragH(null);
  }, []);

  /* drag the grip or the bar: resize, snap on release; a tap toggles */
  const dragDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("input,button:not([data-grip]),a")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    drag.current = { y: e.clientY, h: bodyH, moved: false };
  };
  const dragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setDragH(Math.min(avail, Math.max(0, d.h + dy)));
  };
  const dragUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setMode((m) => (m === "bar" ? "half" : m === "half" ? "full" : "bar"));
      setDragH(null);
      return;
    }
    const h = dragH ?? d.h;
    const next = (["bar", "half", "full"] as Mode[]).reduce((best, m) => (Math.abs(snaps[m] - h) < Math.abs(snaps[best] - h) ? m : best), "bar" as Mode);
    openTo(next);
  };
  const dragProps = { onPointerDown: dragDown, onPointerMove: dragMove, onPointerUp: dragUp, onPointerCancel: dragUp };

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
    async (who: CrewId, history: ChatItem[], confirm?: { tool: string; args: Record<string, unknown>; approved: boolean }) => {
      setWorking(who);
      speaker.hush();
      const setItems = (fn: (all: ChatItem[]) => ChatItem[]) => setItemsFor(who, fn);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: toHistory(history), confirm, context: pageContext(), ...(who === "darwin" ? {} : { agent: who }) }),
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as Partial<AssistantResponse> & { error?: string; threads?: ThreadView[] };
        if (!res.ok || typeof body.reply !== "string") {
          const why =
            res.status === 401
              ? "You're signed out. Open /console and sign in with the admin key."
              : res.status >= 500
                ? "Darwin hit a snag answering that. Try again in a moment."
                : (body.error ?? `Darwin didn't answer (${res.status}).`);
          setItems((all) => [...all, { role: "assistant", content: why, error: true }]);
          return;
        }
        const actions = body.actions ?? [];
        const threads = Array.isArray(body.threads) ? body.threads.filter((t) => t && Array.isArray(t.messages) && t.messages.length) : undefined;
        setItems((all) => [...all, { role: "assistant", content: body.reply!, actions, pendingConfirm: body.pendingConfirm, threads, fresh: true }]);
        setFollowUps(body.suggestions ?? []);
        refresh(actions);
        if (speaker.on) speaker.say(replyText({ role: "assistant", content: body.reply!, pendingConfirm: body.pendingConfirm }) || body.reply!);
        // Darwin opened a page: go there once the reply has rendered.
        const go = actions.find((a) => a.ok && (a as AssistantAction & { navigate?: boolean }).navigate && a.link?.href.startsWith("/"));
        if (go?.link) window.setTimeout(() => router.push(go.link!.href), 450);
      } catch {
        setItems((all) => [...all, { role: "assistant", content: "Couldn't reach Darwin. Check your connection and try again.", error: true }]);
      } finally {
        setWorking(null);
      }
    },
    [refresh, router, speaker, setItemsFor],
  );

  const send = (text: string, fromVoice?: boolean) => {
    const t = text.trim();
    if (!t || working !== null) return;
    // A new message supersedes an unanswered confirmation.
    const next: ChatItem[] = [
      ...items.map((m) => (m.pendingConfirm && !m.resolved ? { ...m, resolved: "cancelled" as const } : m)),
      { role: "user", content: t.slice(0, 2000), voice: fromVoice || undefined },
    ];
    setItemsFor(agent, () => next);
    setDraft("");
    if (mode === "bar") openTo("half");
    void call(agent, next);
  };
  useEffect(() => {
    sendRef.current = (t, v) => {
      setDraft(t);
      send(t, v);
    };
  });

  const answer = useCallback(
    (index: number, approved: boolean) => {
      const item = items[index];
      if (!item?.pendingConfirm || item.resolved || busy) return;
      const next: ChatItem[] = [
        ...items.map((m, i) => (i === index ? { ...m, resolved: approved ? ("confirmed" as const) : ("cancelled" as const) } : m)),
        { role: "user", content: approved ? "Yes, go ahead." : "No, cancel that." },
      ];
      setItemsFor(agent, () => next);
      void call(agent, next, { tool: item.pendingConfirm.tool, args: item.pendingConfirm.args, approved });
    },
    [items, busy, call, agent, setItemsFor],
  );

  const clear = () => {
    setItemsFor(agent, () => []);
    setFollowUps([]);
    speaker.hush();
  };

  const dragging = dragH !== null;
  const listening = rec.phase === "recording" || rec.phase === "starting";

  return (
    <div style={FONT} data-assistant>
      <style>{MASCOT_CSS + ASK_CSS}</style>
      {/* room under the page for the bar (mission control classic reserves its own) */}
      {pathname !== "/console/classic" && <div aria-hidden data-assistant-spacer />}

      <div
        data-ask-root
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-2 sm:px-6"
        style={{ bottom: `calc(var(--dw-tabbar-h, 0px) + var(--ask-gap) + ${vp.kb}px)` }}
      >
        <div
          data-assistant-panel={open ? "open" : "closed"}
          className={cn(
            "pointer-events-auto flex w-full flex-col transition-[max-width,background-color,box-shadow,border-radius,padding] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
            open ? "max-w-[920px] rounded-[28px] px-2 pb-2" : "max-w-[760px] rounded-[32px] px-0 pb-0",
          )}
          style={{
            ...FONT,
            color: INK,
            background: open ? SURFACE : "transparent",
            boxShadow: open ? "0 0 0 1px #E8DFCC, 0 18px 48px rgba(20,20,19,0.14)" : "none",
          }}
        >
          {/* grip: drag (or tap) to open / resize */}
          <button
            type="button"
            data-grip
            aria-label={open ? "Resize Darwin: drag, or tap to change size" : "Open Darwin: drag up, or tap"}
            aria-expanded={open}
            className="mx-auto flex h-5 w-24 shrink-0 cursor-grab touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#141413] active:cursor-grabbing"
            {...dragProps}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              if (e.key === "ArrowUp") openTo(mode === "bar" ? "half" : "full");
              else openTo(mode === "full" ? "half" : "bar");
            }}
          >
            <span className={cn("h-[5px] w-11 rounded-full", open ? "bg-[#DDD5C4]" : "bg-[#141413]/25")} />
          </button>

          {/* the sheet body */}
          <AnimatePresence initial={false}>
            {open && (
              <motion.section
                key="sheet"
                aria-label="Darwin chat"
                className="flex min-h-0 flex-col overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: bodyH, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={dragging || reduce ? { duration: 0 } : SPRING}
              >
                <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 px-1.5 sm:px-3" {...dragProps}>
                  <div role="tablist" aria-label="Talk to the crew" className="flex min-w-0 flex-1 touch-pan-x items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none]" data-crew-tabs>
                    {CREW.map((c) => {
                      const on = c.id === agent;
                      const tone = CREW_TONE[c.id];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="tab"
                          aria-selected={on}
                          title={`${c.name} · ${c.role}: ${c.oneLiner}`}
                          onClick={() => pickAgent(c.id)}
                          className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1 text-[14px] font-medium transition-colors", !on && "hover:bg-[#F3EDE0]")}
                          style={on ? { background: tone.bg, color: tone.fg } : { color: INK }}
                          data-crew-tab={c.id}
                        >
                          <CrewAvatar member={c} size={26} active={on && !busy} thinking={working === c.id} />
                          <span className={cn(!on && "hidden sm:inline")}>{c.name}</span>
                          {on && <span className="hidden text-[12px] opacity-70 lg:inline">{c.role}</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <SpeakerToggle speaker={speaker} />
                    {items.length > 0 && (
                      <RoundButton label="New conversation" onClick={clear} disabled={busy} className="hidden sm:grid">
                        <RotateCcw className="size-[15px]" />
                      </RoundButton>
                    )}
                    <RoundButton label={mode === "full" ? "Half height" : "Full height"} onClick={() => openTo(mode === "full" ? "half" : "full")} className="hidden sm:grid">
                      {mode === "full" ? <Minimize2 className="size-[15px]" /> : <Maximize2 className="size-[15px]" />}
                    </RoundButton>
                    <RoundButton label="Close the chat" onClick={() => openTo("bar")}>
                      <ChevronDown className="size-4" />
                    </RoundButton>
                  </div>
                </header>

                <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-3 sm:px-4" aria-live="polite">
                  <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
                    {items.length === 0 && (
                      <div className="flex flex-col gap-3">
                        <p className="m-0 text-[15px] leading-[1.5] text-[#4A463D]">
                          {agent === "darwin"
                            ? "Ask about your shoppers and agents, or tell Darwin what to do. It runs the loop, sends test shoppers, builds charts and ships winners (it asks first), and asks the crew when it needs them."
                            : `${member.name}, ${member.role.toLowerCase()}: ${member.oneLiner}. Ask directly; Darwin still asks you before anything changes.`}
                        </p>
                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          {starters.slice(0, 3).map((s, i) => (
                            <motion.button
                              key={s.text}
                              type="button"
                              onClick={() => send(s.text)}
                              disabled={busy}
                              initial={reduce ? false : { opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ ...SPRING, delay: 0.04 * i }}
                              className="group flex min-h-[56px] items-center gap-3 rounded-[20px] px-4 py-3 text-left text-[15px] font-medium transition-transform hover:-translate-y-0.5 disabled:opacity-50 sm:min-h-[88px] sm:flex-col sm:items-start sm:justify-between motion-reduce:transition-none"
                              style={{ background: s.tone ?? "#EDE6D6", color: INK }}
                            >
                              <span className="transition-transform duration-300 group-hover:-rotate-6">
                                {agent === "darwin" ? <Mascot kind={asMascot(s.kind)} size={26} /> : <CrewAvatar member={member} size={26} />}
                              </span>
                              {s.text}
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    )}

                    {items.map((m, i) =>
                      m.role === "user" ? (
                        <motion.div
                          key={i}
                          initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={SPRING}
                          className="max-w-[85%] self-end rounded-[20px_20px_6px_20px] px-[18px] py-[11px] text-[16px] leading-[1.4] break-words sm:max-w-[65%]"
                          style={{ background: INK, color: CREAM }}
                        >
                          {m.voice && (
                            <span className="mb-0.5 block text-[11px] tracking-[0.04em] opacity-60" style={MONO}>
                              SAID
                            </span>
                          )}
                          {m.content}
                        </motion.div>
                      ) : (
                        <motion.div key={i} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="flex flex-col gap-3">
                          {/* the confirm card carries the question itself */}
                          {replyText(m) && <Reply text={replyText(m)} error={m.error} />}
                          {m.threads?.map((t) => <Thread key={t.id} thread={t} play={m.fresh} />)}
                          {!!m.actions?.length && <ResultCards actions={m.actions} reply={m.content} />}
                          {m.pendingConfirm && <ConfirmCard pending={m.pendingConfirm} resolved={m.resolved} busy={busy} onAnswer={(ok) => answer(i, ok)} />}
                        </motion.div>
                      ),
                    )}

                    {working === agent && (
                      <div className="flex items-center gap-2.5" aria-label={`${member.name} is thinking`} data-thinking={agent}>
                        <CrewAvatar member={member} size={28} thinking />
                        <span className="text-[14px] text-[#6B665C]">{member.name} is thinking</span>
                        <TypingDots />
                      </div>
                    )}
                  </div>
                </div>

                {followUps.length > 0 && items.length > 0 && (
                  <div className="-mx-0.5 flex shrink-0 gap-1.5 overflow-x-auto px-2.5 pb-2 [scrollbar-width:none] sm:px-4">
                    {followUps.map((s) => (
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
              </motion.section>
            )}
          </AnimatePresence>

          {/* voice problems (denied mic, nothing heard) */}
          <AnimatePresence>
            {rec.error && (
              <motion.div
                key="voice-error"
                role="alert"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={SPRING}
                className="mb-2 flex items-start gap-2 rounded-[18px] bg-[#FBE7D3] py-2.5 pr-2 pl-4 text-[14px] leading-[1.4] text-[#8A4A14]"
                data-voice-error
              >
                <span className="min-w-0 flex-1">{rec.error}</span>
                <button type="button" aria-label="Dismiss" onClick={rec.clearError} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-black/5">
                  <X className="size-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* the prompt bar: always here; the sheet's composer when open */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (listening) return rec.stop();
              if (!draft.trim()) return openTo(mode === "bar" ? "half" : mode);
              send(draft);
            }}
            {...dragProps}
            className="flex h-[60px] w-full shrink-0 touch-pan-x items-center gap-2 rounded-[30px] pr-2 pl-2.5 sm:gap-2.5"
            style={{ background: INK, color: CREAM }}
            data-ask-bar
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: "rgba(247,241,229,0.10)" }}>
              <CrewAvatar member={member} size={30} active={!busy} thinking={busy} />
            </span>
            <label htmlFor="dw-ask" className="sr-only">
              Ask Darwin
            </label>
            {listening || rec.phase === "transcribing" ? (
              <div className="flex h-full min-w-0 flex-1 items-center gap-3" aria-live="polite">
                {rec.phase === "transcribing" ? (
                  <span className="truncate text-[16px] opacity-80">Transcribing…</span>
                ) : (
                  <>
                    <LevelMeter level={rec.level} engine={rec.engine} />
                    <span className="truncate text-[16px]">Listening…</span>
                    <span className="hidden truncate text-[13px] opacity-60 sm:inline">release or tap ■ to send</span>
                    <button type="button" onClick={rec.cancel} className="ml-auto h-8 shrink-0 rounded-full px-3 text-[13px] font-medium opacity-80 hover:opacity-100" style={{ background: "rgba(247,241,229,0.12)" }}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ) : (
              <input
                ref={input}
                id="dw-ask"
                type="text"
                autoComplete="off"
                enterKeyHint="send"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => mode === "bar" && items.length > 0 && openTo("half")}
                placeholder={items.length ? `Ask ${member.name} a follow-up` : phone ? `Ask ${member.name}…` : `Ask ${member.name} ${ASK_ABOUT[agent]}…`}
                maxLength={2000}
                className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#F7F1E5]/55"
                style={{ color: CREAM }}
              />
            )}
            {!open && items.length > 0 && !listening && (
              <button
                type="button"
                onClick={() => openTo("half")}
                className="hidden h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium sm:flex"
                style={{ background: "rgba(247,241,229,0.12)", color: CREAM }}
              >
                Show chat
              </button>
            )}
            {speaker.speaking && !listening && <SpeakerToggle speaker={speaker} compact />}
            <MicButton rec={rec} disabled={busy} />
            {!listening && (
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || rec.phase === "transcribing"}
                className="grid size-11 shrink-0 place-items-center rounded-full transition-[transform,opacity] hover:scale-105 active:scale-95 disabled:opacity-40 motion-reduce:transition-none"
                style={{ background: CREAM, color: INK }}
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.2} />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

/** The reply without the confirmation question (shown on the confirm card instead). */
function replyText(m: Pick<ChatItem, "content" | "pendingConfirm"> & { role?: string }): string {
  const q = m.pendingConfirm?.prompt;
  return q && m.content.trim().endsWith(q) ? m.content.trim().slice(0, -q.length).trim() : m.content;
}

const flat = (s: string) => s.replace(/^- /gm, "").replace(/\s+/g, " ").trim();

function RoundButton({ label, onClick, disabled, className, children }: { label: string; onClick: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn("grid size-9 shrink-0 place-items-center rounded-full bg-[#F3EDE0] transition-colors hover:bg-[#EAE2D0] disabled:opacity-40", className)}
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

/** Darwin's reply: plain paragraphs and "- " bullet lists, no bubble. */
function Reply({ text, error }: { text: string; error?: boolean }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.split("\n"));
  return (
    <div className={cn("flex flex-col gap-2.5 text-[16px] leading-[1.55]", error && "rounded-[20px] bg-[#FBE7D3] px-[18px] py-3 text-[#8A4A14]")}>
      {blocks.map((lines, i) =>
        lines.every((l) => /^\s*[-•]\s+/.test(l)) ? (
          <ul key={i} className="m-0 flex list-disc flex-col gap-1 pl-5">
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
  const s = tone === "warn" ? { background: "#FBE7D3", color: "#8A4A14" } : tone === "win" ? { background: "#DDF3E8", color: "#137A52" } : { background: "rgba(255,255,255,0.6)", color: INK };
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium tracking-[0.02em]" style={{ ...s, ...MONO }}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ agent-to-agent threads */

function TypingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((k) => (
        <motion.span key={k} className="size-1.5 rounded-full" style={{ background: INK }} animate={{ opacity: [0.2, 1, 0.2], y: [0, -2, 0] }} transition={{ duration: 0.9, repeat: Infinity, delay: k * 0.15 }} />
      ))}
    </span>
  );
}

/** A compact exchange between crew members ("Darwin → Mika"), distinct from the reply. Fresh ones play message by message. */
function Thread({ thread, play }: { thread: ThreadView; play?: boolean }) {
  const reduce = useReducedMotion();
  const total = thread.messages.length;
  const [shown, setShown] = useState(play && !reduce ? 0 : total);
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 350 : 750);
    return () => clearTimeout(t);
  }, [shown, total]);
  const visible = thread.messages.slice(0, shown);
  const msgs = all ? visible : visible.slice(0, 8);
  const next = shown < total ? thread.messages[shown] : undefined;
  const names = (thread.agents.length ? thread.agents : [...new Set(thread.messages.map((m) => m.from))]).map((n) => whoIs(n).name);
  return (
    <div className="flex flex-col gap-2 rounded-[20px] border border-[#E8DFCC] bg-[#F7F1E5] px-4 py-3" data-agent-thread>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex -space-x-1.5">
          {(thread.agents.length ? thread.agents : names).slice(0, 3).map((n) => (
            <ThreadFace key={n} name={n} size={20} />
          ))}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] tracking-[0.04em] text-[#6B665C] uppercase" style={MONO}>
          Agent to agent · {names.join(" ↔ ")}
        </span>
        {thread.synthetic && <Pill tone="sand">simulated shopper</Pill>}
      </div>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {msgs.map((m, i) => (
          <motion.li key={i} className="flex gap-2.5" initial={play && !reduce ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
            <span className="mt-0.5 shrink-0">
              <ThreadFace name={m.from} />
            </span>
            <p className="m-0 min-w-0 text-[14px] leading-[1.45] break-words">
              <span className="font-semibold">
                {whoIs(m.from).name}
                {m.to && <span className="font-normal text-[#6B665C]"> → {whoIs(m.to).name}</span>}
              </span>
              <span className="text-[#6B665C]">: </span>
              <span className="text-[#2B2925]">{m.text}</span>
            </p>
          </motion.li>
        ))}
        {next && (
          <li className="flex items-center gap-2.5" aria-hidden>
            <ThreadFace name={next.from} thinking />
            <span className="text-[13px] text-[#6B665C]">{whoIs(next.from).name} is typing</span>
            <TypingDots />
          </li>
        )}
      </ol>
      {!next && total > msgs.length && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-[13px] font-medium underline underline-offset-2">
          Show all {total} messages
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ result + confirm cards */

/** What Darwin did this turn, as pastel result cards. */
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
                className="mt-auto flex h-9 items-center self-start rounded-full px-4 text-[14px] font-medium no-underline"
                style={{ background: INK, color: CREAM }}
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
            className="flex h-10 items-center rounded-full px-[18px] text-[14px] font-medium disabled:opacity-40"
            style={{ background: INK, color: CREAM }}
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(false)}
            className="flex h-10 items-center rounded-full bg-[#FFFDF8] px-[18px] text-[14px] font-medium shadow-[0_0_0_1px_#E8DFCC] disabled:opacity-40"
            style={{ color: INK }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
