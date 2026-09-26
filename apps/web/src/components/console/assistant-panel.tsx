"use client";

/**
 * The team chat at the bottom of every console page.
 *
 * Collapsed: a prompt bar with Darwin. Expanded: a sheet with a tab per chat (Darwin, direct chats with a
 * teammate, group chats where the team works together), a strip showing what each teammate is doing,
 * the conversation, and a composer with the Type | Voice switch. Escape collapses it.
 *
 * Data: ../team/use-team.ts (GET /api/team, NDJSON from POST /api/team/chat, POST /api/team/chats).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, ChevronDown, ChevronUp, Maximize2, Minimize2, Plus, X } from "lucide-react";
import type { AgentId, ChatMessage, TeamAgent } from "@/lib/contracts";
import { VoiceBar, VoiceToggle, useVoice, type VoiceMode } from "@/components/voice";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotState } from "./mascot";
import { useTeam } from "@/components/team/use-team";
import { FALLBACK_AGENTS, GROUP_STARTERS, STARTERS, friendlyNote, lookFor, type AgentLook } from "@/components/team/roster";
import { DARWIN_TAB, chatWorking, displayState, tabChatId, tabMessages, type DisplayState, type TabRef, type TeamUiState } from "@/components/team/team-state";
import { INK, MessageList } from "@/components/team/team-messages";

const FONT = { fontFamily: "var(--font-outfit), var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" };
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413]";

const asMascot = (s: DisplayState): MascotState => s;

/** What a teammate is up to, in a few words. */
function statusLine(look: AgentLook, s: DisplayState, note?: string): string {
  if (s === "working") return note || "Working on it";
  if (s === "thinking") return note || "Thinking";
  if (s === "success") return note || "Done";
  if (s === "error") return "Hit a snag";
  if (s === "sleeping") return "Resting";
  return look.role;
}

function chatTitle(s: TeamUiState, tab: TabRef, agents: TeamAgent[]): string {
  if (tab.kind === "direct") return lookFor(agents, tab.agent).name;
  const chat = s.chats[tab.chatId];
  if (chat?.title) return chat.title;
  return (chat?.members ?? []).map((m) => lookFor(agents, m).name).join(", ") || "Group";
}

function members(s: TeamUiState, tab: TabRef): AgentId[] {
  return tab.kind === "direct" ? [tab.agent] : (s.chats[tab.chatId]?.members ?? []);
}

/* ------------------------------------------------------------------ panel */

