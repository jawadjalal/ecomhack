"use client";

import type { ReactNode } from "react";
import { Bot, CircleHelp, Link2, Mail, Megaphone, Monitor, MousePointerClick, Search, Share2, Smartphone, Sparkles, Tablet, X } from "lucide-react";
import type { DashboardData, DashboardKind } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { Card, CardTitle, HBar, LegendKey, LiveDot, Tag, TONE, type Tone } from "@/components/dw/ui";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { Pill, SmoothLine, Tip, TrackPill } from "@/components/dw/dashboards/charts";

const pct = (x: number | undefined, d = 1) => (x === undefined || !Number.isFinite(x) ? "–" : `${(x * 100).toFixed(d)}%`);
const gbp = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const int = (n: number) => n.toLocaleString("en-GB");

/** Each kind of dashboard gets its own pastel and crew silhouette, so the grid reads at a glance. */
const LOOK: Record<DashboardKind, { tone: Tone; shape: MascotKind; corner: "tr" | "br" }> = {
  kpis: { tone: "yellow", shape: "analyst", corner: "tr" },
  funnel: { tone: "olive", shape: "designer", corner: "br" },
  sources: { tone: "blue", shape: "observer", corner: "tr" },
  "humans-agents": { tone: "pink", shape: "experimenter", corner: "br" },
  heatmap: { tone: "lilac", shape: "designer", corner: "tr" },
  experiments: { tone: "pink", shape: "experimenter", corner: "tr" },
  revenue: { tone: "yellow", shape: "shipper", corner: "br" },
  events: { tone: "white", shape: "observer", corner: "br" },
  devices: { tone: "blue", shape: "observer", corner: "br" },
};
/** When two neighbours would share a colour, the second takes this one. */
const ALT: Record<Tone, Tone> = { yellow: "white", pink: "lilac", olive: "sand", blue: "lilac", lilac: "blue", white: "sand", sand: "white" };
/** How much a kind benefits from the wide (1.7fr) slot of a row. */
const WEIGHT: Record<DashboardKind, number> = { kpis: 9, funnel: 3, revenue: 3, events: 3, heatmap: 2, sources: 2, experiments: 2, devices: 1, "humans-agents": 1 };

/**
 * Every dashboard in a plan. KPIs span the row; the rest pair up in rows that alternate 1.7fr/1fr and
 * 1fr/1.7fr (never equal boxes), the heavier chart taking the wide slot. Sized by its own width
 * (container queries), so it works full-page and embedded. `compact` for the onboarding preview.
 */
