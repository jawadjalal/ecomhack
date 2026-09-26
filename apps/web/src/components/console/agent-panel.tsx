"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, ChevronRight, Handshake, LoaderCircle, Send, X } from "lucide-react";
import { useSWRConfig } from "swr";
import type { AgentSessionSummary } from "@/lib/contracts";
import { money, timeAgo } from "@/lib/console/format";
import { useApi, useHotkeys, useNow } from "@/lib/console/hooks";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Badge, Tag } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

function pickDefault(sessions: AgentSessionSummary[]): AgentSessionSummary | undefined {
  const recent = sessions.slice(0, 6);
  // A real agent (the server lists recent ones first) beats any simulated one.
  return (
    recent.find((s) => !s.synthetic) ??
    recent.find((s) => s.negotiation?.length && s.outcome === "purchased") ??
    recent.find((s) => s.negotiation?.length) ??
    sessions[0]
  );
}

/** How the agent reached the store, from the session id prefix (a2a_ / mcp_). */
function transport(s: AgentSessionSummary): "A2A" | "MCP" | undefined {
  return s.sessionId.startsWith("a2a_") ? "A2A" : s.sessionId.startsWith("mcp_") ? "MCP" : undefined;
}

function Outcome({ s }: { s: AgentSessionSummary }) {
  if (s.outcome === "purchased") return <Badge tone="good">Purchased{s.orderTotal ? ` · ${money(s.orderTotal)}` : ""}</Badge>;
  if (s.outcome === "abandoned") return <Badge tone="bad">Abandoned</Badge>;
  return <Badge tone="info">In progress</Badge>;
}

function GoalChips({ s }: { s: AgentSessionSummary }) {
  const g = s.goal;
  if (!g) return null;
  const chips = [
    g.maxBudget ? `≤ ${money(g.maxBudget)}` : undefined,
    g.size ? `UK ${g.size}` : undefined,
    g.deadlineDays ? `in ${g.deadlineDays}d` : undefined,
    g.requiresFreeReturns ? "free returns" : undefined,
    g.negotiates ? "negotiates" : undefined,
  ].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[0.68rem] text-white/55">
          {c}
        </span>
      ))}
    </div>
  );
}