export function AssistantPanel() {
  const replyRef = useRef<((m: ChatMessage) => void) | null>(null);
  const onReply = useCallback((m: ChatMessage) => replyRef.current?.(m), []);
  const team = useTeam({ onReply });
  const { state, now, mountedAt } = team;
  const agents = state.agents.length ? state.agents : FALLBACK_AGENTS;
  const pathname = usePathname();

  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("type");

  const tab = state.tabs.find((t) => t.key === state.active) ?? state.tabs[0];
  const chatId = tabChatId(tab);
  const messages = tabMessages(state, tab);
  const busy = !!state.busy[tab.key];
  const open = state.open;

  const sheetInput = useRef<HTMLInputElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const liveOf = useCallback((id: AgentId) => displayState(state.status[id], now, mountedAt), [state.status, now, mountedAt]);

  /* ---------------------------------------------------------------- sending */

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || busy) return;
      team.send(tab.key, text);
      setDraft("");
      setPicker(false);
      team.setOpen(true);
    },
    [busy, team, tab.key],
  );

  /* ---------------------------------------------------------------- voice */

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  const voice = useVoice({ onTranscript: (text) => sendRef.current(text) });
  const { speak, setThinking } = voice;
  const speakRef = useRef<{ mode: VoiceMode; chatId?: string; agent?: AgentId }>({ mode: "type" });
  useEffect(() => {
    speakRef.current = { mode, chatId, agent: tab.kind === "direct" ? tab.agent : undefined };
  }, [mode, chatId, tab]);
  useEffect(() => {
    replyRef.current = (m) => {
      const cur = speakRef.current;
      if (cur.mode !== "voice") return;
      if (m.chatId === cur.chatId || (!cur.chatId && m.from === cur.agent)) void speak(m.text, m.from);
    };
  }, [speak]);
  useEffect(() => {
    if (mode === "voice") setThinking(busy);
  }, [mode, busy, setThinking]);

  /* ---------------------------------------------------------------- open / close */

  const collapse = useCallback(() => {
    team.setOpen(false);
    setPicker(false);
    setTimeout(() => openButton.current?.focus({ preventScroll: true }), 50);
  }, [team]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => sheetInput.current?.focus({ preventScroll: true }), 120);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (picker) setPicker(false);
      else collapse();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, picker, collapse]);

  // Keep the newest message in view.
  const lastId = messages[messages.length - 1]?.id;
  const liveProgress = useMemo(() => {
    if (!chatId) return [];
    return Object.values(state.progress[chatId] ?? {}).filter((p): p is NonNullable<typeof p> => !!p && ["working", "thinking"].includes(state.status[p.agent]?.state ?? ""));
  }, [chatId, state.progress, state.status]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastId, liveProgress.length, busy, open, state.active, picker]);

  /* ---------------------------------------------------------------- derived */

  const darwinState = liveOf("darwin");
  const working = agents.filter((a) => ["working", "thinking"].includes(liveOf(a.id)));
  const tabLook = tab.kind === "direct" ? lookFor(agents, tab.agent) : undefined;
  const thinkingAgent: AgentId | undefined = busy ? (tab.kind === "direct" ? tab.agent : "darwin") : undefined;
  const suggestions = state.suggestions[tab.key]?.length
    ? state.suggestions[tab.key]
    : tab.kind === "group"
      ? GROUP_STARTERS
      : STARTERS[tabLook?.mascot ?? "analyst"].slice(0, 3);
  const placeholder = tab.kind === "group" ? "Message the group" : tab.agent === "darwin" ? "Ask Darwin anything" : `Message ${tabLook?.name}`;

  return (
    <div style={FONT} data-assistant>
      <style>{`@keyframes dw-typing{0%,100%{opacity:.25}50%{opacity:1}}.dw-typing{animation:dw-typing 1s ease-in-out infinite}@keyframes dw-pulse{0%,100%{box-shadow:0 0 0 0 rgba(31,181,122,.45)}50%{box-shadow:0 0 0 4px rgba(31,181,122,0)}}.dw-live{animation:dw-pulse 1.6s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.dw-typing,.dw-live{animation:none}}`}</style>
      {/* room under the page for the prompt bar (mission control reserves its own) */}
      {pathname !== "/console" && <div aria-hidden className="h-[96px]" />}

      {/* ------------------------------------------------ collapsed prompt bar */}
      {!open && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(760px,calc(100vw-24px))] -translate-x-1/2 sm:bottom-[22px]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) send(draft);
              else team.setOpen(true);
            }}
            style={{ color: INK }}
            className="flex h-[60px] w-full items-center gap-2 rounded-full bg-white pr-2 pl-2.5 shadow-[0_0_0_1px_#E8DFCC,0_16px_40px_rgba(20,20,19,0.10)] sm:gap-3"
          >
            <Mascot kind="analyst" state={asMascot(darwinState)} size={42} label="Darwin: say hi" />
            <label htmlFor="dw-team-bar" className="sr-only">
              Ask Darwin
            </label>
            <input
              id="dw-team-bar"
              type="text"
              autoComplete="off"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPointerDown={() => team.setOpen(true)}
              placeholder="Ask Darwin anything about your store"
              maxLength={2000}
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#8C8676]"
              style={{ color: INK }}
            />
            {working.length > 0 && (
              <button
                type="button"
                onClick={() => team.setOpen(true)}
                className={cn("hidden h-9 shrink-0 items-center gap-2 rounded-full bg-[#F7F1E5] pr-3 pl-1.5 text-[13px] font-medium sm:flex", FOCUS)}
                aria-label={`${working.length} teammates at work. Open the team chat`}
              >
                <Stack kinds={working.map((a) => lookFor(agents, a.id).mascot)} size={22} />
                {working.length} at work
              </button>
            )}
            <button
              ref={openButton}
              type="button"
              onClick={() => team.setOpen(true)}
              aria-label="Open the team chat"
              title="Open the team chat"
              className={cn("relative grid size-10 shrink-0 place-items-center rounded-full bg-[#F3EDE0] transition-colors hover:bg-[#EAE2D0]", FOCUS)}
            >
              <ChevronUp className="size-[18px]" />
              {Object.values(state.unread).some(Boolean) && (
                <span className="absolute top-1 right-1 size-2.5 rounded-full bg-[#F0579E] ring-2 ring-white" role="img" aria-label="New messages" />
              )}
            </button>
            <SendButton size={44} disabled={busy} />
          </form>
        </div>
      )}

      {/* ------------------------------------------------ sheet */}
      <AnimatePresence>
        {open && (
          <motion.section
            key="sheet"
            aria-label="Team chat"
            data-assistant-panel
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 32 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 box-border flex flex-col overflow-hidden rounded-t-[24px] bg-white shadow-[0_0_0_1px_#EDE4D2,0_-24px_60px_rgba(20,20,19,0.12)] sm:inset-x-6 sm:rounded-t-[28px]"
            style={{ ...FONT, color: INK, height: expanded ? "calc(100dvh - 12px)" : "min(660px, calc(100dvh - 40px))", transition: "height .3s cubic-bezier(.2,.8,.2,1)" }}
          >
            {/* tabs */}
            <header className="flex shrink-0 items-center gap-1.5 px-3 pt-3 pb-2 sm:px-5">
              <div className="flex min-w-0 flex-1">
                <div role="tablist" aria-label="Chats" className="flex max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-[#F3EDE0] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {state.tabs.map((t) => (
                    <Tab
                      key={t.key}
                      tab={t}
                      active={t.key === tab.key && !picker}
                      title={chatTitle(state, t, agents)}
                      members={members(state, t).map((m) => lookFor(agents, m))}
                      state={t.kind === "direct" ? liveOf(t.agent) : "idle"}
                      working={chatWorking(state, tabChatId(t), t.key)}
                      unread={(tabChatId(t) && state.unread[tabChatId(t)!]) || 0}
                      onSelect={() => {
                        setPicker(false);
                        team.activate(t.key);
                      }}
                      onClose={t.key === DARWIN_TAB ? undefined : () => team.closeTab(t.key)}
                    />
                  ))}
                </div>
              </div>
              <RoundButton label="New chat" onClick={() => setPicker((p) => !p)} pressed={picker}>
                <Plus className="size-[17px]" />
              </RoundButton>
              <RoundButton label={expanded ? "Make smaller" : "Make bigger"} onClick={() => setExpanded((x) => !x)} className="hidden sm:grid">
                {expanded ? <Minimize2 className="size-[15px]" /> : <Maximize2 className="size-[15px]" />}
              </RoundButton>
              <RoundButton label="Close the chat (Esc)" onClick={collapse}>
                <ChevronDown className="size-[18px]" />
              </RoundButton>
            </header>

            {/* team strip */}
            <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#F0E9DA] px-3 pb-2.5 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden" aria-label="Your team">
              {agents.map((a) => {
                const look = lookFor(agents, a.id);
                const s = liveOf(a.id);
                const line = statusLine(look, s, friendlyNote(state.status[a.id]?.note, look.name));
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setPicker(false);
                      if (a.id === "darwin") team.activate(DARWIN_TAB);
                      else team.openDirect(a.id);
                    }}
                    title={`${look.name}: ${line}`}
                    aria-label={`${look.name}, ${line}. Chat with ${look.name}`}
                    className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-0.5 text-left transition-colors hover:bg-[#F7F1E5]", FOCUS)}
                  >
                    <Mascot kind={look.mascot} state={asMascot(s)} size={36} interactive={false} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="text-[13px] font-semibold">{look.name}</span>
                      <span className={cn("max-w-[150px] truncate text-[12px]", s === "working" || s === "thinking" ? "text-[#137A52]" : s === "error" ? "text-[#B8621B]" : "text-[#8C8676]")}>{line}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* body */}
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-3 sm:px-7">
              <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
                {picker ? (
                  <Picker
                    agents={agents}
                    onCancel={() => setPicker(false)}
                    onDirect={(id) => {
                      setPicker(false);
                      if (id === "darwin") team.activate(DARWIN_TAB);
                      else team.openDirect(id);
                    }}
                    onGroup={async (ids) => {
                      const err = await team.openGroup(ids);
                      if (!err) setPicker(false);
                      return err;
                    }}
                  />
                ) : messages.length === 0 ? (
                  <Welcome tab={tab} agents={agents} memberLooks={members(state, tab).map((m) => lookFor(agents, m))} starters={tab.kind === "group" ? GROUP_STARTERS : STARTERS[tabLook?.mascot ?? "analyst"]} busy={busy} onPick={send} />
                ) : (
                  <MessageList
                    messages={messages}
                    agents={agents}
                    live={liveProgress}
                    thinking={thinkingAgent}
                    busy={busy}
                    onConfirm={(m, ok) => m.pendingConfirm && team.answerConfirm(tab.key, m.chatId, m.pendingConfirm.id, ok)}
                  />
                )}
              </div>
            </div>

            {/* composer */}
            {!picker && (
              <div className="shrink-0 px-3 pt-1.5 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-7">
                <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2">
                  {messages.length > 0 && !busy && mode === "type" && (
                    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => send(s)}
                          className={cn("h-8 shrink-0 rounded-full bg-[#F7F1E5] px-3.5 text-[13px] font-medium whitespace-nowrap shadow-[inset_0_0_0_1px_#EDE4D2] transition-colors hover:bg-[#EDE6D6]", FOCUS)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {mode === "voice" ? (
                    <VoiceBar
                      voice={voice}
                      onClose={() => setMode("type")}
                      agentLabel={(id) => lookFor(agents, id as AgentId).name}
                      agentColor={(id) => lookFor(agents, id as AgentId).color}
                      className="shadow-[0_0_0_1px_#E8DFCC]"
                    />
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        send(draft);
                      }}
                      className="flex h-[54px] items-center gap-1.5 rounded-full bg-[#F3EDE0] pr-[7px] pl-4 sm:gap-2"
                    >
                      <label htmlFor="dw-team-input" className="sr-only">
                        {placeholder}
                      </label>
                      <input
                        ref={sheetInput}
                        id="dw-team-input"
                        type="text"
                        autoComplete="off"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={placeholder}
                        maxLength={2000}
                        className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#8C8676]"
                      />
                      <VoiceToggle mode={mode} onModeChange={setMode} voice={voice} size="sm" className="[&_[role=radiogroup]]:bg-white" />
                      <SendButton size={40} disabled={busy || !draft.trim()} />
                    </form>
                  )}
                </div>
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function SendButton({ size, disabled }: { size: number; disabled?: boolean }) {
  return (
    <button
      type="submit"
      aria-label="Send"
      disabled={disabled}
      className={cn("grid shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-40", FOCUS)}
      style={{ width: size, height: size, background: INK }}
    >
      <ArrowUp className="size-[18px]" strokeWidth={2} />
    </button>
  );
}

function RoundButton({ label, onClick, pressed, className, children }: { label: string; onClick: () => void; pressed?: boolean; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn("grid size-9 shrink-0 place-items-center rounded-full transition-colors", pressed ? "bg-[#141413] text-white" : "bg-[#F3EDE0] hover:bg-[#EAE2D0]", FOCUS, className)}
    >
      {children}
    </button>
  );
}

/** Overlapping member mascots (group tabs, the "at work" chip). */
function Stack({ kinds, size }: { kinds: AgentLook["mascot"][]; size: number }) {
  const shown = kinds.slice(0, 3);
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((k, i) => (
        <span key={`${k}${i}`} className="rounded-full bg-white" style={{ marginLeft: i ? -size * 0.42 : 0, zIndex: shown.length - i }}>
          <Mascot kind={k} size={size} interactive={false} />
        </span>
      ))}
    </span>
  );
}

