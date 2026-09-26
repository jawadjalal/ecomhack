"use client";

import { useId } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { AnalyticsSummary, LoopState } from "@/lib/contracts";
import { count, money, pct, pp, signedPct } from "@/lib/console/format";
import { useSamples } from "@/lib/console/hooks";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { cn } from "@/components/ui/cn";

const MIN_SAMPLE = 120;

export function Sparkline({
  values,
  color,
  className,
  highlightLast = true,
}: {
  values: number[];
  color: string;
  className?: string;
  highlightLast?: boolean;
}) {
  const id = `spark${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const W = 100;
  const H = 32;
  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" aria-hidden>
        <line x1="0" y1={H - 2} x2={W} y2={H - 2} stroke="white" strokeOpacity={0.08} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    );
  }
  // zero-based: a small wobble must not look like a crash
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <div className={cn("relative", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.22} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {highlightLast && (
        <span
          className="absolute size-[0.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[#0b0d12]"
          style={{ left: `${lx}%`, top: `${(ly / H) * 100}%`, background: color }}
        />
      )}
    </div>
  );
}

function Delta({ value, label, format }: { value?: number; label?: string; format: (v: number) => string }) {
  if (value === undefined || !Number.isFinite(value)) return <span className="text-[0.78rem] text-white/30">{label ?? "baseline pending"}</span>;
  const up = value > 0.00005;
  const down = value < -0.00005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.8rem]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular",
          up ? "bg-good/12 text-[#7ee2a0]" : down ? "bg-bad/12 text-[#ff9b9b]" : "bg-white/[0.06] text-white/60",
        )}
      >
        <Icon className="size-[0.85rem]" />
        {format(value)}
      </span>
      {label && <span className="text-white/40">{label}</span>}
    </span>
  );
}

function Tile({
  label,
  dot,
  value,
  format,
  delta,
  sub,
  spark,
  sparkColor,
}: {
  label: string;
  dot?: string;
  value?: number;
  format: (v: number) => string;
  delta: React.ReactNode;
  sub?: React.ReactNode;
  spark: number[];
  sparkColor: string;
}) {
  return (
    <div className="relative flex min-w-0 flex-col justify-between overflow-hidden rounded-[1.1rem] border border-white/[0.07] bg-[#0b0d12]/85 px-5 pt-3.5 pb-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.045)]">
      <div className="flex items-center gap-2 text-[0.74rem] font-medium tracking-[0.1em] whitespace-nowrap text-white/50 uppercase">
        {dot && <span className="size-[0.55rem] shrink-0 rounded-full" style={{ background: dot }} />}
        {label}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.025em] text-white tabular">
          {value === undefined ? <span className="text-white/25">–</span> : <AnimatedNumber value={value} format={format} />}
        </div>
        <Sparkline values={spark} color={sparkColor} className="mb-1.5 h-[2.4rem] w-[42%] max-w-[8rem] shrink-0" />
      </div>
      <div className="flex h-[1.4rem] items-center justify-between gap-2">
        {delta}
        {sub && <span className="truncate text-[0.7rem] text-white/30 tabular">{sub}</span>}
      </div>
    </div>
  );
}

export function KpiTiles({
  loop,
  summaryAll,
  summaryGen,
  summaryGen0,
}: {
  loop?: LoopState;
  summaryAll?: AnalyticsSummary;
  summaryGen?: AnalyticsSummary;
  summaryGen0?: AnalyticsSummary;
}) {
  const history = loop?.history ?? [];
  const gen0 = history[0];
  const latest = history.at(-1);
  const gen = loop?.generation ?? 0;

  const measured = (kind: "human" | "agent") => {
    const seg = summaryGen?.byKind[kind];
    if (seg && seg.visitors >= (kind === "human" ? MIN_SAMPLE : MIN_SAMPLE / 3)) return { value: seg.conversionRate, n: seg.visitors, live: true };
    const rec = latest && latest.generation === gen ? latest : undefined;
    if (rec) return { value: kind === "human" ? rec.humanConversionRate : rec.agentConversionRate, n: undefined, live: false };
    const all = summaryAll?.byKind[kind];
    if (all && all.visitors > 0) return { value: all.conversionRate, n: all.visitors, live: true };
    return { value: undefined, n: undefined, live: false };
  };
  const human = measured("human");
  const agent = measured("agent");

  const rpvOf = (s?: AnalyticsSummary) => (s && s.overall.visitors >= MIN_SAMPLE ? s.overall.revenue / s.overall.visitors : undefined);
  const rpv = rpvOf(summaryGen) ?? rpvOf(summaryAll);
  const rpv0 = rpvOf(summaryGen0);
  const orders = summaryAll?.overall.orders;
  const revenue = summaryAll?.overall.revenue;

  const humanSpark = [...history.map((h) => h.humanConversionRate), ...(human.live && human.value !== undefined ? [human.value] : [])];
  const agentSpark = [...history.map((h) => h.agentConversionRate), ...(agent.live && agent.value !== undefined ? [agent.value] : [])];
  const rpvSpark = useSamples(rpv === undefined ? undefined : Math.round(rpv), 40, gen === 0 && history.length === 0 ? "fresh" : "run");
  const orderSpark = useSamples(orders, 40, gen === 0 && history.length === 0 ? "fresh" : "run");

  const crDelta = (v?: number, base?: number) =>
    v !== undefined && base !== undefined && gen0 ? (
      <Delta value={v - base} format={(d) => pp(d)} label={`${signedPct(base ? (v - base) / base : 0)} vs G0`} />
    ) : (
      <Delta value={undefined} format={pct} label="baseline pending" />
    );

  const sub = (n?: number) => (n !== undefined ? `n=${count(n)}` : `G${gen}`);

  return (
    <div className="grid h-full grid-cols-4 gap-4">
      <Tile
        label="Human conversion"
        dot="var(--color-human)"
        value={human.value}
        format={(v) => pct(v, 1)}
        delta={crDelta(human.value, gen0?.humanConversionRate)}
        sub={sub(human.n)}
        spark={humanSpark}
        sparkColor="#4c94f0"
      />
      <Tile
        label="Agent conversion"
        dot="var(--color-agent)"
        value={agent.value}
        format={(v) => pct(v, 0)}
        delta={crDelta(agent.value, gen0?.agentConversionRate)}
        sub={sub(agent.n)}
        spark={agentSpark}
        sparkColor="#e0609a"
      />
      <Tile
        label="Revenue / visitor"
        value={rpv}
        format={(v) => money(v)}
        delta={
          rpv !== undefined && rpv0 !== undefined && gen > 0 ? (
            <Delta value={(rpv - rpv0) / rpv0} format={(d) => signedPct(d)} label="vs G0" />
          ) : (
            <Delta value={undefined} format={pct} label="all visitors" />
          )
        }
        spark={rpvSpark}
        sparkColor="#b6f05a"
      />
      <Tile
        label="Orders"
        value={orders}
        format={(v) => count(v)}
        delta={
          <span className="text-[0.8rem] text-white/45">
            {revenue !== undefined ? <span className="font-medium text-white/70 tabular">{money(revenue, { compact: true })}</span> : "–"} revenue
          </span>
        }
        sub={summaryGen ? `${count(summaryGen.overall.orders)} in G${gen}` : undefined}
        spark={orderSpark}
        sparkColor="#b6f05a"
      />
    </div>
  );
}
