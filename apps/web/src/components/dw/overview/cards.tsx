"use client";

/**
 * The Overview's four cards: Conversion (yellow), A vs B (pink), Which agents buy (blue), How they convert
 * (olive). Ink-only charts: solid pills = series 1 (people / B), dashed pills = series 2 (agents / A).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type MouseEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { AnalyticsSummary } from "@/lib/contracts";
import { useMeasure } from "@/lib/console/hooks";
import { cn } from "@/components/ui/cn";
import { AgentTile, agentBrand } from "../agent-tile";
import { CrewFace } from "../crew-face";
import { Card, DEPTH, LegendKey, PillButton } from "../ui";
import { CountUp, EASE, Grow, Tip, type CountFormat } from "./fx";
import { SHIP_AT, countText, funnelSteps, pctSmart, seriesText, seriesValue, smoothPath, whom, type BoardRow, type ChartPoint, type ChartTab, type TestView } from "./model";

const FILL = "[&>div]:flex [&>div]:h-full [&>div]:flex-col";
/**
 * Desktop card heights scale with the viewport so both card rows sit above the fold (with the prompt bar
 * showing) from 800px tall screens up; phones size to content.
 */
const ROW1 = "lg:h-[clamp(220px,calc(100vh_-_630px),270px)] lg:py-5";
const ROW2 = "lg:h-[clamp(184px,calc(100vh_-_686px),214px)] lg:py-[18px]";
/** Phones: every card in the carousel is as tall as the tallest, and gives under a press. */
const PHONE = "max-sm:h-full max-sm:min-h-[300px] max-sm:active:scale-[0.985] max-sm:active:brightness-[0.98]";

/** Every Overview card is a door to its page: the title is the link, and a click on the card's empty space follows it. */
const CLICK = "cursor-pointer";
function useCardClick(href: string) {
  const router = useRouter();
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a,button,input,textarea,select,[role=tab]")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };
}

/** The card title as a link, with a small arrow that nudges on hover. 20px semibold, like every Darwin card. */
function TitleLink({ href, children, hint }: { href: string; children: React.ReactNode; hint: string }) {
  return (
    <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">
      <Link href={href} title={hint} className="group/t inline-flex items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2">
        {children}
        <ArrowUpRight
          aria-hidden
          className="size-[18px] opacity-45 transition-[opacity,transform] duration-200 group-hover/t:translate-x-0.5 group-hover/t:-translate-y-0.5 group-hover/t:opacity-100"
        />
      </Link>
    </h2>
  );
}

function CardHead({ title, href, hint, right }: { title: string; href: string; hint: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
      <TitleLink href={href} hint={hint}>
        {title}
      </TitleLink>
      {right && <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] tabular-nums">{right}</div>}
    </div>
  );
}

