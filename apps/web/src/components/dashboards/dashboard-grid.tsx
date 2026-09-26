"use client";

import { Bot, Flame, FlaskConical, Gauge, Globe, LayoutDashboard, ListChecks, Smartphone, Sparkles, TrendingUp } from "lucide-react";
import type { DashboardData, DashboardKind, SeriesPoint } from "@/lib/contracts";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

const ICON: Record<DashboardKind, React.ReactNode> = {
  kpis: <Gauge />,
  funnel: <ListChecks />,
  sources: <Globe />,
  "humans-agents": <Bot />,
  heatmap: <Flame />,
  experiments: <FlaskConical />,
  revenue: <TrendingUp />,
  events: <Sparkles />,
  devices: <Smartphone />,
};

const pct = (x: number | undefined, d = 1) => (x === undefined ? "–" : `${(x * 100).toFixed(d)}%`);
const gbp = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/** Every dashboard in a plan, laid out in a responsive grid. `compact` for the onboarding preview. */
export function DashboardGrid({ dashboards, compact = false }: { dashboards: DashboardData[]; compact?: boolean }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", compact ? "md:grid-cols-2" : "lg:grid-cols-2 2xl:grid-cols-3")}>
      {dashboards.map((d) => (
        <DashboardCard key={d.id} d={d} compact={compact} />
      ))}
    </div>
  );
}

export function DashboardCard({ d, compact }: { d: DashboardData; compact?: boolean }) {
  const wide = d.kind === "kpis";
  return (
    <Panel className={cn(wide && "md:col-span-2 2xl:col-span-3", "min-h-[11rem]")} data-dashboard={d.id}>
      <PanelHeader icon={ICON[d.kind] ?? <LayoutDashboard />} title={d.title} right={d.empty ? <Badge tone="outline">Waiting for data</Badge> : undefined} />
      <div className="flex flex-1 flex-col gap-2 px-5 pb-5">
        {!compact && <p className="-mt-1 text-[0.78rem] text-white/45">{d.why}</p>}
        {d.empty ? <Waiting kind={d.kind} /> : <Body d={d} compact={compact} />}
      </div>
    </Panel>
  );
}

function Waiting({ kind }: { kind: DashboardKind }) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl border border-dashed border-white/[0.08] px-4 py-5 text-[0.8rem] text-white/40">
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
      </span>
      {kind === "experiments" ? "No tests yet. Darwin starts them once visitors arrive." : "Listening for the first events…"}
    </div>
  );
}

