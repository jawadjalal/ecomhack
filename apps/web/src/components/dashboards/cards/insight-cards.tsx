"use client";

/**
 * Cards for the "ask for anything" charts: trend, big number, retention, paths, lifecycle, breakdown,
 * time to buy and day × hour. Ink-only, hand-built SVG / CSS, no gradients, sized by their container.
 */
import type { ReactNode } from "react";
import type { DashboardData } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { HBar, Tag } from "@/components/dw/ui";

const int = (n: number) => Math.round(n).toLocaleString("en-GB");
const gbp = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const INK = "#141413";
/** Line styles for up to six series, ink only: solid, dashed, dotted, then lighter. */
const STROKES: { dash?: string; opacity: number; width: number }[] = [
  { opacity: 1, width: 2.25 },
  { dash: "6 4", opacity: 0.85, width: 2 },
  { dash: "1.5 4", opacity: 0.85, width: 2.25 },
  { opacity: 0.4, width: 2 },
  { dash: "6 4", opacity: 0.4, width: 2 },
  { dash: "1.5 4", opacity: 0.4, width: 2 },
];
const FILLS = [1, 0.62, 0.36, 0.2, 0.12, 0.07];

function when(iso: string, interval: "minute" | "hour" | "day") {
  const d = new Date(iso);
  if (interval === "day") return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
const SPAN: Record<"minute" | "hour" | "day", string> = { minute: "30 minutes", hour: "24 hours", day: "14 days" };

function Change({ now, before, span }: { now: number; before: number; span: string }) {
  if (before <= 0) return <span className="text-[12.5px] text-dw-ink/60">Nothing in the {span} before</span>;
  const c = now / before - 1;
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-dw-ink/70">
      <Tag tone={c >= 0 ? "win" : "warn"} className="h-5 px-2 text-[11px]">
        {c >= 0 ? "+" : "−"}
        {Math.abs(Math.round(c * 100))}%
      </Tag>
      vs the {span} before
    </span>
  );
}

function Simulated({ share }: { share?: number }) {
  if (!share) return null;
  return (
    <span title="Share of this chart's events made by Darwin's simulator">
      <Tag tone="warn" className="h-5 px-2 text-[11px]">
        {share >= 0.995 ? "Simulated" : `${pct(share)} simulated`}
      </Tag>
    </span>
  );
}

function Swatch({ i, bars }: { i: number; bars?: boolean }) {
  const s = STROKES[i % STROKES.length];
  if (bars) return <span className="size-2.5 rounded-[3px] border border-dw-ink/30" style={{ background: `rgba(20,20,19,${FILLS[i % FILLS.length]})` }} />;
  return (
    <svg width="18" height="6" aria-hidden className="shrink-0">
      <line x1="1" y1="3" x2="17" y2="3" stroke={INK} strokeOpacity={s.opacity} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
    </svg>
  );
}

