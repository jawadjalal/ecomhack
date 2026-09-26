"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowUp, Bot, Check, CircleStop, Copy, Cpu, ExternalLink, FlaskConical, LoaderCircle, MessagesSquare, Play, RefreshCw, Rocket, ShoppingBag, Store } from "lucide-react";
import type { AgentFunnel, AgentTestResult, AgentTestState, Catalog, Lever } from "@/lib/store-agent";
import { Toggle } from "@/components/ui/switch";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { DarwinWordmark } from "@/components/console/brand";

interface Line {
  from: "you" | "store";
  text: string;
  checkout?: { url: string; title: string };
  pending?: boolean;
}

const SUGGEST = ["Trail running coaching under £40 a month", "Something one-off under £20", "Buy the first one", "What do you sell?"];

const money = (minor: number, currency = "gbp") => new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(minor / 100);

export function AgentsApp({ origin }: { origin: string }) {
  const [stats, setStats] = useState<{ catalog: Catalog; funnel: AgentFunnel }>();
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
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
    setLines((l) => [...l, { from: "you", text: message }, { from: "store", text: "", pending: true }]);
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
      const data = msg.parts.find((p: { data?: unknown }) => p.data)?.data as { checkout?: { url: string; title: string } } | undefined;
      setLines((l) => [...l.filter((x) => !x.pending), { from: "store", text: msg.parts[0].text, checkout: data?.checkout }]);
      await load();
    } catch (e) {
      setLines((l) => [...l.filter((x) => !x.pending), { from: "store", text: `Error: ${(e as Error).message}` }]);
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
      setLines((l) => [...l, ...out.transcript.map((t) => ({ from: t.from === "buyer" ? ("you" as const) : ("store" as const), text: t.from === "buyer" ? `🤖 ${t.text}` : t.text }))]);
      await load();
    } finally {
      setRunning(false);
    }
  };

  const f = stats?.funnel;
  const cat = stats?.catalog;
  const curl = `curl -s ${endpoint} -H 'content-type: application/json' -H 'x-agent-name: my-agent' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"ROLE_USER","messageId":"m1","parts":[{"text":"coaching under £40 a month"}]}}}'`;
  const steps = f
    ? [
        { label: "Conversations", n: f.conversations },
        { label: "Saw offers", n: f.offersShown },
        { label: "Got a checkout link", n: f.checkouts },
        { label: "Paid", n: f.paid },
      ]
    : [];

  return (
    <div data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[110rem] flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/console" className="flex items-center gap-2 rounded-lg pr-2 text-white/60 hover:text-white" title="Back to mission control">
            <ArrowLeft className="size-4" />
            <DarwinWordmark sub="store agent" />
          </Link>
          <div className="h-7 w-px bg-white/10" />
          {cat &&
            (cat.source === "whop" ? (
              <Badge tone="good">
                <Store /> Whop · {cat.business}
              </Badge>
            ) : (
              <Badge tone="warn" title={cat.note}>
                <Store /> Demo catalog: {cat.note}
              </Badge>
            ))}
          <div className="flex-1" />
          <Button size="md" onClick={() => load(true)} title="Re-read the Whop catalog now">
            <RefreshCw /> Refresh catalog
          </Button>
        </header>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[24rem_minmax(0,1fr)_26rem]">
          {/* connect + catalog */}
          <div className="flex min-w-0 flex-col gap-4">
            <Panel glow>
              <PanelHeader icon={<Bot />} title="Connect any AI agent" />
              <div className="flex flex-col gap-3 px-5 pb-5 text-[0.82rem]">
                <p className="text-white/60">Shoppers&apos; agents (ChatGPT, Claude, Perplexity, your own) talk to your store here, get real offers, and buy through a checkout link that credits them.</p>
                <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 font-mono text-[0.78rem] text-brand">
                  <span className="min-w-0 flex-1 truncate">{endpoint}</span>
                  <button
                    onClick={() => navigator.clipboard?.writeText(endpoint).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1200)))}
                    className="text-white/50 hover:text-white"
                    aria-label="Copy endpoint"
                  >
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <a href="/a2a/whop/agent-card.json" target="_blank" className="flex items-center gap-1 text-white/55 hover:text-white">
                  Agent card (A2A v1.0 and v0.3) <ExternalLink className="size-3.5" />
                </a>
                <pre className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[0.7rem] leading-relaxed whitespace-pre text-white/70">{curl}</pre>
              </div>
            </Panel>
            <Panel>
              <PanelHeader icon={<ShoppingBag />} title="What it sells" right={cat && <span className="text-[0.72rem] text-white/40">{cat.offers.length} offers</span>} />
              <ul className="flex flex-col gap-2 px-5 pb-5">
                {cat?.offers.map((o) => (
                  <li key={o.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.8rem]">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-white/85">{o.title}</span>
                      <span className="shrink-0 font-mono text-white/70 tabular">
                        {money(o.price, o.currency)}
                        {o.billing !== "one_time" && <span className="text-white/40">/{o.billing}</span>}
                      </span>
                    </div>
                    {o.description && <div className="mt-0.5 text-white/45">{o.description}</div>}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          {/* chat */}
          <Panel className="min-h-[36rem]">
            <PanelHeader icon={<MessagesSquare />} title="Talk to it like a buyer agent" right={<Badge tone="outline">over the real A2A endpoint</Badge>} />
            <div className="flex flex-1 flex-col gap-3 px-5 pb-5">
              <div className="flex min-h-[22rem] flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-white/[0.06] bg-black/25 p-3">
                {!lines.length && <p className="m-auto max-w-sm text-center text-[0.85rem] text-white/40">Ask what&apos;s for sale, then say “buy the first one”. Or run a simulated buyer agent.</p>}
                {lines.map((l, i) => (
                  <div key={i} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[0.86rem] whitespace-pre-line", l.from === "you" ? "ml-auto rounded-br-md bg-white/[0.08] text-white/90" : "rounded-tl-md border border-white/[0.08] bg-[#0b0d12] text-white/75")}>
                    {l.pending ? <LoaderCircle className="size-4 animate-spin text-white/50" /> : l.text}
                    {l.checkout && (
                      <a href={l.checkout.url} target="_blank" rel="noreferrer" className="mt-2 flex w-fit items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[0.8rem] font-semibold text-[#0b1200]">
                        <ShoppingBag className="size-3.5" /> Open checkout: {l.checkout.title}
                      </a>
                    )}
                  </div>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(text);
                }}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0b0d12]/85 p-2 pl-4 focus-within:border-brand/40"
              >
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the store agent…" aria-label="Message the store agent" className="h-10 min-w-0 flex-1 bg-transparent text-[0.92rem] text-white outline-none placeholder:text-white/30" />
                <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="grid size-10 place-items-center rounded-xl bg-brand text-[#0b1200] disabled:opacity-30">
                  <ArrowUp className="size-5" />
                </button>
              </form>
              <div className="flex flex-wrap gap-1.5">
                {SUGGEST.map((s) => (
                  <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[0.78rem] text-white/55 hover:text-white disabled:opacity-40">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          {/* funnel */}
          <div className="flex min-w-0 flex-col gap-4">
            <AgentTests
              tests={tests}
              simOn={simOn}
              onSim={setSimOn}
              onAutopilot={(on) => {
                testsPost({ autopilot: on });
                if (on && !f?.conversations) setSimOn(true);
              }}
              onStart={(lever) => testsPost({ start: lever })}
            />
            <Panel>
              <PanelHeader
                icon={<ShoppingBag />}
                title="Agent sales"
                right={
                  !!f?.simulated && (
                    <Badge tone="warn" title="Conversations from Darwin's simulated buyer agent">
                      <Bot /> {f.simulated} simulated
                    </Badge>
                  )
                }
              />
              <div className="flex flex-col gap-3 px-5 pb-5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                    <div className="text-[0.68rem] tracking-[0.12em] text-white/40 uppercase">Agent conversion</div>
                    <div className="text-[1.5rem] font-semibold tabular">{f ? `${(f.conversion * 100).toFixed(0)}%` : "–"}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                    <div className="text-[0.68rem] tracking-[0.12em] text-white/40 uppercase">Agent revenue</div>
                    <div className="text-[1.5rem] font-semibold tabular">{f ? money(f.revenue) : "–"}</div>
                  </div>
                </div>
                <ol className="flex flex-col gap-1.5">
                  {steps.map((s) => (
                    <li key={s.label} className="grid grid-cols-[9rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-[0.8rem]">
                      <span className="text-white/65">{s.label}</span>
                      <div className="h-5 overflow-hidden rounded-md bg-white/[0.04]">
                        <div className="h-full rounded-md bg-gradient-to-r from-agent/80 to-agent/40" style={{ width: `${steps[0].n ? Math.max(3, (s.n / steps[0].n) * 100) : 0}%` }} />
                      </div>
                      <span className="text-right font-mono text-white/70 tabular">{s.n}</span>
                    </li>
                  ))}
                </ol>
                <Button onClick={runBuyer} disabled={running} className="w-full">
                  {running ? <LoaderCircle className="animate-spin" /> : <Play />}
                  Run a simulated buyer agent
                </Button>
              </div>
            </Panel>
            <Panel>
              <PanelHeader icon={<Bot />} title="By agent" />
              <ul className="flex flex-col gap-1.5 px-5 pb-5 text-[0.8rem]">
                {!f?.byAgent.length && <li className="text-white/40">No agent has shopped yet.</li>}
                {f?.byAgent.map((a) => (
                  <li key={a.agent} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <span className="truncate text-white/75">{a.agent}</span>
                    <span className="font-mono text-white/50 tabular">
                      {a.conversations} → {a.checkouts} → {a.paid} paid
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

const LEVER_LABEL: Record<Lever, string> = {
  facts: "Facts up front",
  "one-pick": "One best pick",
  structured: "Structured buy instructions",
  upsell: "Upsell the yearly plan",
};
const LEVERS_IN_ORDER: Lever[] = ["facts", "one-pick", "structured", "upsell"];
const pctOf = (x?: number) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const signedPct = (x?: number) => (x === undefined ? "" : `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`);

function AgentTests({
  tests,
  simOn,
  onSim,
  onAutopilot,
  onStart,
}: {
  tests?: { state: AgentTestState; results: AgentTestResult[] };
  simOn: boolean;
  onSim: (on: boolean) => void;
  onAutopilot: (on: boolean) => void;
  onStart: (lever: Lever) => void;
}) {
  const s = tests?.state;
  const running = s?.tests.find((t) => t.status === "running");
  const result = running ? tests?.results.find((r) => r.testId === running.id) : undefined;
  return (
    <Panel glow={!!s?.autopilot}>
      <PanelHeader icon={<FlaskConical />} title="A/B tests on your agent" />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <div className="flex flex-wrap gap-2">
          <Toggle on={!!s?.autopilot} onChange={onAutopilot} icon={<Cpu />} label="Autopilot" title="Test one pitch lever at a time; keep winners, stop losers" />
          <Toggle on={simOn} onChange={onSim} tone="human" icon={<Activity />} label="Simulated buyers" title="80 simulated buyer agents every 3 s (labelled)" />
        </div>
        <p className="text-[0.76rem] text-white/45">Judged on paid conversations. The pitch today: {s?.levers.length ? s.levers.map((l) => LEVER_LABEL[l]).join(" + ") : "plain list of offers"}.</p>
        <ul className="flex flex-col gap-1.5">
          {LEVERS_IN_ORDER.map((l) => {
            const t = [...(s?.tests ?? [])].reverse().find((x) => x.lever === l);
            const inPitch = s?.levers.includes(l);
            return (
              <li key={l} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.8rem]" title={t?.reason}>
                {inPitch ? <Rocket className="size-4 text-[#7ee2a0]" /> : t?.status === "running" ? <LoaderCircle className="size-4 animate-spin text-[#9cc5ff]" /> : t?.status === "stopped" ? <CircleStop className="size-4 text-[#ff9b9b]" /> : <FlaskConical className="size-4 text-white/30" />}
                <span className="min-w-0 flex-1 truncate text-white/80">{LEVER_LABEL[l]}</span>
                {inPitch ? (
                  <Badge tone="good">in the pitch</Badge>
                ) : t?.status === "running" ? (
                  <Badge tone="info">testing</Badge>
                ) : t?.status === "stopped" ? (
                  <Badge tone="bad">stopped</Badge>
                ) : (
                  <button onClick={() => onStart(l)} disabled={!!running} className="text-[0.74rem] text-white/45 hover:text-white disabled:opacity-30">
                    Test it
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {running && result && (
          <div className="rounded-lg bg-black/25 p-3 text-[0.78rem]">
            <div className="mb-1 font-medium text-white/80">Testing “{LEVER_LABEL[running.lever]}”</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-white/40">Current pitch</div>
                <div className="font-mono tabular">
                  {pctOf(result.control.rate)} <span className="text-white/35">of {result.control.conversations}</span>
                </div>
              </div>
              <div>
                <div className="text-white/40">With the lever</div>
                <div className="font-mono tabular">
                  {pctOf(result.treatment.rate)} <span className="text-white/35">of {result.treatment.conversations}</span>
                </div>
              </div>
            </div>
            {result.probabilityToBeat !== undefined && (
              <div className="mt-2 text-white/55">
                {pctOf(result.probabilityToBeat)} chance better · {signedPct(result.lift)} paid conversations
                {result.liftInterval && (
                  <span className="text-white/35">
                    {" "}
                    (95%: {signedPct(result.liftInterval[0])} to {signedPct(result.liftInterval[1])})
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {!!s?.log.length && (
          <ol className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[0.74rem] text-white/55">
            {s.log.slice(0, 8).map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="font-mono text-white/30">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> {e.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
