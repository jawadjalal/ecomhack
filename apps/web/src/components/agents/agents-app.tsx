"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, RefreshCw, Store } from "lucide-react";
import type { AgentFunnel, AgentTestResult, AgentTestState, Catalog, Lever } from "@/lib/store-agent";
import { cn } from "@/components/ui/cn";
import { WhopLogo } from "@/components/dw/brand-logos";
import { PageHead, PillButton, Tag } from "@/components/dw/ui";
import { StoreAvatar } from "@/components/dw/agents/avatars";
import { ChatCard, type ChatLine, type ChatOffer } from "@/components/dw/agents/chat-card";
import { ConnectCard, OffersCard } from "@/components/dw/agents/connect-card";
import { SalesCard } from "@/components/dw/agents/sales-card";
import { TestsCard } from "@/components/dw/agents/tests-card";

const SIM_BUYER = "darwin-buyer (simulated)";

interface ReplyData {
  offers?: ChatOffer[];
  facts?: string[];
  checkout?: { url: string; title: string; tagged?: boolean };
}

/** /console/agents: the Whop store's own AI agent, in the Darwin app shell. */
export function AgentsApp({ origin }: { origin: string }) {
  const [stats, setStats] = useState<{ catalog: Catalog; funnel: AgentFunnel }>();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const contextId = useRef<string | undefined>(undefined);
  const [tests, setTests] = useState<{ state: AgentTestState; results: AgentTestResult[] }>();
  const [simOn, setSimOn] = useState(false);
  const ticking = useRef(false);
  const endpoint = `${origin}/a2a/whop`;

  const load = useCallback(async (fresh = false) => {
    const [res, t] = await Promise.all([fetch(`/api/store-agent/stats${fresh ? "?fresh=1" : ""}`, { cache: "no-store" }), fetch("/api/store-agent/tests", { cache: "no-store" })]);
    if (res.ok) setStats(await res.json());
    if (t.ok) setTests(await t.json());
  }, []);
  useEffect(() => {
    const first = setTimeout(() => load(), 0);
    const t = setInterval(() => load(), 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  /** Talk to the store agent over the real A2A endpoint, exactly as an outside agent would. */
  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setText("");
    setLines((l) => [...l, { from: "you", text: message, buyer: "console (you)" }, { from: "store", text: "", pending: true }]);
    try {
      const res = await fetch("/a2a/whop", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-name": "console (you)" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "SendMessage",
          params: { message: { role: "ROLE_USER", messageId: `m${Date.now()}`, ...(contextId.current ? { contextId: contextId.current } : {}), parts: [{ text: message }] } },
        }),
      });
      const json = await res.json();
      const msg = json.result?.message;
      if (!msg) throw new Error(json.error?.message ?? "No reply");
      contextId.current = msg.contextId;
      const data = msg.parts.find((p: { data?: unknown }) => p.data)?.data as ReplyData | undefined;
      setLines((l) => [
        ...l.filter((x) => !x.pending),
        { from: "store", text: msg.parts[0].text, offers: data?.offers, facts: data?.facts, checkout: data?.checkout && { url: data.checkout.url, title: data.checkout.title, tagged: data.checkout.tagged } },
      ]);
      await load();
    } catch (e) {
      setLines((l) => [...l.filter((x) => !x.pending), { from: "store", text: `Error: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const testsPost = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/store-agent/tests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) setTests(await res.json());
      await load();
    },
    [load],
  );

  // Simulated buyer agents every 3 s while on (labelled); each batch also lets autopilot decide.
  useEffect(() => {
    if (!simOn) return;
    const t = setInterval(async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        await testsPost({ buyers: 80, step: true });
      } finally {
        ticking.current = false;
      }
    }, 3000);
    return () => clearInterval(t);
  }, [simOn, testsPost]);

  const runBuyer = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/store-agent/buyer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: "Trail running coaching under £40 a month" }) });
      const out = (await res.json()) as { transcript: { from: "buyer" | "store"; text: string }[] };
      setLines((l) => [
        ...l,
        ...out.transcript.map((t): ChatLine => (t.from === "buyer" ? { from: "you", text: t.text, buyer: SIM_BUYER, simulated: true } : { from: "store", text: t.text })),
      ]);
      await load();
    } finally {
      setRunning(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  };

  const f = stats?.funnel;
  const cat = stats?.catalog;
  const lede = f?.conversations
    ? `${f.conversations.toLocaleString("en-GB")} buyer-agent conversation${f.conversations === 1 ? "" : "s"} so far${f.simulated ? ` (${f.simulated.toLocaleString("en-GB")} simulated)` : ""}, and ${Math.round(f.conversion * 100)}% ended in a payment.`
    : "AI shoppers ask it what you sell, and buy through a checkout link that credits them.";

  return (
    <>
      <PageHead
        mascot={<StoreAvatar size={52} />}
        title="Your store agent"
        lede={lede}
        right={
          <>
            {cat?.source === "whop" && (
              <Tag tone="white" className="h-10 gap-2 px-4 text-[14px]">
                <WhopLogo size={16} /> {cat.business}
              </Tag>
            )}
            <PillButton tone="sand" onClick={refresh} disabled={refreshing} title="Re-read the Whop catalog now">
              <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh catalog
            </PillButton>
          </>
        }
      />

      {cat?.source === "demo" && (
        <div role="note" title={cat.note} className="-mt-1 flex min-h-10 items-center gap-2.5 rounded-full bg-dw-warn-bg py-1.5 pr-1.5 pl-4 text-[13.5px] text-dw-warn">
          <Store className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 leading-snug sm:truncate">
            <b className="font-semibold">Demo catalog.</b> No Whop business connected yet: demo offers, and payments on the demo checkout are simulated and labelled.
          </p>
          <Link
            href="/onboarding"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-white/75 px-3 text-[12.5px] font-medium text-dw-ink transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
          >
            <WhopLogo size={13} /> Connect Whop <ArrowRight className="size-3.5" />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ChatCard lines={lines} text={text} onText={setText} onSend={send} busy={busy} running={running} onRunBuyer={runBuyer} demo={cat?.source !== "whop"} />
        <SalesCard funnel={f} />
      </div>

      <TestsCard
        tests={tests}
        simOn={simOn}
        onSim={setSimOn}
        onAutopilot={(on) => {
          testsPost({ autopilot: on });
          if (on && !f?.conversations) setSimOn(true);
        }}
        onStart={(lever: Lever) => testsPost({ start: lever })}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <OffersCard catalog={cat} />
        <ConnectCard endpoint={endpoint} />
      </div>
    </>
  );
}