function Detail({ s }: { s: AgentSessionSummary }) {
  const now = useNow();
  return (
    <motion.div
      key={s.sessionId}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22 }}
      className="flex min-h-0 flex-1 flex-col gap-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-agent/15 text-[0.9rem]">🤖</span>
        <span className="truncate text-[0.95rem] font-semibold text-white">{s.agentName}</span>
        <Outcome s={s} />
        {transport(s) && (
          <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[0.62rem] text-white/50" title={transport(s) === "A2A" ? "Talking to the merchant agent over A2A (plain English)" : "Calling the store's tools over MCP"}>
            {transport(s)}
          </span>
        )}
        <div className="flex-1" />
        {s.synthetic ? (
          <Tag>Synthetic</Tag>
        ) : (
          <Tag className="border-good/40 bg-good/10 text-[#8ff0b2]" title="A real AI agent connected over MCP/REST, not simulated">
            Real
          </Tag>
        )}
        <span className="text-[0.7rem] text-white/30 tabular">{now ? timeAgo(s.startedAt, now) : ""}</span>
      </div>
      {!s.synthetic && !s.goal?.brief && (
        <div className="rounded-lg border-l-2 border-good/50 bg-good/[0.04] px-3 py-1.5 text-[0.8rem] text-white/70">
          A real agent connected {transport(s) ? `over ${transport(s)}` : "over the REST API"}, not the simulator.
          Every tool call below is live.
        </div>
      )}
      {s.goal?.brief && (
        <div className="rounded-lg border-l-2 border-agent/50 bg-white/[0.025] px-3 py-1.5">
          <div className="text-[0.84rem] text-white/80 italic">“{s.goal.brief}”</div>
          <div className="mt-1">
            <GoalChips s={s} />
          </div>
        </div>
      )}
      {/* tool timeline */}
      <div className="flex flex-wrap items-center gap-1">
        {s.toolCalls.map((c, i) => (
          <span key={`${c.tool}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-white/20" />}
            <span
              title={c.missing?.length ? `missing: ${c.missing.join(", ")}` : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[0.66rem]",
                !c.ok ? "border-bad/35 bg-bad/10 text-[#ff9b9b]" : c.missing?.length ? "border-warn/35 bg-warn/10 text-[#ffd27a]" : "border-white/10 bg-white/[0.04] text-white/65",
              )}
            >
              {c.ok ? "✓" : "✗"} {c.tool}
              {c.missing?.length ? <span className="opacity-75">· no {c.missing.join(", ")}</span> : null}
            </span>
          </span>
        ))}
      </div>
      {/* negotiation */}
      {s.negotiation?.length ? (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
          {s.negotiation.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: t.from === "buyer" ? -10 : 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.12 }}
              className={cn("flex items-end gap-1.5", t.from === "merchant" && "flex-row-reverse")}
            >
              <span className="mb-0.5 text-[0.9rem]">{t.from === "buyer" ? "🤖" : "🏪"}</span>
              <div
                className={cn(
                  "max-w-[82%] rounded-2xl px-3 py-1.5 text-[0.8rem] leading-snug",
                  t.from === "buyer" ? "rounded-bl-sm bg-agent/12 text-white/80" : "rounded-br-sm bg-brand/10 text-white/80",
                )}
              >
                {t.message}
                {t.offer !== undefined && (
                  <span
                    className={cn(
                      "ml-1.5 inline-block rounded-md px-1.5 text-[0.7rem] font-semibold tabular",
                      t.from === "buyer" ? "bg-agent/20 text-[#f5a6cb]" : "bg-brand/20 text-brand",
                    )}
                  >
                    {money(t.offer)}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-[0.76rem] text-white/30">No negotiation in this session.</div>
      )}
      {s.outcome === "abandoned" && s.reason && (
        <div className="mt-auto rounded-lg bg-bad/[0.08] px-3 py-1.5 text-[0.8rem] text-[#ffb4b4]">
          <span className="font-semibold">Left because:</span> {s.reason}
        </div>
      )}
    </motion.div>
  );
}

const BRIEFS = [
  "Trail shoes, UK 10, under £140, delivered by Friday",
  "Carbon race shoe, UK 8, best price you can get",
  "Hydration vest for an ultra, free returns only",
];

function ShopperBox({ onClose, onDone }: { onClose: () => void; onDone: (s: AgentSessionSummary) => void }) {
  const api = useApi();
  const [brief, setBrief] = useState(BRIEFS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { session } = await api.sendShopper(brief.trim());
      onDone(session);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.form
      onSubmit={send}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="flex flex-col gap-2 rounded-xl border border-agent/25 bg-agent/[0.05] p-3"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex items-center justify-between text-[0.76rem] font-medium text-white/70">
        <span className="flex items-center gap-1.5">
          <Bot className="size-3.5 text-agent" /> Send an AI shopper with a brief
        </span>
        <button type="button" onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          autoFocus
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 text-[0.82rem] text-white outline-none focus:border-agent/50"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-agent px-3 text-[0.8rem] font-semibold text-white disabled:opacity-60"
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {busy ? "Shopping…" : "Send"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {BRIEFS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBrief(b)}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[0.66rem] transition-colors",
              b === brief ? "bg-white/12 text-white/85" : "bg-white/[0.04] text-white/45 hover:text-white/75",
            )}
          >
            {b}
          </button>
        ))}
      </div>
      {error && <div className="text-[0.74rem] text-[#ff9b9b]">{error}</div>}
    </motion.form>
  );
}

export function AgentPanel({ sessions }: { sessions?: AgentSessionSummary[] }) {
  const api = useApi();
  const { mutate } = useSWRConfig();
  const [pinned, setPinned] = useState<string | null>(null);
  const [shopping, setShopping] = useState(false);
  const [sent, setSent] = useState<AgentSessionSummary | null>(null);
  useHotkeys({ s: () => setShopping(true) });
  const fromServer = sessions ?? [];
  // the shopper we just sent stays visible even before the sessions list refreshes
  const list = sent && !fromServer.some((s) => s.sessionId === sent.sessionId) ? [sent, ...fromServer] : fromServer;
  // follow the most interesting recent session, but switch at most every 6s so it stays readable
  const candidate = pickDefault(list)?.sessionId;
  const [autoId, setAutoId] = useState<string | undefined>(undefined);
  const lastSwitch = useRef(0);
  useEffect(() => {
    if (!candidate || candidate === autoId) return;
    const wait = autoId ? Math.max(0, 6000 - (Date.now() - lastSwitch.current)) : 0;
    const t = setTimeout(() => {
      lastSwitch.current = Date.now();
      setAutoId(candidate);
    }, wait);
    return () => clearTimeout(t);
  }, [candidate, autoId]);
  const find = (id?: string | null) => (id ? list.find((s) => s.sessionId === id) : undefined);
  const selected = find(pinned) ?? find(autoId) ?? pickDefault(list);
  const purchased = list.filter((s) => s.outcome === "purchased").length;

  return (
    <Panel className="h-full">
      <PanelHeader
        icon={<Handshake />}
        title="Agent-to-agent"
        right={
          <div className="flex items-center gap-2">
            {list.length > 0 && (
              <span className="text-[0.74rem] text-white/45 tabular" title={`${purchased} of the last ${list.length} agent sessions bought`}>
                <span className="font-semibold text-[#7ee2a0]">{purchased}</span>/{list.length}
              </span>
            )}
            <button
              onClick={() => setShopping((v) => !v)}
              title="Send an AI shopper (S)"
              className="flex h-7 items-center gap-1.5 rounded-lg border border-agent/30 bg-agent/10 px-2 text-[0.72rem] font-medium text-[#f5a6cb] hover:bg-agent/20"
            >
              <Bot className="size-3.5" /> Send shopper
            </button>
          </div>
        }
      />
      <AnimatePresence>
        {shopping && (
          <motion.div key="shopper" className="px-5 pb-3" exit={{ opacity: 0 }}>
            <ShopperBox
              onClose={() => setShopping(false)}
              onDone={(s) => {
                setSent(s);
                setPinned(s.sessionId);
                setShopping(false);
                void mutate((key) => Array.isArray(key) && key[0] === api.mode && key[1] === "sessions");
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {list.length === 0 && !shopping ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center text-[0.85rem] text-white/35">
          <Handshake className="size-6 text-white/15" />
          Buyer agents discover the store via llms.txt, shop over MCP and negotiate with Darwin&apos;s merchant agent.
        </div>
      ) : list.length === 0 ? null : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-4">
          <div className="flex gap-1.5 overflow-hidden">
            {list.slice(0, 7).map((s) => {
              const active = selected?.sessionId === s.sessionId;
              return (
                <button
                  key={s.sessionId}
                  onClick={() => setPinned(active && pinned ? null : s.sessionId)}
                  title={`${s.agentName}: ${s.goal?.brief ?? ""} (${s.outcome})`}
                  className={cn(
                    "relative flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[0.72rem] transition-colors",
                    active ? "border-white/25 bg-white/[0.08] text-white" : "border-white/[0.07] bg-white/[0.02] text-white/50 hover:text-white/80",
                    !s.synthetic && "border-good/40 text-[#8ff0b2]",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      s.outcome === "purchased" ? "bg-good" : s.outcome === "abandoned" ? "bg-bad" : "bg-sky-400",
                    )}
                  />
                  <span className="max-w-[5.5rem] truncate">{s.agentName.replace(/-(shopper|buyer|agent)$/, "")}</span>
                  {transport(s) === "A2A" ? <span>💬</span> : s.negotiation?.length ? <span>🤝</span> : null}
                  {active && pinned && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-brand" title="Pinned" />}
                </button>
              );
            })}
          </div>
          <AnimatePresence mode="wait">{selected && <Detail key={selected.sessionId} s={selected} />}</AnimatePresence>
        </div>
      )}
    </Panel>
  );
}
