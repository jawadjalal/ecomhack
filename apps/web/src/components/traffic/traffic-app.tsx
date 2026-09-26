"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Bot, ExternalLink, FlaskConical, LoaderCircle, ShoppingBag, Sparkles, Users } from "lucide-react";
import type { InsightCategory, InsightsResponse, TrafficDimension, TrafficInsight, TrafficReport, TrafficRow } from "@/lib/traffic";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { Card, Empty, LegendKey, PageHead, PillButton, Tag, type Tone } from "@/components/dw/ui";
import { CardHead, DwSwitch, HEAD_CONTROLS, SiteSelect } from "@/components/dw/personalize/kit";
import { SourceMark } from "@/components/dw/traffic/source-mark";
import { useLiveInterval } from "@/lib/console/live";

/* ------------------------------------------------------------------ helpers */

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const gbp = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

/** Links that land on the demo store as if the visitor came from somewhere. Open one, look back here. */
const TRY_LINKS: { label: string; href: string }[] = [
  { label: "From X (Twitter)", href: "/store?utm_source=twitter&utm_medium=social&utm_campaign=autumn-drop" },
  { label: "From YouTube", href: "/store?utm_source=youtube&utm_medium=video&utm_campaign=trail-review" },
  { label: "Google ad: “waterproof trail shoes”", href: "/store?utm_source=google&utm_medium=cpc&utm_term=waterproof+trail+shoes" },
  { label: "From ChatGPT", href: "/store?utm_source=chatgpt.com" },
  { label: "Newsletter", href: "/store?utm_source=klaviyo&utm_medium=email&utm_campaign=payday" },
  { label: "Store search: “racing”", href: "/store?q=racing" },
];

const PANELS: { dim: TrafficDimension; title: string; empty: string; note?: string; tone: Tone; shape?: MascotKind }[] = [
  { dim: "source", title: "Channels", empty: "No visitors yet.", tone: "olive", shape: "observer" },
  { dim: "referrer", title: "Referring sites", empty: "No referrers yet.", tone: "white" },
  {
    dim: "query",
    title: "Search queries",
    empty: "No search visitors yet.",
    note: "From paid-ad keywords and store search. Google and Bing hide organic search terms, so those count as “(not provided)”.",
    tone: "blue",
    shape: "analyst",
  },
  { dim: "campaign", title: "Campaigns (tagged links)", empty: "No tagged links yet. Try one of the links above.", tone: "white" },
  {
    dim: "country",
    title: "Countries",
    empty: "No visitors yet.",
    note: "From the host's geo headers (e.g. Vercel). Local visits show as Unknown; we never guess.",
    tone: "lilac",
    shape: "shipper",
  },
  { dim: "landing", title: "Landing pages", empty: "No page views yet.", tone: "white" },
  { dim: "device", title: "Devices", empty: "No visitors yet.", tone: "sand" },
];

/** Card rows after the channels row, 1.7fr / 1fr alternating (never four equal boxes). Each cell is one panel or a stack of two. */
const LAYOUT: { cols: string; cells: TrafficDimension[][] }[] = [
  { cols: "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]", cells: [["referrer"], ["query", "campaign"]] },
  { cols: "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]", cells: [["landing"], ["country"]] },
];

/* ------------------------------------------------------------------ app */