function Axis({ first, last }: { first: string; last: string }) {
  return (
    <div className="mt-1.5 flex justify-between font-dwmono text-[11px] text-dw-ink/55">
      <span>{first}</span>
      <span className="font-semibold text-dw-ink">{last}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ trend */

function Trend({ t, compact }: { t: NonNullable<DashboardData["trend"]>; compact?: boolean }) {
  const n = t.buckets.length;
  const W = 600;
  const H = 100;
  const bars = t.display === "bars";
  const stackMax = Math.max(1, ...t.buckets.map((_, i) => t.series.reduce((a, s) => a + s.values[i], 0)));
  const lineMax = Math.max(1, ...t.series.flatMap((s) => s.values), ...(t.series.length === 1 ? t.previous : []));
  const fmt = (v: number) => (t.money ? gbp(v) : int(v));
  const y = (v: number) => 94 - (Math.max(0, v) / lineMax) * 86;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${((i / (n - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <span className="num text-[30px] leading-none font-semibold tracking-[-0.03em]">{fmt(t.total)}</span>
        <Change now={t.total} before={t.previousTotal} span={SPAN[t.interval]} />
      </div>
      <div className="relative mt-3 w-full" style={{ height: compact ? 70 : 110 }} role="img" aria-label={`${fmt(t.total)} in the last ${SPAN[t.interval]}`}>
        {bars ? (
          <div className="absolute inset-0 flex items-end gap-[3px]">
            {t.buckets.map((b, i) => {
              const sum = t.series.reduce((a, s) => a + s.values[i], 0);
              return (
                <div key={b} className="group relative flex h-full min-w-0 flex-1 flex-col-reverse" title={`${when(b, t.interval)}: ${fmt(sum)}`}>
                  {t.series.map((s, si) => (
                    <span
                      key={s.key}
                      className={cn("block w-full", si === t.series.length - 1 && "rounded-t-[4px]", si === 0 && "rounded-b-[2px]")}
                      style={{ height: `${(s.values[i] / stackMax) * 100}%`, background: `rgba(20,20,19,${FILLS[si % FILLS.length]})` }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <line x1="0" x2={W} y1="94" y2="94" stroke={INK} strokeOpacity="0.15" vectorEffect="non-scaling-stroke" />
            {t.series.length === 1 && t.previousTotal > 0 && (
              <path d={path(t.previous)} fill="none" stroke={INK} strokeOpacity="0.28" strokeWidth={1.5} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            )}
            {t.series.map((s, i) => {
              const st = STROKES[i % STROKES.length];
              return (
                <path
                  key={s.key}
                  d={path(s.values)}
                  fill="none"
                  stroke={INK}
                  strokeOpacity={st.opacity}
                  strokeWidth={st.width}
                  strokeDasharray={st.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
      </div>
      {!compact && <Axis first={when(t.buckets[0], t.interval)} last={t.interval === "day" ? "today" : "now"} />}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {t.series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px] text-dw-ink/75">
            <Swatch i={i} bars={bars} />
            {s.label}
            <span className="num font-dwmono text-dw-ink/55">{fmt(s.total)}</span>
          </span>
        ))}
        {!bars && t.series.length === 1 && t.previousTotal > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-dw-ink/60">
            <svg width="18" height="6" aria-hidden>
              <line x1="1" y1="3" x2="17" y2="3" stroke={INK} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 4" />
            </svg>
            The {SPAN[t.interval]} before
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ number */

function Spark({ values }: { values: number[] }) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, n - 1)) * 100).toFixed(1)},${(28 - (v / max) * 24).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-10 w-full max-w-[14rem]" aria-hidden>
      <path d={d} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function BigNumber({ n }: { n: NonNullable<DashboardData["number"]> }) {
  const fmt = (v: number) => (n.money ? gbp(v) : int(v));
  const before = n.period === "today" ? "yesterday by now" : n.period === "in the last hour" ? "the hour before" : "the 7 days before";
  return (
    <div className="flex flex-1 flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <div className="num text-[56px] leading-[0.9] font-semibold tracking-[-0.04em]">{fmt(n.value)}</div>
        <div className="mt-2 text-[13px] text-dw-ink/70">
          {n.label} {n.period}
        </div>
      </div>
      <div className="flex min-w-[10rem] flex-1 flex-col items-end gap-1.5">
        <Spark values={n.spark} />
        {n.change !== undefined ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-dw-ink/70">
            <Tag tone={n.change >= 0 ? "win" : "warn"} className="h-5 px-2 text-[11px]">
              {n.change >= 0 ? "+" : "−"}
              {Math.abs(Math.round(n.change * 100))}%
            </Tag>
            vs {fmt(n.previous)} {before}
          </span>
        ) : (
          <span className="text-[12.5px] text-dw-ink/60">Nothing {before} to compare with</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ retention */

function Retention({ r, compact }: { r: NonNullable<DashboardData["retention"]>; compact?: boolean }) {
  const cols = Array.from({ length: Math.max(1, ...r.cohorts.map((c) => c.returned.length)) }, (_, i) => i);
  const cohorts = r.cohorts.slice(compact ? -4 : -7);
  const later = cohorts.flatMap((c) => c.returned.slice(1).map((v) => ({ v, size: c.size })));
  const back = later.reduce((a, x) => a + x.v, 0) / Math.max(1, later.reduce((a, x) => a + x.size, 0));
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-[12px]">
          <thead>
            <tr className="text-dw-ink/60">
              <th className="text-left font-normal">First visit</th>
              <th className="text-right font-normal">People</th>
              {cols.map((c) => (
                <th key={c} className="min-w-9 text-center font-normal">
                  {c === 0 ? "Day 0" : `+${c}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.day}>
                <td className="font-dwmono whitespace-nowrap text-dw-ink/80">{new Date(c.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}</td>
                <td className="num text-right font-dwmono">{int(c.size)}</td>
                {cols.map((i) => {
                  const v = c.returned[i];
                  if (v === undefined) return <td key={i} />;
                  const rate = c.size ? v / c.size : 0;
                  return (
                    <td
                      key={i}
                      className={cn("num h-7 rounded-[6px] text-center font-dwmono", rate > 0.5 ? "text-white" : "text-dw-ink")}
                      style={{ background: `rgba(20,20,19,${0.06 + rate * 0.88})` }}
                      title={`${int(v)} of ${int(c.size)} came back`}
                    >
                      {pct(rate)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[13px] leading-snug text-dw-ink/75">
        {later.length ? `${pct(back)} of shoppers came back on a later day.` : "Come back tomorrow: returns show from the day after someone's first visit."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ paths */

function Paths({ p, compact }: { p: NonNullable<DashboardData["paths"]>; compact?: boolean }) {
  const max = Math.max(1, ...p.paths.map((x) => x.count));
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] text-dw-ink/65">
        After <span className="font-semibold text-dw-ink">{p.fromLabel}</span> · {int(p.total)} {p.total === 1 ? "person" : "people"}
      </p>
      <ol className="mt-2 flex flex-col gap-2">
        {p.paths.slice(0, compact ? 3 : 5).map((x, i) => (
          <li key={i} className="dw-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
              {x.steps.map((s, si) => (
                <span key={si} className="flex min-w-0 items-center gap-1">
                  {si > 0 && <span className="text-dw-ink/40">→</span>}
                  <span className={cn("max-w-[12rem] truncate rounded-full px-2 py-0.5", s === "Left the store" ? "border border-dashed border-dw-ink/40 text-dw-ink/70" : "bg-white/70 font-medium")}>{s}</span>
                </span>
              ))}
            </span>
            <span className="num text-right font-dwmono text-[12.5px]">
              {int(x.count)} <span className="text-dw-ink/55">· {pct(x.count / Math.max(1, p.total))}</span>
            </span>
            <HBar value={x.count / max} className="col-span-2 h-1.5" />
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ lifecycle */

const LIFE: { key: "new" | "returning" | "resurrecting"; label: string; fill: number }[] = [
  { key: "new", label: "New", fill: 1 },
  { key: "returning", label: "Returning", fill: 0.5 },
  { key: "resurrecting", label: "Came back", fill: 0.22 },
];

function Lifecycle({ l, compact }: { l: NonNullable<DashboardData["lifecycle"]>; compact?: boolean }) {
  const up = Math.max(1, ...l.rows.map((r) => r.new + r.returning + r.resurrecting));
  const down = Math.max(0, ...l.rows.map((r) => r.dormant));
  const total = Math.max(1, up + down);
  const H = compact ? 80 : 130;
  const upH = (up / total) * H;
  const sum = (k: "new" | "returning" | "resurrecting" | "dormant") => l.rows.reduce((a, r) => a + r[k], 0);
  return (
    <div className="min-w-0">
      <div className="relative flex w-full gap-[3px]" style={{ height: H }} role="img" aria-label={`New ${sum("new")}, returning ${sum("returning")}, came back ${sum("resurrecting")}, gone quiet ${sum("dormant")}`}>
        <span className="absolute inset-x-0 border-t border-dw-ink/25" style={{ top: upH }} />
        {l.rows.map((r) => (
          <div key={r.t} className="flex min-w-0 flex-1 flex-col" title={`${when(r.t, l.interval)}: ${r.new} new, ${r.returning} returning, ${r.resurrecting} came back, ${r.dormant} gone quiet`}>
            <div className="flex flex-col-reverse" style={{ height: upH }}>
              {LIFE.map((s, i) => (
                <span key={s.key} className={cn("block w-full", i === LIFE.length - 1 && "rounded-t-[3px]")} style={{ height: `${(r[s.key] / up) * 100}%`, background: `rgba(20,20,19,${s.fill})` }} />
              ))}
            </div>
            {down > 0 && (
              <div style={{ height: H - upH }}>
                <span className="block w-full rounded-b-[3px] border border-t-0 border-dashed border-dw-ink/70" style={{ height: `${(r.dormant / down) * 100}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
      {!compact && <Axis first={when(l.rows[0].t, l.interval)} last={l.interval === "day" ? "today" : "now"} />}
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-dw-ink/75">
        {LIFE.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] border border-dw-ink/30" style={{ background: `rgba(20,20,19,${s.fill})` }} />
            {s.label} <span className="num font-dwmono text-dw-ink/55">{int(sum(s.key))}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] border border-dashed border-dw-ink" />
          Gone quiet <span className="num font-dwmono text-dw-ink/55">{int(sum("dormant"))}</span>
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ breakdown */

function Breakdown({ b, compact }: { b: NonNullable<DashboardData["bars"]>; compact?: boolean }) {
  const max = Math.max(1, ...b.items.map((x) => x.count));
  return (
    <div className="min-w-0">
      <div className="mb-1.5 grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem_3rem] gap-3 text-[11.5px] text-dw-ink/60">
        <span>{b.propertyLabel}</span>
        <span />
        <span className="text-right">Count</span>
        <span className="text-right">Share</span>
      </div>
      <ul className="flex flex-col gap-1">
        {b.items.slice(0, compact ? 5 : 8).map((x) => (
          <li key={x.key} className="dw-row grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem_3rem] items-center gap-3 py-1" title={`${int(x.count)} of ${int(b.total)}`}>
            <span className="truncate text-[13.5px] font-medium">{x.label}</span>
            <HBar value={x.count / max} className="h-2.5" />
            <span className="num text-right font-dwmono text-[12.5px] text-dw-ink/70">{int(x.count)}</span>
            <span className="num text-right font-dwmono text-[12.5px]">{pct(x.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ time to convert */

function human(ms: number) {
  if (ms < 1000) return "under a second";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} days`;
}

function Histogram({ h, compact }: { h: NonNullable<DashboardData["histogram"]>; compact?: boolean }) {
  const max = Math.max(1, ...h.bins.map((b) => b.count));
  return (
    <div className="min-w-0">
      {h.medianMs !== undefined && (
        <div className="flex items-baseline gap-2">
          <span className="num text-[30px] leading-none font-semibold tracking-[-0.03em]">{human(h.medianMs)}</span>
          <span className="text-[13px] text-dw-ink/70">typical time from first visit to order ({int(h.total)} orders)</span>
        </div>
      )}
      <div className="mt-3 grid items-end gap-2" style={{ gridTemplateColumns: `repeat(${h.bins.length}, minmax(0, 1fr))`, height: compact ? 90 : 130 }}>
        {h.bins.map((b) => (
          <div key={b.label} className="flex h-full flex-col items-center justify-end" title={`${b.label}: ${int(b.count)}`}>
            <span className="num mb-1 font-dwmono text-[11px] text-dw-ink/70">{b.count ? int(b.count) : ""}</span>
            <span className="block w-full max-w-10 rounded-t-[6px] bg-dw-ink" style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 grid gap-2 border-t border-dw-ink/20 pt-1" style={{ gridTemplateColumns: `repeat(${h.bins.length}, minmax(0, 1fr))` }}>
        {h.bins.map((b) => (
          <span key={b.label} className="text-center text-[10.5px] leading-tight text-dw-ink/65">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hourly */

function Hourly({ g, compact }: { g: NonNullable<DashboardData["grid"]>; compact?: boolean }) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="min-w-0">
      <div className="grid gap-[2px]" style={{ gridTemplateColumns: "2.2rem repeat(24, minmax(0, 1fr))" }}>
        <span />
        {hours.map((h) => (
          <span key={h} className="text-center font-dwmono text-[9.5px] text-dw-ink/50">
            {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
          </span>
        ))}
        {g.days.map((day, di) => (
          <Row key={day} label={day}>
            {g.cells[di].map((c, h) => (
              <span
                key={h}
                className={cn("block rounded-[3px]", compact ? "h-3" : "h-4")}
                style={{ background: c ? `rgba(20,20,19,${0.12 + (c / Math.max(1, g.max)) * 0.88})` : "rgba(20,20,19,0.05)" }}
                title={`${day} ${String(h).padStart(2, "0")}:00: ${int(c)}`}
              />
            ))}
          </Row>
        ))}
      </div>
      <p className="mt-2.5 text-[13px] leading-snug text-dw-ink/75">
        {g.peak ? `Busiest: ${g.peak.day} ${String(g.peak.hour).padStart(2, "0")}:00–${String((g.peak.hour + 1) % 24).padStart(2, "0")}:00 UTC (${int(g.peak.count)}). ` : ""}
        Last 28 days, {int(g.total)} in all.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="self-center font-dwmono text-[11px] text-dw-ink/65">{label}</span>
      {children}
    </>
  );
}

/* ------------------------------------------------------------------ entry */

/** The body of a card for the newer kinds; null for kinds this file doesn't draw. */
export function InsightBody({ d, compact }: { d: DashboardData; compact?: boolean }) {
  const body = d.trend ? (
    <Trend t={d.trend} compact={compact} />
  ) : d.number ? (
    <BigNumber n={d.number} />
  ) : d.retention ? (
    <Retention r={d.retention} compact={compact} />
  ) : d.paths ? (
    <Paths p={d.paths} compact={compact} />
  ) : d.lifecycle ? (
    <Lifecycle l={d.lifecycle} compact={compact} />
  ) : d.bars ? (
    <Breakdown b={d.bars} compact={compact} />
  ) : d.histogram ? (
    <Histogram h={d.histogram} compact={compact} />
  ) : d.grid ? (
    <Hourly g={d.grid} compact={compact} />
  ) : null;
  if (!body) return null;
  return (
    <div className="flex flex-1 flex-col">
      {d.simulated ? (
        <div className="-mt-1 mb-2 flex justify-end">
          <Simulated share={d.simulated} />
        </div>
      ) : null}
      {body}
    </div>
  );
}