function Tab({
  tab,
  active,
  title,
  members,
  state,
  working,
  unread,
  onSelect,
  onClose,
}: {
  tab: TabRef;
  active: boolean;
  title: string;
  members: AgentLook[];
  state: DisplayState;
  working: boolean;
  unread: number;
  onSelect: () => void;
  onClose?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const mascotState: MascotState = state === "sleeping" ? "idle" : state;
  return (
    <div ref={ref} className={cn("flex h-9 shrink-0 items-center rounded-full transition-colors", active ? "bg-white shadow-[0_1px_2px_rgba(20,20,19,0.10),0_0_0_1px_#E8DFCC]" : "hover:bg-[#EAE2D0]")}>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        className={cn("flex h-full items-center gap-1.5 rounded-full pl-1 text-[14px]", onClose ? "pr-1.5" : "pr-3", active ? "font-semibold" : "font-medium text-[#4A463D]", FOCUS)}
      >
        {tab.kind === "direct" ? <Mascot kind={members[0]?.mascot ?? "analyst"} state={mascotState} size={28} interactive={false} /> : <Stack kinds={members.map((m) => m.mascot)} size={24} />}
        <span className="max-w-[128px] truncate">{title}</span>
        {working && <span className="dw-live size-2 shrink-0 rounded-full bg-[#1FB57A]" aria-label="working" role="img" />}
        {unread > 0 && !active && (
          <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-[#F0579E] px-1 text-[11px] font-semibold text-white tabular-nums" aria-label={`${unread} new`}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          title="Close"
          className={cn("mr-1 grid size-6 shrink-0 place-items-center rounded-full text-[#8C8676] transition-colors hover:bg-[#F3EDE0] hover:text-[#141413]", FOCUS)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Welcome({ tab, agents, memberLooks, starters, busy, onPick }: { tab: TabRef; agents: TeamAgent[]; memberLooks: AgentLook[]; starters: string[]; busy: boolean; onPick: (s: string) => void }) {
  const look = tab.kind === "direct" ? lookFor(agents, tab.agent) : undefined;
  const names = memberLooks.map((m) => m.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const team = agents.filter((a) => a.id !== "darwin").map((a) => lookFor(agents, a.id));
  return (
    <div className="flex flex-col items-start gap-4 pt-2">
      <div className="flex items-center gap-3">
        {look ? <Mascot kind={look.mascot} size={64} lively /> : <Stack kinds={memberLooks.map((m) => m.mascot)} size={48} />}
        <div className="flex flex-col">
          <h2 className="m-0 text-[22px] font-semibold tracking-[-0.01em]">{look ? `Hi, I'm ${look.name}` : list}</h2>
          <p className="m-0 text-[14px] text-[#6B665A]">{look ? look.role : "Group chat"}</p>
        </div>
      </div>
      <p className="m-0 max-w-[560px] text-[15px] leading-[1.5] text-[#4A463D]">
        {look?.id === "darwin"
          ? `I run a small team: ${team.map((t) => `${t.name} (${t.role.toLowerCase()})`).join(", ")}. Tell me what you want and I'll hand out the work and report back.`
          : look
            ? look.blurb
            : "Give them a goal and they'll work it out together. You'll see each step as it happens."}
      </p>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {starters.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => onPick(s)}
            className={cn("flex min-h-12 items-center rounded-[16px] bg-[#F7F1E5] px-4 py-3 text-left text-[15px] font-medium shadow-[inset_0_0_0_1px_#EDE4D2] transition-colors hover:bg-[#EDE6D6] disabled:opacity-50", FOCUS)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Picker({
  agents,
  onCancel,
  onDirect,
  onGroup,
}: {
  agents: TeamAgent[];
  onCancel: () => void;
  onDirect: (id: AgentId) => void;
  onGroup: (ids: AgentId[]) => Promise<string | null>;
}) {
  const [picked, setPicked] = useState<AgentId[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: AgentId) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const names = picked.map((id) => lookFor(agents, id).name);
  const go = async () => {
    if (picked.length === 1) return onDirect(picked[0]);
    setSaving(true);
    setError(null);
    const err = await onGroup(picked);
    setSaving(false);
    if (err) setError(err);
  };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-[20px] font-semibold tracking-[-0.01em]">Start a chat</h2>
        <p className="m-0 text-[14px] text-[#6B665A]">Pick one teammate to talk to, or a few to start a group.</p>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2" aria-label="Teammates">
        {agents.map((a) => {
          const look = lookFor(agents, a.id);
          const on = picked.includes(a.id);
          return (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(a.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left transition-colors",
                  on ? "bg-white shadow-[inset_0_0_0_2px_#141413]" : "bg-[#F7F1E5] shadow-[inset_0_0_0_1px_#EDE4D2] hover:bg-[#EDE6D6]",
                  FOCUS,
                )}
              >
                <Mascot kind={look.mascot} size={48} interactive={false} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold">
                    {look.name} <span className="font-normal text-[#6B665A]">· {look.role}</span>
                  </span>
                  <span className="line-clamp-2 text-[13px] leading-[1.35] text-[#5C574B]">{look.blurb}</span>
                </span>
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", on ? "bg-[#141413] text-white" : "shadow-[inset_0_0_0_1.5px_#CFC7B6]")} aria-hidden>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="m-0 rounded-[14px] bg-[#FBE7D3] px-3 py-2 text-[14px] text-[#8A4A15]">{error}</p>}
      <div className="sticky bottom-0 flex items-center gap-2 bg-white pt-1 pb-1">
        <button
          type="button"
          disabled={!picked.length || saving}
          onClick={() => void go()}
          className={cn("flex h-11 items-center rounded-full bg-[#141413] px-5 text-[15px] font-medium text-white disabled:opacity-40", FOCUS)}
        >
          {picked.length === 0 ? "Pick a teammate" : picked.length === 1 ? `Chat with ${names[0]}` : saving ? "Starting…" : `Start a group with ${picked.length}`}
        </button>
        <button type="button" onClick={onCancel} className={cn("flex h-11 items-center rounded-full px-4 text-[15px] font-medium text-[#4A463D] hover:bg-[#F3EDE0]", FOCUS)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