function CardEmpty({ kind, children, action }: { kind: "designer" | "experimenter" | "observer" | "leader" | "analyst"; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center text-[15px] text-dw-ink/75">
      <CrewFace kind={kind} size={46} />
      <p className="max-w-[26rem] leading-snug">{children}</p>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Conversion */

export function ConversionCard({ points, summary, simulated, onRun }: { points: ChartPoint[]; summary?: AnalyticsSummary; simulated: boolean; onRun?: () => void }) {
  const [tab, setTab] = useState<ChartTab>("converts");
  const open = useCardClick("/console/changes");
  const reduce = useReducedMotion();
  const last = points.at(-1);
  const tabs: {
    key: ChartTab;
    value: number;
    format: CountFormat;
    label: string;
  }[] = last
    ? [
        { key: "converts", value: last.rate, format: "pct", label: "Converts" },
        {
          key: "shoppers",
          value: summary?.overall.visitors ?? last.shoppers,
          format: "int",
          label: "Shoppers",
        },
        {
          key: "bought",
          value: summary?.overall.orders ?? last.bought,
          format: "int",
          label: "Bought",
        },
        {
          key: "better",
          value: last.multiple,
          format: "mult",
          label: "Since Darwin started",
        },
      ]
    : [];

  const chart = useMemo(() => {
    if (!points.length) return undefined;
    const vals = points.map((p) => seriesValue(p, tab));
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || Math.max(hi, 1e-9);
    const floor = hi === lo ? lo - span / 2 : lo;
    const pts = vals.map((v, i) => [((i + 0.5) / vals.length) * 1000, 84 - ((v - floor) / span) * 62] as [number, number]);
    const line = smoothPath(pts);
    const lastPt = pts[pts.length - 1];
    const area = `${line} L${lastPt[0]},100 L${pts[0][0]},100 Z`;
    const maxShoppers = Math.max(...points.map((p) => p.shoppers), 1);
    return { pts, line, area, lastPt, maxShoppers, vals };
  }, [points, tab]);

  return (
    <Card tone="yellow" shape="designer" corner="tr" className={cn("flex flex-col px-6 py-[22px]", DEPTH, CLICK, ROW1, PHONE, FILL)} aria-label="Conversion" onClick={open}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <TitleLink href="/console/changes" hint="See every change Dash shipped">
            Conversion
          </TitleLink>
          {points.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              <LegendKey className="text-[#4F4417]">{tabs.find((t) => t.key === tab)?.label ?? "Converts"}</LegendKey>
              <span className="inline-flex items-center gap-1.5 text-[#4F4417]">
                <span className="size-2.5 rounded-[3px] bg-dw-ink/20" />
                Shoppers{simulated ? ", simulated" : ""}
              </span>
            </div>
          )}
        </div>
        {last && chart && (
          <div role="tablist" aria-label="Chart" className="flex flex-wrap gap-x-6 gap-y-2 max-sm:grid max-sm:w-full max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-3">
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 border-b-2 pb-1 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-dw-ink",
                    on ? "border-dw-ink" : "border-transparent hover:border-dw-ink/25",
                  )}
                >
                  <CountUp value={t.value} format={t.format} className="text-[18px] leading-tight font-semibold" />
                  <span className="text-[11.5px] tracking-[0.02em] text-[#4F4417] uppercase">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {!last || !chart ? (
        <CardEmpty kind="designer" action={onRun && <PillButton tone="yellow" onClick={onRun}>Let Darwin run</PillButton>}>
          Darwin hasn’t measured your store yet. Let it run and conversion shows up here after the first round.
        </CardEmpty>
      ) : (
        <>
          <div className="relative mt-3.5 flex min-h-[150px] flex-1 flex-col gap-1.5 lg:mt-2.5 lg:min-h-0">
            <div className="relative flex-1">
              {/* one faint pill per generation: how many shoppers Darwin measured */}
              <div className="absolute inset-0 flex items-end gap-2.5">
                {points.map((p, i) => {
                  const lastCol = i === points.length - 1;
                  return (
                    <div
                      key={p.label}
                      tabIndex={0}
                      className="group relative flex h-full flex-1 items-end justify-center outline-none"
                      aria-label={`${p.label}: ${pctSmart(p.rate)} of ${countText(p.shoppers)} shoppers bought`}
                    >
                      <Tip>
                        {p.label} · {countText(p.shoppers)} shoppers · {pctSmart(p.rate)}
                      </Tip>
                      <Grow
                        size={`${Math.max(12, (p.shoppers / chart.maxShoppers) * 100)}%`}
                        delay={0.15 + i * 0.05}
                        className={cn(
                          "w-full max-w-[26px] rounded-full transition-[filter,background-color] duration-200 group-hover:brightness-75",
                          lastCol ? "bg-dw-ink/[0.34]" : "bg-dw-ink/[0.14]",
                        )}
                      />
                    </div>
                  );
                })}
              </div>
              <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
                {points.length > 1 && (
                  <>
                    <motion.path
                      key={`a-${tab}`}
                      d={chart.area}
                      fill="#141413"
                      fillOpacity={0.08}
                      className="max-sm:hidden"
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.6, delay: 0.3 }}
                    />
                    <motion.path
                      key={`l-${tab}`}
                      d={chart.line}
                      fill="none"
                      stroke="#141413"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      initial={reduce ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.9, ease: EASE }}
                    />
                  </>
                )}
              </svg>
              <motion.div
                key={`d-${tab}`}
                className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-dw-ink shadow-[0_0_0_4px_#F6D76B]"
                style={{
                  left: `${chart.lastPt[0] / 10}%`,
                  top: `${chart.lastPt[1]}%`,
                }}
                initial={reduce ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.4, delay: 0.8, ease: EASE }}
              >
                <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-dw-ink/40 [animation-duration:2.2s] motion-reduce:animate-none" />
                <span className="absolute top-1/2 right-4 -translate-y-1/2 rounded-full bg-dw-ink px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-white">
                  {seriesText(chart.vals[chart.vals.length - 1], tab)}
                </span>
              </motion.div>
            </div>
            <div className="flex gap-2.5 text-[12px] text-[#4F4417]">
              {points.map((p, i) => (
                <span key={p.label} className={cn("flex-1 truncate text-center", i === points.length - 1 && "font-semibold text-dw-ink")} title={p.title}>
                  <span className="max-sm:hidden">{i === points.length - 1 ? `${p.label} · live` : p.label}</span>
                  {/* Phones: many generations share a narrow card, so just the generation number (0 … Now). */}
                  <span className="sm:hidden">{i === 0 ? "0" : i === points.length - 1 ? "Now" : p.label.replace(/^Gen\s*/, "")}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ A vs B */

export function AbCard({ test, onRun, autopilot }: { test?: TestView; onRun?: () => void; autopilot: boolean }) {
  const hasResult = !!test && test.aShoppers + test.bShoppers > 0;
  const max = Math.max(test?.a ?? 0, test?.b ?? 0, 1e-9);
  // Pills fill the measured column (value label + arm label take 46px) up to 130px.
  const [pillsRef, pills] = useMeasure<HTMLDivElement>();
  const tallest = pills.height ? Math.max(40, Math.min(130, pills.height - 46)) : 130;
  const h = (v: number) => Math.max(30, Math.round((v / max) * tallest));
  const chance = test?.chance ?? 0;
  const lift = test?.lift;
  const ended = test && !test.running;
  const decision = test?.experiment.result?.decision;
  const open = useCardClick("/console/experiments");
  return (
    <Card tone="pink" shape="experimenter" corner="br" className={cn("flex flex-col px-6 py-[22px]", DEPTH, CLICK, ROW1, PHONE, FILL)} aria-label="A vs B" onClick={open}>
      <CardHead
        title={ended ? (decision === "ship" ? "Last win" : "Last test") : "A vs B"}
        href="/console/experiments"
        hint={test ? `Open Fizz's test: ${test.experiment.name}` : "Open Fizz's tests"}
        right={
          test && (
            <Link
              href="/console/experiments"
              className="max-w-[16rem] truncate text-[14px] text-dw-ink underline decoration-1 underline-offset-4 transition-[text-underline-offset] hover:underline-offset-[6px]"
            >
              {test.experiment.name}
            </Link>
          )
        }
      />
      {!test || !hasResult ? (
        <CardEmpty kind="experimenter" action={!autopilot && onRun ? <PillButton tone="yellow" onClick={onRun}>Let Darwin run</PillButton> : undefined}>
          {test ? "Fizz just started this test. The first shoppers are on their way." : "No test yet. Fizz starts one as soon as Pixel has a fix worth trying."}
        </CardEmpty>
      ) : (
        <div className="mt-3.5 grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-end gap-6 lg:mt-2">
          <div ref={pillsRef} className="flex h-full items-end gap-3.5">
            {(["A", "B"] as const).map((arm, i) => {
              const v = arm === "A" ? test.a : test.b;
              const n = arm === "A" ? test.aShoppers : test.bShoppers;
              return (
                <div key={arm} tabIndex={0} className="group relative flex h-full flex-col items-center justify-end gap-1.5 outline-none">
                  <Tip>
                    {Math.round(v * 1000)} buyers per 1,000 · {countText(n)} {whom(test.audience)}
                  </Tip>
                  <span className="num text-[13px] font-semibold">{pctSmart(v)}</span>
                  <Grow
                    size={h(v)}
                    delay={0.2 + i * 0.1}
                    className={cn(
                      "w-[34px] rounded-full transition-[filter,background-color] duration-200",
                      arm === "A" ? "border-[1.5px] border-dashed border-dw-ink group-hover:bg-dw-ink/10" : "bg-dw-ink group-hover:brightness-75",
                    )}
                  />
                  <span className="text-[12px] text-[#5A2744]">{arm}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-3.5 pb-[22px] lg:gap-3">
            <div className="flex flex-col">
              {lift !== undefined ? (
                <CountUp value={lift} format="lift" className="text-[40px] leading-none font-semibold tracking-[-0.02em]" />
              ) : (
                <span className="text-[40px] leading-none font-semibold">–</span>
              )}
              <span className="mt-1 text-[13px] text-[#5A2744]">
                {ended
                  ? decision === "ship"
                    ? `Dash shipped B: more ${whom(test.audience)} bought`
                    : `Fizz kept A: B didn’t beat it`
                  : lift === undefined
                    ? "Waiting for buyers in A"
                    : `${lift >= 0 ? "more" : "fewer"} ${whom(test.audience)} buy in B`}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-2 text-[12px] text-[#5A2744]">
                <span>
                  <span className="num font-semibold text-dw-ink">{pctSmart(chance)}</span> chance B wins
                </span>
                {ended ? (
                  <Link href="/console/experiments" className="font-medium text-dw-ink underline decoration-dw-ink/30 underline-offset-4 hover:decoration-dw-ink">
                    See all tests
                  </Link>
                ) : (
                  <span>ships at {Math.round(SHIP_AT * 1000) / 10}%</span>
                )}
              </div>
              <div className="relative h-2 rounded-full bg-dw-ink/[0.12]" role="progressbar" aria-label="Chance B wins" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(chance * 100)}>
                <Grow axis="x" size={`${Math.max(2, chance * 100)}%`} delay={0.35} className="h-2 rounded-full bg-dw-ink" />
                <span className="absolute -top-1 h-4 w-0.5 rounded-full bg-dw-ink" style={{ left: `${SHIP_AT * 100}%` }} aria-hidden />
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Which agents buy */

export function AgentsCard({ board, peopleRate, sample, simulated }: { board: BoardRow[]; peopleRate?: number; sample: number; simulated: boolean }) {
  const rows = board.slice(0, 5);
  const max = Math.max(...rows.map((r) => r.rate), peopleRate ?? 0, 1e-9);
  const people = agentBrand(undefined, "human");
  const open = useCardClick("/console/agents");
  return (
    <Card tone="blue" shape="observer" corner="tr" className={cn("flex flex-col px-6 py-[22px]", DEPTH, CLICK, ROW2, PHONE, FILL)} aria-label="Which agents buy" onClick={open}>
      <CardHead
        title="Which agents buy"
        href="/console/agents"
        hint="Open Mika, your store agent"
        right={
          sample > 0 && (
            <span className="text-[#2E3A55]">
              Last {sample} agent visits{simulated ? " · simulated" : ""}
            </span>
          )
        }
      />
      {!rows.length ? (
        <CardEmpty kind="observer">No AI shoppers have finished a visit yet. When they do, Iris ranks them by how often they buy.</CardEmpty>
      ) : (
        <div className="mt-3.5 flex min-h-0 flex-1 flex-col justify-between gap-1.5 lg:mt-2.5 lg:gap-1">
          {rows.map((r, i) => (
            <div
              key={r.brand.key + r.brand.name}
              className={cn(
                "group/lb grid h-6 grid-cols-[128px_minmax(0,1fr)_46px] items-center gap-2.5 transition-transform duration-200 hover:translate-x-[3px] lg:h-[22px]",
                // Short desktop screens: top 4 agents + people, so the row stays above the fold.
                i === 4 && "[@media(min-width:1024px)_and_(max-height:860px)]:hidden",
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-medium">
                <span className="transition-transform duration-300 group-hover/lb:-translate-y-0.5 group-hover/lb:-rotate-6">
                  <AgentTile brand={r.brand} size={24} />
                </span>
                <span className="truncate">{r.brand.name}</span>
              </span>
              <span tabIndex={0} className="group relative block h-3 outline-none">
                <Tip align="right">
                  {r.bought} of {r.shoppers} bought
                </Tip>
                <Grow
                  axis="x"
                  size={`${Math.max(4, (r.rate / max) * 100)}%`}
                  delay={0.25 + i * 0.06}
                  className="absolute inset-y-0 left-0 rounded-full bg-dw-ink transition-[filter] group-hover:brightness-75"
                />
              </span>
              <span className="num text-right font-dwmono text-[13px] font-medium">{pctSmart(r.rate)}</span>
            </div>
          ))}
          {peopleRate !== undefined && (
            <div className="grid h-6 grid-cols-[128px_minmax(0,1fr)_46px] items-center gap-2.5 text-[#2E3A55] lg:h-[22px]">
              <span className="flex items-center gap-2.5 text-[14px]">
                <AgentTile brand={people} size={24} />
                People
              </span>
              <span tabIndex={0} className="group relative block h-3 outline-none">
                <Tip align="right">{pctSmart(peopleRate)} of people buy</Tip>
                <Grow axis="x" size={`${Math.max(4, (peopleRate / max) * 100)}%`} delay={0.6} className="absolute inset-y-0 left-0 rounded-full border-[1.5px] border-dashed border-dw-ink" />
              </span>
              <span className="num text-right font-dwmono text-[13px]">{pctSmart(peopleRate)}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ How they convert */

export function FunnelCard({ summary }: { summary?: AnalyticsSummary }) {
  const steps = funnelSteps(summary);
  // Bars fill the measured area (the value label takes 20px), up to 104px.
  const [barsRef, bars] = useMeasure<HTMLDivElement>();
  const tallest = bars.height ? Math.max(40, Math.min(104, bars.height - 20)) : 104;
  const any = steps.some((s) => s.people !== undefined || s.agents !== undefined);
  // The step that loses the most people: bold, it's where Darwin looks first.
  let weakest = -1;
  steps.forEach((s, i) => {
    if (s.people !== undefined && (weakest < 0 || s.people < (steps[weakest].people ?? 1))) weakest = i;
  });
  const open = useCardClick("/console/issues");
  return (
    <Card tone="olive" shape="analyst" corner="br" className={cn("flex flex-col px-6 py-[22px]", DEPTH, CLICK, ROW2, PHONE, FILL)} aria-label="How they convert" onClick={open}>
      <CardHead
        title="How they convert"
        href="/console/issues"
        hint="See where Iris found shoppers getting stuck"
        right={
          <>
            <LegendKey className="text-[#2F3517]">People</LegendKey>
            <LegendKey dashed className="text-[#2F3517]">
              Agents
            </LegendKey>
          </>
        }
      />
      {!any ? (
        <CardEmpty kind="leader">Once shoppers arrive, you’ll see how many move on at each step, people next to agents.</CardEmpty>
      ) : (
        <div className="mt-3.5 grid min-h-[150px] flex-1 grid-cols-4 gap-1.5 sm:gap-3 lg:mt-2 lg:min-h-0">
          {steps.map((s, i) => (
            <div key={s.label} className="flex min-h-0 flex-col gap-1.5">
              <div ref={i === 0 ? barsRef : undefined} className="flex min-h-0 flex-1 items-end justify-center gap-1 sm:gap-2">
                {(["people", "agents"] as const).map((k, j) => {
                  const v = s[k];
                  if (v === undefined) return <span key={k} className="w-[26px]" />;
                  return (
                    <div key={k} tabIndex={0} className="group relative flex flex-col items-center gap-1 outline-none">
                      <Tip>
                        {Math.round(v * 100)} in 100 {k} move on
                      </Tip>
                      <span className="num text-[12px] font-semibold">{Math.round(v * 100)}%</span>
                      <Grow
                        size={Math.max(22, Math.round(v * tallest))}
                        delay={0.3 + i * 0.07 + j * 0.04}
                        className={cn(
                          "w-[22px] rounded-full transition-[filter,background-color] duration-200 sm:w-[26px]",
                          k === "people" ? "bg-dw-ink group-hover:brightness-75" : "border-[1.5px] border-dashed border-dw-ink group-hover:bg-dw-ink/10",
                        )}
                      />
                    </div>
                  );
                })}
              </div>
              <span className={cn("text-center text-[12px] leading-tight sm:text-[13px] lg:whitespace-nowrap", i === weakest ? "font-semibold text-dw-ink" : "text-[#2F3517]")}>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
