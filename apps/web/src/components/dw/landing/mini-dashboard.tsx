/**
 * A live, miniature Darwin Overview for the landing page: Conversion (line over pill columns), A vs B
 * (pills, lift, chance B wins), Which agents buy (official logos) and the latest AI shoppers. Every
 * number comes from the in-browser demo engine (see use-live-demo.ts) and is labelled simulated.
 * Rendered on a fixed design canvas, scaled to fit and tilted back in perspective.
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AgentSessionSummary, Experiment, LoopPhase } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Mascot } from "@/components/dw/mascot";
import { AgentTile, agentBrand, type AgentBrand } from "@/components/dw/agent-tile";
import { ArmChip, Card, HBar, LegendKey, LiveDot, PillBar, Typing } from "@/components/dw/ui";
import { useLiveDemo, type LiveDemo } from "./use-live-demo";

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

const PHASE_LINE: Record<LoopPhase, string> = {
  idle: "Opening the store",
  observe: "Watching shoppers",
  diagnose: "Finding where they drop off",
  propose: "Drafting a fix",
  experiment: "Testing the fix",
  decide: "Reading the result",
  ship: "Shipping the winner",
};

/* ------------------------------------------------------------------ scaling */

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

/**
 * The tilted, floating dashboard. `fit="both"` scales to the container's width and height (desktop:
 * it fills whatever the hero leaves); `fit="width"` scales to width and sets its own height (phones).
 */