function Body({ d, compact }: { d: DashboardData; compact?: boolean }) {
  switch (d.kind) {
    case "kpis":
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {d.kpis?.map((k) => (
            <div key={k.label} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3">
              <div className="text-[0.7rem] font-medium tracking-[0.12em] text-white/40 uppercase">{k.label}</div>
              <div className="mt-1 text-[1.6rem] leading-none font-semibold text-white tabular">{k.value}</div>
              {k.hint && <div className="mt-1 text-[0.72rem] text-white/40">{k.hint}</div>}
            </div>
          ))}
        </div>
      );
    case "funnel":
      return (
        <ol className="flex flex-col gap-2">
          {d.steps?.map((s, i) => {
            const prev = i ? d.steps![i - 1].visitors : s.visitors;
            const drop = i && prev ? 1 - s.visitors / prev : 0;
            return (
              <li key={s.event} className="grid grid-cols-[8.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-[0.8rem]">
                <span className="truncate text-white/70" title={s.event}>
                  {s.label}
                </span>
                <div className="h-6 overflow-hidden rounded-md bg-white/[0.04]">
                  <div className="flex h-full items-center rounded-md bg-gradient-to-r from-brand/70 to-brand/40 px-2 text-[0.72rem] font-medium text-[#0b1200] tabular" style={{ width: `${Math.max(2, s.rate * 100)}%` }}>
                    {s.rate >= 0.12 ? s.visitors.toLocaleString("en-GB") : ""}
                  </div>
                </div>
                <span className="text-right font-mono text-white/60 tabular">
                  {pct(s.rate, 0)}
                  {i > 0 && drop > 0.5 && <span className="ml-1 text-[#ffb37a]" title={`${pct(drop, 0)} drop from the step before`}>↓{pct(drop, 0)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      );
    case "sources":
    case "humans-agents":
    case "devices": {
      const max = Math.max(1, ...(d.rows ?? []).map((r) => r.visitors));
      const avg = (d.rows ?? []).reduce((a, r) => a + r.conversions, 0) / Math.max(1, (d.rows ?? []).reduce((a, r) => a + r.visitors, 0));
      return (
        <ul className="flex flex-col gap-1.5">
          {d.rows?.slice(0, compact ? 5 : 8).map((r) => (
            <li key={r.key} className="grid grid-cols-[7.5rem_minmax(0,1fr)_7rem] items-center gap-3 text-[0.8rem]">
              <span className="truncate text-white/70">{r.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full bg-human/70" style={{ width: `${(r.visitors / max) * 100}%` }} />
              </div>
              <span className={cn("text-right font-mono tabular", r.visitors >= 20 && r.rate < avg * 0.75 ? "text-[#ffb37a]" : "text-white/60")}>
                {r.visitors} · {pct(r.rate)}
              </span>
            </li>
          ))}
        </ul>
      );
    }
    case "heatmap":
      return (
        <ul className="flex flex-col gap-1.5">
          {d.clicks?.slice(0, compact ? 5 : 8).map((c) => (
            <li key={c.selector} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 text-[0.8rem]" title={c.selector}>
              <div className="min-w-0">
                <div className="truncate text-white/75">{c.label}</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#4c94f0] to-[#f05252]" style={{ width: `${Math.max(3, c.share * 100)}%` }} />
                </div>
              </div>
              <span className={cn("text-right font-mono tabular", c.rage ? "text-[#ff9b9b]" : "text-white/55")}>
                {pct(c.share, 0)}
                {c.rage ? ` · ${c.rage}⚡` : ""}
              </span>
            </li>
          ))}
        </ul>
      );
    case "experiments":
      return (
        <ul className="flex flex-col gap-2">
          {d.tests?.slice(0, compact ? 3 : 6).map((t, i) => (
            <li key={`${t.name}-${i}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[0.78rem]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-white/85">{t.name}</span>
                <Badge tone={t.status === "Shipped" ? "good" : t.status === "Testing" ? "info" : t.status === "Live" ? "brand" : "neutral"}>{t.status}</Badge>
              </div>
              <div className="mt-0.5 flex justify-between text-white/45">
                <span>{t.audience}</span>
                <span className="font-mono tabular">
                  {pct(t.control)} → {pct(t.treatment)}
                  {t.probability !== undefined && ` · ${pct(t.probability, 0)} better`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      );
    case "revenue":
    case "events":
      return (
        <div className="flex flex-col gap-3">
          {d.series?.map((s) => (
            <div key={s.name} className="grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
              <div className="min-w-0">
                <div className="mb-1 truncate text-[0.76rem] text-white/60">{s.label}</div>
                <Spark points={s.points} tone={d.kind === "revenue" ? "brand" : "human"} />
              </div>
              <span className="text-right font-mono text-[1.05rem] text-white tabular">{d.kind === "revenue" ? gbp(s.total) : s.total.toLocaleString("en-GB")}</span>
            </div>
          ))}
        </div>
      );
  }
}

function Spark({ points, tone }: { points: SeriesPoint[]; tone: "brand" | "human" }) {
  const w = 300;
  const h = 44;
  const max = Math.max(1, ...points.map((p) => p.v));
  const step = w / Math.max(1, points.length - 1);
  const path = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - 2 - (p.v / max) * (h - 6)).toFixed(1)}`).join(" ");
  const color = tone === "brand" ? "#b6f05a" : "#4c94f0";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-11 w-full" aria-hidden>
      <path d={`${path} L${w},${h} L0,${h} Z`} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

