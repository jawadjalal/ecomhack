"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  Globe,
  Link2,
  LoaderCircle,
  MapPin,
  Megaphone,
  MonitorSmartphone,
  Radar,
  Search,
  ShoppingBag,
  Users,
} from "lucide-react";
import type { TrafficDimension, TrafficReport, TrafficRow } from "@/lib/traffic";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/switch";
import { cn } from "@/components/ui/cn";
import { DarwinWordmark } from "@/components/console/brand";

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

const PANELS: { dim: TrafficDimension; title: string; icon: ReactNode; empty: string; note?: string }[] = [
  { dim: "source", title: "Channels", icon: <Radar />, empty: "No visitors yet." },
  { dim: "referrer", title: "Referring sites", icon: <Link2 />, empty: "No referrers yet." },
  {
    dim: "query",
    title: "Search queries",
    icon: <Search />,
    empty: "No search visitors yet.",
    note: "From paid-ad keywords (utm_term) and store search. Google and Bing hide organic search terms, so those count as “(not provided)”.",
  },
  { dim: "campaign", title: "Campaigns (UTM)", icon: <Megaphone />, empty: "No tagged links yet. Try one of the links above." },
  {
    dim: "country",
    title: "Countries",
    icon: <MapPin />,
    empty: "No visitors yet.",
    note: "From the host's geo headers (e.g. Vercel). Local visits show as Unknown; we never guess.",
  },
  { dim: "landing", title: "Landing pages", icon: <Globe />, empty: "No page views yet." },
  { dim: "device", title: "Devices", icon: <MonitorSmartphone />, empty: "No visitors yet." },
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

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

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

  return (
    <div data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[110rem] flex-col gap-4 p-4">
        {/* header */}
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/console" className="flex items-center gap-2 rounded-lg pr-2 text-white/60 hover:text-white" title="Back to mission control">
            <ArrowLeft className="size-4" />
            <DarwinWordmark sub="traffic" />
          </Link>
          <div className="h-7 w-px bg-white/10" />
          <label className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] text-white/60">
            <Globe className="size-4 text-white/45" />
            Site
            <select
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="bg-transparent font-medium text-white/90 outline-none [&>option]:bg-[#0b0d12]"
              aria-label="Site"
            >
              {["all", ...(data?.sites ?? [])].map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All sites" : s}
                </option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          <p className="hidden text-[0.82rem] text-white/45 2xl:block">Where every visitor came from, human or AI agent, and whether they bought.</p>
          <Toggle on={synthetic} onChange={setSynthetic} label="Include simulated" icon={<Bot />} />
          <Button onClick={addTestTraffic} disabled={busy} title="Simulated shoppers and agents. Every event is labelled synthetic.">
            {busy ? <LoaderCircle className="animate-spin" /> : <Users />}
            +470 test visitors
          </Button>
        </header>

        {error && <div className="rounded-xl border border-bad/30 bg-bad/[0.08] px-3 py-2 text-[0.85rem] text-[#ffb4b4]">{error}</div>}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Visitors" value={t ? t.visitors.toLocaleString() : "–"} sub={t && t.synthetic > 0 ? <Badge tone="warn">{t.synthetic.toLocaleString()} simulated</Badge> : undefined} />
          <Kpi label="Humans" value={t ? t.humans.toLocaleString() : "–"} tone="human" />
          <Kpi label="AI agents" value={t ? t.agents.toLocaleString() : "–"} tone="agent" />
          <Kpi label="Ordered" value={t ? pct(t.conversionRate) : "–"} sub={t ? <span className="text-white/45">{t.conversions.toLocaleString()} orders</span> : undefined} />
          <Kpi label="Revenue" value={t ? gbp(t.revenue) : "–"} />
          <Kpi label="Countries" value={t ? String(t.countries) : "–"} />
        </div>

        {/* try it */}
        <Panel>
          <PanelHeader icon={<ExternalLink />} title="Try it: visit the store as if you came from…" />
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {TRY_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-[0.8rem] text-white/80 transition-colors hover:border-brand/40 hover:text-white"
              >
                {l.label} <ExternalLink className="size-3 text-white/40" />
              </a>
            ))}
          </div>
        </Panel>

        {/* dimensions */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {PANELS.map((p) => (
            <DimensionPanel key={p.dim} {...p} rows={data?.dimensions[p.dim]} avg={t?.conversionRate ?? 0} />
          ))}
        </div>

        <p className="flex items-center gap-4 px-1 text-[0.75rem] text-white/40">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-human" /> humans
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-agent" /> AI agents
          </span>
          <span className="flex items-center gap-1.5">
            <ShoppingBag className="size-3" /> % = share of visitors who ordered
          </span>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: "human" | "agent" }) {
  return (
    <Panel className="px-5 py-4">
      <span className="text-[0.72rem] font-medium tracking-[0.14em] text-white/45 uppercase">{label}</span>
      <span className={cn("mt-1 font-mono text-[1.7rem] leading-none font-semibold tabular", tone === "human" ? "text-[#9cc5ff]" : tone === "agent" ? "text-[#f5a6cb]" : "text-white")}>
        {value}
      </span>
      {sub && <span className="mt-2 text-[0.75rem]">{sub}</span>}
    </Panel>
  );
}

function DimensionPanel({ title, icon, rows, empty, note, avg }: { title: string; icon: ReactNode; rows?: TrafficRow[]; empty: string; note?: string; avg: number }) {
  const max = Math.max(1, ...(rows ?? []).map((r) => r.visitors));
  return (
    <Panel>
      <PanelHeader icon={icon} title={title} right={rows?.length ? <span className="text-[0.72rem] text-white/40">visitors · ordered</span> : undefined} />
      <div className="flex flex-col gap-1.5 px-5 pb-4">
        {rows === undefined && <p className="text-[0.85rem] text-white/40">Loading…</p>}
        {rows?.length === 0 && <p className="text-[0.85rem] text-white/45">{empty}</p>}
        {rows?.map((r) => {
          const below = r.visitors >= 20 && r.conversionRate < avg * 0.75;
          const above = r.visitors >= 20 && r.conversionRate > avg * 1.25;
          return (
            <div key={r.key} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_7rem] items-center gap-3 text-[0.8rem]">
              <span className="truncate text-white/75" title={r.label}>
                {r.label}
              </span>
              <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]" title={`${r.humans} humans · ${r.agents} agents${r.synthetic ? ` · ${r.synthetic} simulated` : ""}`}>
                <div className="h-full bg-human/75" style={{ width: `${(r.humans / max) * 100}%` }} />
                <div className="h-full bg-agent/75" style={{ width: `${(r.agents / max) * 100}%` }} />
              </div>
              <span
                className={cn("text-right font-mono tabular", below ? "text-[#ffb37a]" : above ? "text-[#7ee2a0]" : "text-white/60")}
                title={below ? "Converts well below average" : above ? "Converts well above average" : undefined}
              >
                {r.visitors.toLocaleString()} · {pct(r.conversionRate)}
              </span>
            </div>
          );
        })}
        {note && <p className="mt-2 text-[0.72rem] leading-snug text-white/35">{note}</p>}
      </div>
    </Panel>
  );
}