export function LiveDashboard({ className }: { className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const demo = useLiveDemo({ slow: reduce });
  const [ref, box] = useBox<HTMLDivElement>();
  const compact = box.w > 0 && box.w < 720;
  const W = compact ? 560 : 1200;
  const H = compact ? 650 : 640;
  const s = box.w ? Math.min(1, box.w / W, compact ? 1 : Math.max(0.45, box.h / (H * 0.9))) : 0;

  const label = demo.summary
    ? `Live demo of the Darwin dashboard with simulated shoppers: ${pct(demo.summary.overall.conversionRate)} of ${demo.summary.overall.visitors.toLocaleString()} shoppers bought.`
    : "Live demo of the Darwin dashboard with simulated shoppers.";

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={compact ? { height: Math.round(H * s * 0.93) } : undefined} role="img" aria-label={label}>
      {s > 0 && (
        <div className="absolute top-0 left-1/2" style={{ width: W, height: H, marginLeft: -W / 2, transform: `scale(${s})`, transformOrigin: "top center", perspective: 2400 }}>
          <motion.div
            aria-hidden
            className="relative h-full w-full"
            style={{ transformStyle: "preserve-3d", transformOrigin: "50% 0%" }}
            initial={reduce ? { rotateX: compact ? 8 : 16 } : { rotateX: 24, y: 40, opacity: 0 }}
            animate={
              reduce
                ? { rotateX: compact ? 8 : 16 }
                : { rotateX: compact ? [8, 6, 8] : [16, 13.5, 16], rotateY: compact ? 0 : [-1.2, 1.2, -1.2], y: 0, opacity: 1 }
            }
            transition={
              reduce
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.8, ease: [0.2, 0.8, 0.2, 1] },
                    y: { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] },
                    rotateX: { duration: 14, repeat: Infinity, ease: "easeInOut" },
                    rotateY: { duration: 18, repeat: Infinity, ease: "easeInOut" },
                  }
            }
          >
            <Frame demo={demo} compact={compact} />
          </motion.div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ frame */

function Frame({ demo, compact }: { demo: LiveDemo; compact: boolean }) {
  return (
    <div
      className="relative flex h-full w-full flex-col rounded-[30px] border border-white/80 bg-dw-bg p-5"
      style={{
        transformStyle: "preserve-3d",
        boxShadow: "0 60px 120px -40px rgba(20,20,19,0.35), 0 30px 60px -30px rgba(20,20,19,0.25), inset 0 1px 0 rgba(255,255,255,0.9)",
      }}
    >
      <MiniNav demo={demo} compact={compact} />
      {compact ? (
        <div className="mt-4 flex flex-col gap-3">
          <ConversionCard demo={demo} compact />
          <AvsBCard demo={demo} compact />
        </div>
      ) : (
        <div className="mt-4 grid flex-1 grid-cols-[1.7fr_1fr] grid-rows-[268px_1fr] gap-3">
          <ConversionCard demo={demo} />
          <AvsBCard demo={demo} />
          <div className="col-span-2 grid grid-cols-[1fr_1.7fr] gap-3">
            <AgentsCard demo={demo} />
            <ShoppersCard sessions={demo.sessions} />
          </div>
        </div>
      )}

      {/* a floating layer: the newest AI shopper, lifted off the page */}
      <FloatingShopper session={demo.sessions[0]} compact={compact} />
    </div>
  );
}

function MiniNav({ demo, compact }: { demo: LiveDemo; compact: boolean }) {
  const steps = ["Overview", "Issues", "Fixes", "Experiments", "Pull requests"];
  return (
    <div className="flex h-11 items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <Mascot kind="leader" size={26} active={false} />
        <span className="text-[18px] font-semibold tracking-[-0.02em]">darwin</span>
      </span>
      {!compact && (
        <span className="flex h-10 items-center gap-0.5 rounded-full bg-dw-ink p-1 shadow-[0_8px_20px_rgba(20,20,19,0.14)]">
          {steps.map((s, i) => (
            <span key={s} className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px]", i === 0 ? "bg-dw-bg font-semibold text-dw-ink" : "font-medium text-[#CFCAC0]")}>
              {i > 0 && <span className="grid size-4 place-items-center rounded-full bg-white/[0.12] text-[10px]">{i}</span>}
              {s}
            </span>
          ))}
        </span>
      )}
      <span className="flex h-9 items-center gap-2 rounded-full bg-dw-sand px-3.5 text-[12.5px] font-medium">
        <LiveDot />
        Live demo · simulated
        {demo.generation > 0 && <span className="text-dw-ink/55">· Gen {demo.generation} live</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ cards */

function smooth(pts: [number, number][]): string {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const xm = (x0 + x1) / 2;
    d += `C${xm.toFixed(1)} ${y0.toFixed(1)} ${xm.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}

const SLOTS = 12;

function ConversionCard({ demo, compact }: { demo: LiveDemo; compact?: boolean }) {
  const o = demo.summary?.overall;
  const agents = demo.summary?.byKind.agent;
  const samples = demo.samples;
  const CW = compact ? 470 : 660;
  const CH = compact ? 96 : 118;
  const slotW = CW / SLOTS;
  const offset = SLOTS - samples.length;
  const maxV = Math.max(1, ...samples.map((s) => s.visitors));
  const rates = samples.map((s) => s.rate);
  const lo = Math.max(0, Math.min(...rates, 1) - 0.01);
  const hi = Math.max(...rates, 0) + 0.01;
  const y = (r: number) => 10 + (1 - (r - lo) / Math.max(0.001, hi - lo)) * (CH - 26);
  const pts = samples.map((s, i): [number, number] => [(offset + i + 0.5) * slotW, y(s.rate)]);
  const line = smooth(pts);
  const area = pts.length > 1 ? `${line}L${pts.at(-1)![0].toFixed(1)} ${CH}L${pts[0][0].toFixed(1)} ${CH}Z` : "";
  const end = pts.at(-1);
  const lastRate = samples.at(-1)?.rate;

  return (
    <Card tone="yellow" shape="designer" corner="tr" className="flex flex-col p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[19px] font-semibold tracking-[-0.02em]">Conversion</h3>
        <span className="flex items-center gap-3">
          <LegendKey>Converts</LegendKey>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-dw-ink/75">
            <span className="size-2.5 rounded-[3px] bg-dw-yellow-shape" />
            Shoppers
          </span>
        </span>
      </div>
      <div className="mt-2 flex gap-7">
        <MiniStat value={o?.conversionRate} format={(v) => pct(v)} label="converts" active />
        <MiniStat value={o?.visitors} format={(v) => Math.round(v).toLocaleString("en-GB")} label="shoppers" />
        <MiniStat value={o?.orders} format={(v) => Math.round(v).toLocaleString("en-GB")} label="bought" />
        {!compact && <MiniStat value={agents?.conversionRate} format={(v) => pct(v, 0)} label="agents convert" />}
      </div>
      <div className="relative mt-auto" style={{ height: CH, width: CW }}>
        {/* shopper columns */}
        {samples.map((s, i) => (
          <motion.span
            key={s.id}
            layout
            className="absolute bottom-0 rounded-full bg-dw-yellow-shape"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: Math.max(14, (s.visitors / maxV) * (CH - 18)), opacity: 1 }}
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
            style={{ width: 22, left: (offset + i + 0.5) * slotW - 11 }}
          />
        ))}
        <svg width={CW} height={CH} className="absolute inset-0 overflow-visible">
          <defs>
            <linearGradient id="dw-mini-conv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#141413" stopOpacity="0.2" />
              <stop offset="1" stopColor="#141413" stopOpacity="0" />
            </linearGradient>
          </defs>
          {area && <motion.path initial={{ d: area }} animate={{ d: area }} transition={{ duration: 0.7, ease: "easeInOut" }} fill="url(#dw-mini-conv)" />}
          {line && (
            <motion.path initial={{ d: line }} animate={{ d: line }} transition={{ duration: 0.7, ease: "easeInOut" }} fill="none" stroke="#141413" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {end && (
            <motion.g animate={{ x: end[0], y: end[1] }} transition={{ duration: 0.7, ease: "easeInOut" }}>
              <circle r={9} fill="#F6D76B" stroke="#141413" strokeWidth={2} />
              <circle r={4} fill="#141413" />
            </motion.g>
          )}
        </svg>
        {end && lastRate !== undefined && (
          <motion.span
            className="num absolute rounded-full bg-dw-ink px-2 py-0.5 text-[11px] font-semibold text-white"
            animate={{ left: end[0] - 58, top: end[1] - 11 }}
            transition={{ duration: 0.7, ease: "easeInOut" }}
          >
            {pct(lastRate)}
          </motion.span>
        )}
        {!samples.length && (
          <span className="absolute inset-0 grid place-items-center text-[13px] text-dw-ink/60">
            <span className="flex items-center gap-2">
              Shoppers arriving <Typing />
            </span>
          </span>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-dw-ink/60">
        <span>{samples.length > 1 ? `${Math.max(1, Math.round((samples.at(-1)!.at - samples[0].at) / 1000))}s ago` : ""}</span>
        <span className="font-semibold text-dw-ink">now</span>
      </div>
    </Card>
  );
}

function MiniStat({ value, format, label, active }: { value?: number; format: (v: number) => string; label: string; active?: boolean }) {
  return (
    <div className="flex flex-col">
      {value === undefined ? (
        <span className="h-[22px] w-12 animate-pulse rounded-full bg-dw-ink/10" />
      ) : (
        <AnimatedNumber value={value} format={format} className="num text-[18px] leading-tight font-semibold tracking-[-0.02em]" />
      )}
      <span className={cn("mt-0.5 text-[10.5px] tracking-[0.02em] text-dw-ink/70 uppercase", active && "border-b-2 border-dw-ink pb-1 text-dw-ink")}>{label}</span>
    </div>
  );
}

function AvsBCard({ demo, compact }: { demo: LiveDemo; compact?: boolean }) {
  const exp: Experiment | undefined = demo.experiment;
  const r = exp?.result;
  const a = r?.control.conversionRate ?? 0;
  const b = r?.treatment.conversionRate ?? 0;
  const max = Math.max(a, b, 0.01);
  const p = r?.probabilityToBeat;
  const status = exp?.status === "completed" ? (r?.decision === "ship" ? "Shipped" : "Not shipped") : exp?.status === "stopped" ? "Stopped" : undefined;
  const agentA = r?.control.byKind.agent.conversionRate;
  const agentB = r?.treatment.byKind.agent.conversionRate;

  return (
    <Card tone="pink" shape="experimenter" corner="br" className="flex flex-col p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[19px] font-semibold tracking-[-0.02em]">A vs B</h3>
        {exp && <span className="min-w-0 truncate text-[12px] underline decoration-dw-ink/40 underline-offset-4">{exp.name}</span>}
      </div>
      {!r ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
          <Mascot kind={demo.phase === "propose" ? "designer" : demo.phase === "diagnose" ? "leader" : "observer"} size={52} frame active />
          <span className="flex items-center gap-2 text-[14px] font-medium">
            {PHASE_LINE[demo.phase]} <Typing />
          </span>
        </div>
      ) : (
        <div className={cn("mt-3 flex flex-1 items-end gap-6", compact && "mt-2")}>
          <div className="flex items-end gap-3">
            <div className="flex flex-col items-center">
              <PillBar value={a} max={max} height={compact ? 96 : 118} width={32} dashed label={pct(a)} />
              <span className="mt-1 text-[11px] text-dw-ink/70">A</span>
            </div>
            <div className="flex flex-col items-center">
              <PillBar value={b} max={max} height={compact ? 96 : 118} width={32} label={pct(b)} />
              <span className="mt-1 text-[11px] text-dw-ink/70">B</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col pb-5">
            <AnimatedNumber
              value={r.lift}
              format={(v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`}
              className="num text-[38px] leading-none font-semibold tracking-[-0.03em]"
            />
            <span className="mt-1 text-[12px] text-[#5A2744]">{r.lift >= 0 ? "more shoppers buy in B" : "fewer shoppers buy in B"}</span>
            {agentA !== undefined && agentB !== undefined && (
              <span className="num mt-1 text-[11.5px] text-[#5A2744]">
                Agents {pct(agentA, 0)} → {pct(agentB, 0)}
              </span>
            )}
            <div className="mt-3 flex items-baseline justify-between text-[11.5px]">
              <span>
                <span className="num font-semibold">{p !== undefined ? pct(p, 0) : "–"}</span> chance B wins
              </span>
              {status && <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10.5px] font-semibold">{status}</span>}
            </div>
            <span className="mt-1.5 block h-2.5 rounded-full bg-white/50">
              <motion.span
                className="block h-full rounded-full bg-dw-ink"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(3, (p ?? 0) * 100)}%` }}
                transition={{ type: "spring", stiffness: 60, damping: 18 }}
              />
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function AgentsCard({ demo }: { demo: LiveDemo }) {
  const by = new Map<string, { brand: AgentBrand; bought: number; done: number }>();
  for (const s of demo.sessions.length ? demo.sessions : []) {
    if (s.outcome === "in_progress") continue;
    const brand = agentBrand(s.agentName);
    const row = by.get(brand.key) ?? { brand, bought: 0, done: 0 };
    row.done += 1;
    if (s.outcome === "purchased") row.bought += 1;
    by.set(brand.key, row);
  }
  const rows = [...by.values()].map((r) => ({ ...r, rate: r.done ? r.bought / r.done : 0 })).sort((x, y) => y.rate - x.rate || y.done - x.done);
  const people = demo.summary?.byKind.human.conversionRate;
  const max = Math.max(0.01, ...rows.map((r) => r.rate), people ?? 0);

  return (
    <Card tone="blue" shape="observer" corner="tr" className="flex flex-col p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[19px] font-semibold tracking-[-0.02em]">Which agents buy</h3>
        <span className="text-[11.5px] text-dw-ink/70">latest AI shoppers</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {rows.slice(0, 5).map((r) => (
            <motion.li key={r.brand.key} layout className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.8rem] items-center gap-3 text-[13px]" transition={{ type: "spring", stiffness: 260, damping: 26 }}>
              <span className="flex items-center gap-2">
                <AgentTile brand={r.brand} size={22} />
                {r.brand.name}
              </span>
              <HBar value={r.rate / max} />
              <span className="num text-right font-dwmono text-[12px]">
                {pct(r.rate, 0)} <span className="text-dw-ink/50">{r.bought}/{r.done}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
        {!rows.length && (
          <li className="flex items-center gap-2 py-2 text-[13px] text-dw-ink/65">
            Waiting for the first AI shoppers <Typing />
          </li>
        )}
        {people !== undefined && (
          <li className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.8rem] items-center gap-3 text-[13px] text-dw-ink/75">
            <span className="flex items-center gap-2">
              <AgentTile brand={agentBrand("People", "human")} size={22} />
              People
            </span>
            <HBar value={people / max} dashed />
            <span className="num text-right font-dwmono text-[12px]">{pct(people)}</span>
          </li>
        )}
      </ul>
    </Card>
  );
}

function arm(v?: string) {
  return v === "treatment" ? "B" : v === "control" ? "A" : undefined;
}

function statusLine(s: AgentSessionSummary): string {
  if (s.outcome === "purchased") return s.orderTotal ? `Bought for £${(s.orderTotal / 100).toFixed(0)}` : "Bought";
  if (s.outcome === "abandoned") return `Left: ${s.reason ?? "no reason given"}`;
  const t = s.toolCalls.at(-1)?.tool;
  return t ? `Calling ${t}` : "Browsing";
}

function ShopperMark({ name, size }: { name: string; size: number }) {
  const brand = agentBrand(name);
  return (
    <span className="relative shrink-0">
      <Mascot kind={brand.mascot} size={size} frame active={false} />
      <span className="absolute -right-1 -bottom-1">
        <AgentTile brand={brand} size={Math.round(size * 0.42)} />
      </span>
    </span>
  );
}

function ShoppersCard({ sessions }: { sessions: AgentSessionSummary[] }) {
  const rows = sessions.slice(1, 3);
  return (
    <Card tone="white" className="flex flex-col p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="flex items-center gap-2 text-[19px] font-semibold tracking-[-0.02em]">
          Live shoppers <LiveDot />
        </h3>
        <span className="text-[11.5px] text-dw-ink/70">AI agents, simulated</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {/* where the newest shopper sits before it lifts off the page (see FloatingShopper) */}
        <li className="h-[76px] rounded-[22px] border-[1.5px] border-dashed border-dw-ink/15" />
        <AnimatePresence initial={false}>
          {rows.map((s) => (
            <motion.li
              key={s.sessionId}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="flex h-[58px] items-center gap-3 rounded-[18px] bg-dw-sand px-3"
            >
              <ShopperMark name={s.agentName} size={40} />
              <Row s={s} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  );
}

function Row({ s }: { s: AgentSessionSummary }) {
  const a = arm(s.variant);
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13.5px] font-semibold">{s.agentName}</span>
        <span className="font-dwmono text-[11px] text-dw-ink/55">{s.toolCalls.length} calls</span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-dw-ink/70">
        {a && <ArmChip arm={a} className="size-4 text-[10px]" />}
        <span className="truncate">{statusLine(s)}</span>
      </span>
    </span>
  );
}

function FloatingShopper({ session, compact }: { session?: AgentSessionSummary; compact: boolean }) {
  return (
    <div
      className="absolute"
      style={
        compact
          ? { left: 36, right: 36, bottom: 18, transform: "translateZ(70px)" }
          : { left: 452, right: 38, top: 418, transform: "translateZ(44px)" }
      }
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {session && (
          <motion.div
            key={session.sessionId}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="flex h-[76px] items-center gap-3.5 rounded-[22px] bg-dw-pink px-4 shadow-[0_30px_60px_-24px_rgba(20,20,19,0.45),0_12px_24px_-12px_rgba(20,20,19,0.2)]"
          >
            <ShopperMark name={session.agentName} size={48} />
            <Row s={session} />
            <Outcome s={session} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Outcome({ s }: { s: AgentSessionSummary }): ReactNode {
  if (s.outcome === "purchased") return <span className="shrink-0 rounded-full bg-dw-win-bg px-2.5 py-1 text-[11.5px] font-semibold text-dw-win">Bought</span>;
  if (s.outcome === "abandoned") return <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold">Left</span>;
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11.5px] font-semibold">
      <LiveDot /> Live
    </span>
  );
}