export function TrafficApp() {
  const [site, setSite] = useState("all");
  const [synthetic, setSynthetic] = useState(true);
  const [data, setData] = useState<TrafficReport>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<TrafficReport>(`/api/traffic?site=${encodeURIComponent(site)}&synthetic=${synthetic ? 1 : 0}`));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site, synthetic]);

  const every = useLiveInterval(4000);
  useEffect(() => {
    const first = setTimeout(load, 0);
    // Static unless the Live switch is on: on a multi-server host each poll can land on a server with other numbers.
    const t = every ? setInterval(load, every) : undefined;
    return () => {
      clearTimeout(first);
      if (t) clearInterval(t);
    };
  }, [load, every]);

  const addTestTraffic = async () => {
    setBusy(true);
    try {
      // Both simulators label every event synthetic. North Trail = the external demo site (has UTM + query mix).
      await Promise.all([api("/api/simulate", { humans: 150, agents: 20 }), api("/api/web/simulate", { site: "north-trail", visitors: 300 })]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const t = data?.totals;
  const panel = (dim: TrafficDimension) => {
    const p = PANELS.find((x) => x.dim === dim)!;
    return <DimensionPanel key={dim} {...p} rows={data?.dimensions[dim]} avg={t?.conversionRate ?? 0} />;
  };

  return (
    <>
      <PageHead
        mascot={<Mascot kind="observer" size={50} active />}
        title="Traffic"
        lede="Iris tracks where visitors come from, people or AI agents, and whether they buy."
        right={
          <div className={HEAD_CONTROLS}>
            <SiteSelect value={site} onChange={setSite} options={["all", ...(data?.sites ?? [])].map((s) => ({ value: s, label: s === "all" ? "All sites" : s }))} />
            <DwSwitch on={synthetic} onChange={setSynthetic} label="Include simulated" title="Count visitors made by Darwin's simulators (labelled simulated)" />
            <PillButton onClick={addTestTraffic} disabled={busy} title="Simulated shoppers and agents. Every visit is labelled simulated.">
              {busy ? <LoaderCircle className="animate-spin" /> : <Users />}
              Send 470 test visitors
            </PillButton>
          </div>
        }
      />

      {error && <div className="rounded-[22px] bg-dw-warn-bg px-5 py-3 text-[14px] text-dw-warn">{error}</div>}

      {/* totals, compact: who came (1.7fr) and what they bought (1fr) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card tone="yellow" shape="observer" corner="tr" className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div className="flex flex-wrap items-end gap-x-9 gap-y-3">
              <BigStat value={t ? t.visitors.toLocaleString() : undefined} label="visitors" />
              <BigStat value={t ? t.humans.toLocaleString() : undefined} label="people" small />
              <BigStat value={t ? t.agents.toLocaleString() : undefined} label="AI agents" small />
            </div>
            {t && t.synthetic > 0 && (
              <span title="Visitors made by Darwin's simulators, kept apart from real ones" className="self-start">
                <Tag tone="white">
                  <Bot className="size-3" aria-hidden /> {t.synthetic.toLocaleString()} simulated
                </Tag>
              </span>
            )}
          </div>
          <Split humans={t?.humans ?? 0} agents={t?.agents ?? 0} />
        </Card>

        <Card tone="pink" shape="shipper" corner="br" className="p-5">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <BigStat value={t ? pct(t.conversionRate) : undefined} label={t ? `ordered · ${t.conversions.toLocaleString()} orders` : "ordered"} />
            <BigStat value={t ? gbp(t.revenue) : undefined} label="revenue" small />
            <BigStat value={t ? String(t.countries) : undefined} label="countries" small />
          </div>
          <p className="mt-4 flex h-4 items-center gap-1.5 text-[12.5px] text-dw-ink/65">
            <ShoppingBag className="size-3.5" aria-hidden /> % = share of visitors who ordered
          </p>
        </Card>
      </div>

      <InsightsPanel site={site} synthetic={synthetic} visitors={t?.visitors ?? 0} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-2">
        <h2 className="mr-auto text-[22px] font-semibold tracking-[-0.02em] max-sm:basis-full">Where they came from</h2>
        <LegendKey>People</LegendKey>
        <LegendKey dashed>AI agents</LegendKey>
        <span className="text-[12px] text-dw-ink/60">visitors · share who ordered</span>
      </div>

      {/* dimensions: channels first, with devices and the try-it links beside them */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {panel("source")}
        <div className="flex min-w-0 flex-col gap-4">
          {panel("device")}
          <TryLinks />
        </div>
      </div>
      {LAYOUT.map((row, i) => (
        <div key={i} className={cn("grid grid-cols-1 gap-4", row.cols)}>
          {row.cells.map((cell) => (
            <div key={cell.join("+")} className="flex min-w-0 flex-col gap-4 [&>section:last-child]:flex-1">
              {cell.map(panel)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function BigStat({ value, label, small }: { value?: string; label: string; small?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      {value === undefined ? (
        <span className={cn("block animate-pulse rounded-full bg-dw-ink/10", small ? "h-[24px] w-20" : "h-[40px] w-32")} aria-label="Loading" />
      ) : (
        <span className={cn("num leading-none font-semibold tracking-[-0.03em] whitespace-nowrap", small ? "text-[24px]" : "text-[40px]")}>{value}</span>
      )}
      <span className="mt-1.5 text-[13px] leading-tight whitespace-nowrap text-dw-ink/65">{label}</span>
    </div>
  );
}

/** "Visit the store as if you came from…": links that land on the demo store with a source. */
function TryLinks() {
  return (
    <Card tone="blue" shape="observer" corner="br" hover={false} className="flex-1 p-5">
      <CardHead>Visit the store as if you came from…</CardHead>
      <p className="mt-1 text-[13px] text-dw-ink/65">Open one, then look back here.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TRY_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="group flex h-9 max-w-full items-center gap-2 rounded-full bg-white/60 pr-3 pl-1 text-[13px] font-medium transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-dw-ink"
          >
            <span className="transition-transform group-hover:-rotate-6">
              <SourceMark label={l.label} size={26} />
            </span>
            <span className="min-w-0 truncate">{l.label}</span>
            <ExternalLink className="size-3 shrink-0 text-dw-ink/40 group-hover:text-dw-ink" aria-hidden />
          </a>
        ))}
      </div>
    </Card>
  );
}

/** People vs agents as one ink bar: solid = people, dashed = agents. */
function Split({ humans, agents }: { humans: number; agents: number }) {
  const total = humans + agents;
  const h = total ? humans / total : 0;
  return (
    <div className="mt-4 flex items-center gap-3 text-[12.5px] text-dw-ink/70">
      <LegendKey className="shrink-0 whitespace-nowrap">People {total ? `${Math.round(h * 100)}%` : ""}</LegendKey>
      <div className="flex h-3 min-w-0 flex-1 gap-1" role="img" aria-label={total ? `${Math.round(h * 100)}% people, ${Math.round((1 - h) * 100)}% AI agents` : "No visitors yet"}>
        {total ? (
          <>
            <span className="rounded-full bg-dw-ink transition-[width] duration-700" style={{ width: `${Math.max(2, h * 100)}%` }} />
            <span className="min-w-3 flex-1 rounded-full border-[1.5px] border-dashed border-dw-ink/80" />
          </>
        ) : (
          <span className="flex-1 rounded-full border-[1.5px] border-dashed border-dw-ink/30" />
        )}
      </div>
      <LegendKey dashed className="shrink-0 whitespace-nowrap">
        AI agents {total ? `${Math.round((1 - h) * 100)}%` : ""}
      </LegendKey>
    </div>
  );
}

/** Plain names for rows whose data label is technical (the original label stays in the tooltip for judges). */
const PLAIN_LABEL: Record<string, string> = { "agent-api": "Agent tools and chat" };

function DimensionPanel({
  dim,
  title,
  rows,
  empty,
  note,
  avg,
  tone,
  shape,
}: {
  dim: TrafficDimension;
  title: string;
  rows?: TrafficRow[];
  empty: string;
  note?: string;
  avg: number;
  tone: Tone;
  shape?: MascotKind;
}) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.visitors));
  const marks = dim === "source" || dim === "referrer" || dim === "campaign";
  return (
    <Card tone={tone} shape={shape} corner="br" hover={false}>
      <CardHead right={rows?.length ? <span>visitors · ordered</span> : undefined}>{title}</CardHead>
      <div className="mt-4 flex flex-col gap-1">
        {rows === undefined && (
          <p className="flex items-center gap-2 py-4 text-[14px] text-dw-ink/55">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {rows?.length === 0 && <Empty mascot={<Mascot kind="observer" size={44} active={false} />}>{empty}</Empty>}
        {rows?.map((r) => {
          const below = r.visitors >= 20 && r.conversionRate < avg * 0.75;
          const above = r.visitors >= 20 && r.conversionRate > avg * 1.25;
          return (
            <div key={r.key} className="grid min-h-10 grid-cols-[minmax(0,1fr)_minmax(3.5rem,1.15fr)_auto] items-center gap-x-3 py-1 text-[13.5px]">
              <span className="flex min-w-0 items-center gap-2" title={r.label}>
                {marks && <SourceMark label={r.label} agents={r.agents > 0 && r.agents === r.visitors} size={24} />}
                <span className="min-w-0 truncate">{PLAIN_LABEL[r.key] ?? r.label}</span>
              </span>
              <span className="flex h-3 gap-0.5" title={`${r.humans} humans · ${r.agents} agents${r.synthetic ? ` · ${r.synthetic} simulated` : ""}`}>
                {r.humans > 0 && <span className="rounded-full bg-dw-ink" style={{ width: `${Math.max(1.5, (r.humans / max) * 100)}%` }} />}
                {r.agents > 0 && <span className="rounded-full border-[1.5px] border-dashed border-dw-ink/85" style={{ width: `${Math.max(3, (r.agents / max) * 100)}%` }} />}
              </span>
              <span className="num flex items-center justify-end gap-1.5 text-right whitespace-nowrap" title={below ? "Buys well below average" : above ? "Buys well above average" : undefined}>
                <span className="text-dw-ink/60">{r.visitors.toLocaleString()} ·</span>
                <span className={cn("font-semibold", below ? "rounded-full bg-dw-warn-bg px-1.5 text-dw-warn" : above ? "rounded-full bg-dw-win-bg px-1.5 text-dw-win" : "")}>{pct(r.conversionRate)}</span>
              </span>
            </div>
          );
        })}
        {note && <p className="mt-3 text-[12.5px] leading-snug text-dw-ink/55">{note}</p>}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ insights */

const CATEGORY: Record<InsightCategory, { label: string; mascot: MascotKind }> = {
  seo: { label: "Search", mascot: "observer" },
  conversion: { label: "Sales", mascot: "analyst" },
  agents: { label: "AI agents", mascot: "experimenter" },
  tracking: { label: "Tracking", mascot: "designer" },
};

/** Sites whose pages run darwin.js, so a suggestion can become a personalization test. */
const testableSite = (site: string) => site !== "all" && site !== "pace-store";

function InsightsPanel({ site, synthetic, visitors }: { site: string; synthetic: boolean; visitors: number }) {
  const [res, setRes] = useState<InsightsResponse>();
  const [busy, setBusy] = useState<"rules" | "llm">();
  const [error, setError] = useState<string>();
  const ask = useCallback(
    async (llm: boolean) => {
      setBusy(llm ? "llm" : "rules");
      try {
        setRes(await api<InsightsResponse>("/api/traffic/insights", { site, synthetic, llm }));
        setError(undefined);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(undefined);
      }
    },
    [site, synthetic],
  );

  // Rule-based suggestions refresh for free when the filters change or traffic first arrives.
  const hasTraffic = visitors > 0;
  useEffect(() => {
    const t = setTimeout(() => ask(false), 0);
    return () => clearTimeout(t);
  }, [ask, hasTraffic]);

  const total = (res?.insights ?? []).reduce((n, i) => n + (i.impact?.orders ?? 0), 0);
  const [all, setAll] = useState(false);
  const FIRST = 3;
  const shown = all ? (res?.insights ?? []) : (res?.insights ?? []).slice(0, FIRST);
  const more = (res?.insights.length ?? 0) - FIRST;

  return (
    <Card tone="white" hover={false} className="p-5 sm:p-6">
      <CardHead
        right={
          <>
            {more > 0 && (
              <PillButton tone="sand" size="sm" onClick={() => setAll((a) => !a)} aria-expanded={all}>
                {all ? "Show fewer" : `Show ${more} more`}
              </PillButton>
            )}
            <PillButton size="sm" onClick={() => ask(true)} disabled={!!busy} title="Ask Darwin to read this report with AI and suggest fixes">
              {busy === "llm" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              Ask Darwin
            </PillButton>
          </>
        }
      >
        <span className="flex items-center gap-3">
          <Mascot kind="leader" size={34} active={!!busy} title="Darwin" />
          What to improve
        </span>
      </CardHead>
      {res && (
        <p className="mt-1 text-[13.5px] text-dw-ink/60">
          {res.source === "llm" ? "Written by Darwin with AI" : "From Darwin's rules"}
          {total > 0 && ` · up to +${total} orders at today's traffic`}
        </p>
      )}
      <div className="mt-3">
        {error && <p className="mb-3 rounded-2xl bg-dw-warn-bg px-4 py-2.5 text-[14px] text-dw-warn">{error}</p>}
        {res?.note && <p className="mb-3 text-[13px] text-dw-ink/55">{res.note}</p>}
        {!res && (
          <p className="flex items-center gap-2 text-[14px] text-dw-ink/55">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Reading the numbers…
          </p>
        )}
        {res && res.insights.length === 0 && <Empty mascot={<Mascot kind="leader" size={48} frame />}>Nothing stands out yet. Send some visitors and Darwin will read the numbers again.</Empty>}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
          {shown.map((i) => (
            <InsightCard key={i.id} insight={i} site={site} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function InsightCard({ insight: i, site }: { insight: TrafficInsight; site: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>();
  const cat = CATEGORY[i.category];

  const draftTest = async () => {
    if (!i.testPrompt) return;
    setState("busy");
    try {
      // Same path as typing it into /console/personalize: draft (LLM or rules), then save as a draft rule.
      const draft = await api<{ rule: unknown }>("/api/web/draft", { site, prompt: i.testPrompt });
      await api("/api/web/rules", { rule: draft.rule, status: "draft" });
      setState("done");
    } catch (e) {
      setMsg((e as Error).message);
      setState("error");
    }
  };

  return (
    <div className="dw-row flex flex-col gap-2 rounded-[22px] bg-dw-sand p-4">
      <div className="flex items-center gap-2">
        <span className="dw-tilt">
          <Mascot kind={cat.mascot} size={28} active={false} />
        </span>
        <Tag tone="white">{cat.label}</Tag>
        {i.confidence === "low" && (
          <span className="text-[12px] text-dw-ink/50" title="Small sample: treat as a hint">
            small sample
          </span>
        )}
        {i.impact && i.impact.orders > 0 && (
          <span className="num ml-auto rounded-full bg-dw-win-bg px-2 py-0.5 text-[12px] font-semibold text-dw-win" title="If this group converted at the site average, at today's traffic">
            +{i.impact.orders} orders{i.impact.revenue > 0 ? ` · ${gbp(i.impact.revenue)}` : ""}
          </span>
        )}
      </div>
      <h3 className="text-[16px] leading-snug font-semibold">{i.title}</h3>
      <p className="font-dwmono text-[12px] leading-relaxed text-dw-ink/60">{i.evidence}</p>
      <p className="text-[14px] leading-snug text-dw-ink/80">{i.action}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {i.testPrompt &&
          (testableSite(site) ? (
            state === "done" ? (
              <Link href={`/console/personalize?site=${encodeURIComponent(site)}`} className="flex items-center gap-1 text-[13px] font-semibold text-dw-win hover:underline">
                Draft saved: review in Personalize <ArrowUpRight className="size-3.5" />
              </Link>
            ) : (
              <PillButton size="sm" tone="white" onClick={draftTest} disabled={state === "busy"} title={i.testPrompt}>
                {state === "busy" ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
                Draft a test
              </PillButton>
            )
          ) : (
            <span className="text-[12.5px] text-dw-ink/50" title={i.testPrompt}>
              Pick a site running Darwin above to test this
            </span>
          ))}
        {i.link && (
          <Link href={i.link.href} className="flex items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-dw-ink/70 hover:bg-white/60 hover:text-dw-ink">
            {i.link.label} <ArrowUpRight className="size-3.5" />
          </Link>
        )}
        {state === "error" && <span className="text-[12.5px] text-dw-warn">{msg}</span>}
      </div>
    </div>
  );
}