export function DashboardGrid({ dashboards, compact = false, onRemove }: { dashboards: DashboardData[]; compact?: boolean; onRemove?: (id: string) => void }) {
  const wide = dashboards.filter((d) => d.kind === "kpis");
  const rest = dashboards.filter((d) => d.kind !== "kpis");
  const rows: DashboardData[][] = [];
  for (let i = 0; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
  return (
    <div className="@container min-w-0">
      <div className="flex flex-col gap-4">
        {wide.map((d) => (
          <DashboardCard key={d.id} d={d} compact={compact} onRemove={d.custom ? onRemove : undefined} />
        ))}
        {rows.map((pair, i) => {
          if (pair.length === 1) return <DashboardCard key={pair[0].id} d={pair[0]} compact={compact} onRemove={pair[0].custom ? onRemove : undefined} />;
          const wideFirst = i % 2 === 0;
          const [a, b] = pair;
          // The heavier chart takes the wide slot.
          const ordered = WEIGHT[b.kind] > WEIGHT[a.kind] === wideFirst ? [b, a] : [a, b];
          const toneA = LOOK[ordered[0].kind].tone;
          const toneB = LOOK[ordered[1].kind].tone === toneA ? ALT[toneA] : undefined;
          return (
            <div key={`${a.id}-${b.id}`} className={cn("grid grid-cols-1 gap-4", wideFirst ? "@3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" : "@3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]")}>
              <DashboardCard d={ordered[0]} compact={compact} onRemove={ordered[0].custom ? onRemove : undefined} />
              <DashboardCard d={ordered[1]} compact={compact} onRemove={ordered[1].custom ? onRemove : undefined} tone={toneB} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardCard({ d, compact, onRemove, tone }: { d: DashboardData; compact?: boolean; onRemove?: (id: string) => void; tone?: Tone }) {
  const look = LOOK[d.kind] ?? LOOK.events;
  const t = tone ?? look.tone;
  return (
    <Card
      tone={t}
      shape={look.shape}
      corner={look.corner}
      className={cn("@container flex min-w-0 flex-col [&>div.relative]:flex [&>div.relative]:flex-1 [&>div.relative]:flex-col", compact ? "p-5" : "p-6")}
      data-dashboard={d.id}
    >
      <CardTitle
        right={
          (d.custom || d.empty || onRemove) && (
            <span className="flex items-center gap-1.5">
              {d.custom && <Tag tone="ink">You asked</Tag>}
              {d.empty && <Tag tone="white">Waiting for data</Tag>}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(d.id)}
                  aria-label={`Remove ${d.title}`}
                  title="Remove this chart"
                  className="-mr-1 grid size-7 place-items-center rounded-full text-dw-ink/60 transition-colors hover:bg-white/70 hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
                >
                  <X className="size-4" />
                </button>
              )}
            </span>
          )
        }
      >
        <span className={cn(compact && "text-[19px]")}>{d.title}</span>
      </CardTitle>
      {!compact && <p className="mt-1 max-w-[40rem] text-[14px] leading-snug text-dw-ink/70">{d.why}</p>}
      <div className={cn("flex flex-1 flex-col", compact ? "mt-3" : "mt-5")}>{d.empty ? <Waiting kind={d.kind} /> : <Body d={d} compact={compact} ring={TONE[t].bg} />}</div>
    </Card>
  );
}

function Waiting({ kind }: { kind: DashboardKind }) {
  const look = LOOK[kind] ?? LOOK.events;
  return (
    <div className="flex flex-1 items-center gap-4 rounded-[20px] border-[1.5px] border-dashed border-dw-ink/20 bg-white/30 px-4 py-4">
      <Mascot kind={look.shape} size={44} frame active />
      <p className="flex items-center gap-2 text-[14px] text-dw-ink/70">
        <LiveDot />
        {kind === "experiments" ? "No tests yet. Darwin starts them once visitors arrive." : "Listening for the first events…"}
      </p>
    </div>
  );
}

const SOURCE_ICON: Record<string, ReactNode> = {
  ai: <Sparkles />,
  search: <Search />,
  social: <Share2 />,
  paid: <Megaphone />,
  email: <Mail />,
  referral: <Link2 />,
  direct: <MousePointerClick />,
};
const DEVICE_ICON: Record<string, ReactNode> = { Mobile: <Smartphone />, Desktop: <Monitor />, Tablet: <Tablet /> };

function RowIcon({ children }: { children: ReactNode }) {
  return <span className="dw-tilt grid size-7 shrink-0 place-items-center rounded-[9px] bg-white/75 shadow-[inset_0_1px_0_#fff,0_0_0_1px_rgba(20,20,19,0.06)] [&_svg]:size-3.5">{children}</span>;
}

function Body({ d, compact, ring }: { d: DashboardData; compact?: boolean; ring: string }) {
  switch (d.kind) {
    case "kpis":
      return (
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          {d.kpis?.map((k, i) => (
            <div key={k.label} className="min-w-[6.5rem]">
              <div className={cn("num leading-none font-semibold tracking-[-0.03em]", compact ? "text-[28px]" : "text-[38px]")}>{k.value}</div>
              <div className={cn("mt-1.5 text-[12px] tracking-[0.02em] text-dw-ink/70 uppercase", i === 0 && "w-fit border-b-2 border-dw-ink pb-1 text-dw-ink")}>{k.label}</div>
              {k.hint && <div className="mt-1 text-[12.5px] text-dw-ink/60">{k.hint}</div>}
            </div>
          ))}
        </div>
      );
    case "funnel": {
      const steps = d.steps ?? [];
      const first = steps[0]?.visitors ?? 0;
      return (
        <div className="grid items-start gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => {
            const prev = i ? steps[i - 1].visitors : s.visitors;
            const drop = i && prev ? 1 - s.visitors / prev : 0;
            const last = i === steps.length - 1;
            return (
              <div key={s.event} className="flex min-w-0 flex-col items-center text-center">
                <TrackPill
                  value={s.visitors}
                  max={first}
                  height={compact ? 88 : 116}
                  width={compact ? 24 : 28}
                  label={pct(s.rate, 0)}
                  tip={`${int(s.visitors)} of ${int(first)} visitors`}
                />
                <span className={cn("mt-2 line-clamp-2 text-[12.5px] leading-tight", last ? "font-semibold" : "text-dw-ink/80")} title={s.event}>
                  {s.label}
                </span>
                <span className="num mt-0.5 font-dwmono text-[11.5px] text-dw-ink/60">{int(s.visitors)}</span>
                {i > 0 && drop > 0.5 && (
                  <span className="mt-1 rounded-full bg-dw-warn-bg px-1.5 text-[11px] font-medium text-dw-warn" title={`${pct(drop, 0)} drop from the step before`}>
                    −{pct(drop, 0)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    case "humans-agents": {
      const rows = d.rows ?? [];
      const max = Math.max(0.001, ...rows.map((r) => r.rate));
      const human = rows.find((r) => !/agent/i.test(r.key));
      const agent = rows.find((r) => /agent/i.test(r.key));
      const ratio = human && agent && human.rate > 0 && agent.rate > 0 ? agent.rate / human.rate : undefined;
      return (
        <div className="flex flex-1 flex-wrap items-end gap-x-6 gap-y-4">
          <div className="flex items-end gap-5">
            {rows.map((r) => {
              const isAgent = /agent/i.test(r.key);
              return (
                <div key={r.key} className="flex flex-col items-center">
                  <Pill value={r.rate} max={max} height={compact ? 90 : 116} width={30} dashed={isAgent} label={pct(r.rate)} tip={`${int(r.conversions)} of ${int(r.visitors)} converted`} />
                  <span className="mt-2 text-[12.5px] font-medium">{r.label}</span>
                  <span className="num font-dwmono text-[11.5px] text-dw-ink/60">{int(r.visitors)}</span>
                </div>
              );
            })}
          </div>
          <div className="min-w-[9rem] flex-1 pb-8">
            {ratio !== undefined ? (
              <>
                <div className="num text-[40px] leading-none font-semibold tracking-[-0.03em]">{ratio >= 1 ? `${ratio.toFixed(1)}×` : `${(1 / ratio).toFixed(1)}×`}</div>
                <p className="mt-1.5 text-[13px] leading-snug text-dw-ink/75">{ratio >= 1 ? "AI agents convert this many times as often as people." : "People convert this many times as often as AI agents."}</p>
              </>
            ) : (
              <p className="text-[13px] text-dw-ink/70">Needs a purchase from both people and agents to compare.</p>
            )}
            <div className="mt-3 flex gap-3">
              <LegendKey>People</LegendKey>
              <LegendKey dashed>Agents</LegendKey>
            </div>
          </div>
        </div>
      );
    }
    case "sources":
    case "devices": {
      const rows = (d.rows ?? []).slice(0, compact ? 5 : 8);
      const max = Math.max(1, ...rows.map((r) => r.visitors));
      const all = d.rows ?? [];
      const avg = all.reduce((a, r) => a + r.conversions, 0) / Math.max(1, all.reduce((a, r) => a + r.visitors, 0));
      return (
        <div className="flex flex-1 flex-col">
          <div className="mb-1.5 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem_3.5rem] gap-3 text-[11.5px] text-dw-ink/60">
            <span />
            <span>Visitors</span>
            <span />
            <span className="text-right">Converts</span>
          </div>
          <ul className="flex flex-col gap-1">
            {rows.map((r) => {
              const low = r.visitors >= 20 && r.rate < avg * 0.75;
              return (
                <li key={r.key} className="dw-row group relative grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem_3.5rem] items-center gap-3 py-1" tabIndex={0}>
                  <span className="flex min-w-0 items-center gap-2">
                    <RowIcon>{(d.kind === "devices" ? DEVICE_ICON[r.key] : SOURCE_ICON[r.key]) ?? (r.key === "ai" ? <Bot /> : <CircleHelp />)}</RowIcon>
                    <span className="truncate text-[13.5px] font-medium">{r.label}</span>
                  </span>
                  <HBar value={r.visitors / max} className="h-2.5" />
                  <span className="num text-right font-dwmono text-[12.5px] text-dw-ink/70">{int(r.visitors)}</span>
                  <span className={cn("num text-right font-dwmono text-[12.5px]", low ? "font-semibold text-dw-warn" : "text-dw-ink")} title={low ? "Converts well below the site average" : undefined}>
                    {pct(r.rate)}
                  </span>
                  <Tip>
                    {int(r.conversions)} of {int(r.visitors)} converted{low ? " · below average" : ""}
                  </Tip>
                </li>
              );
            })}
          </ul>
          {d.kind === "devices" && <DeviceGap rows={all} />}
        </div>
      );
    }
    case "heatmap":
      return (
        <ul className="flex flex-col gap-1.5">
          {d.clicks?.slice(0, compact ? 5 : 8).map((c) => (
            <li key={c.selector} className="dw-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" title={c.selector}>
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[13.5px] font-medium">{c.label}</span>
                <span className="hidden min-w-0 truncate font-dwmono text-[11px] text-dw-ink/50 @md:inline">{c.selector}</span>
              </div>
              <span className="flex items-center gap-1.5">
                {c.rage > 0 && (
                  <Tag tone="warn" className="h-5 px-2 text-[11px]">
                    {int(c.rage)} rage
                  </Tag>
                )}
                <span className="num w-10 text-right font-dwmono text-[12.5px]">{pct(c.share, 0)}</span>
              </span>
              <HBar value={c.share / Math.max(0.01, d.clicks![0]?.share ?? 1)} className="col-span-2 h-2" />
            </li>
          ))}
        </ul>
      );
    case "experiments":
      return (
        <ul className="flex flex-col gap-2">
          {d.tests?.slice(0, compact ? 3 : 6).map((t, i) => (
            <li key={`${t.name}-${i}`} className="dw-row rounded-[18px] bg-white/55 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-semibold">{t.name}</span>
                <Tag tone={t.status === "Shipped" ? "win" : t.status === "Testing" ? "ink" : t.status === "Live" ? "yellow" : "sand"}>{t.status}</Tag>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-dw-ink/65">
                <span className="truncate">{t.audience}</span>
                <span className="num flex items-center gap-1.5 font-dwmono text-dw-ink">
                  <span className="inline-grid size-[18px] place-items-center rounded-[5px] border border-dashed border-dw-ink/60 text-[10.5px] font-semibold">A</span>
                  {pct(t.control)}
                  <span className="text-dw-ink/40">→</span>
                  <span className="inline-grid size-[18px] place-items-center rounded-[5px] bg-dw-ink text-[10.5px] font-semibold text-white">B</span>
                  {pct(t.treatment)}
                  {t.probability !== undefined && <span className="text-dw-ink/60">· {pct(t.probability, 0)} better</span>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      );
    case "revenue":
    case "events":
      return (
        <div className={cn("grid grid-cols-1 gap-x-10 gap-y-5", (d.series?.length ?? 0) > 1 && "@3xl:grid-cols-2")}>
          {d.series?.map((s) => {
            const first = s.points[0]?.t;
            return (
              <div key={s.name} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13.5px] text-dw-ink/75">{s.label}</span>
                  <span className="num shrink-0 text-[24px] leading-none font-semibold tracking-[-0.02em]">{d.kind === "revenue" ? gbp(s.total) : int(s.total)}</span>
                </div>
                <SmoothLine
                  values={s.points.map((p) => p.v)}
                  height={compact ? 48 : (d.series?.length ?? 1) > 2 ? 56 : 76}
                  ring={ring}
                  className="mt-2"
                  label={`${s.label}: ${d.kind === "revenue" ? gbp(s.total) : int(s.total)} over the last ${s.points.length} minutes`}
                />
                {!compact && first && (
                  <div className="mt-1.5 flex justify-between font-dwmono text-[11px] text-dw-ink/55">
                    <span>{new Date(first).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="font-semibold text-dw-ink">now</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
  }
}

/** "Is mobile converting worse than desktop, and by how much?" answered in one number. */
function DeviceGap({ rows }: { rows: NonNullable<DashboardData["rows"]> }) {
  const mobile = rows.find((r) => r.key === "Mobile");
  const desktop = rows.find((r) => r.key === "Desktop");
  if (!mobile || !desktop || desktop.rate <= 0 || mobile.visitors < 1) return null;
  const rel = mobile.rate / desktop.rate - 1;
  const same = Math.abs(rel) < 0.05;
  return (
    <div className="mt-auto flex items-end gap-3 pt-5">
      <span className="num text-[40px] leading-none font-semibold tracking-[-0.03em]">{same ? "≈" : `${rel > 0 ? "+" : "−"}${Math.abs(Math.round(rel * 100))}%`}</span>
      <span className="pb-1 text-[13px] leading-snug text-dw-ink/75">
        {same ? "Mobile converts about as well as desktop." : `Mobile converts ${Math.abs(Math.round(rel * 100))}% ${rel > 0 ? "more" : "less"} often than desktop.`}
      </span>
    </div>
  );
}
