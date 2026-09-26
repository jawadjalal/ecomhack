"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, Cpu, LoaderCircle, Users, X } from "lucide-react";
import type { AgentTestResult, AgentTestState, Lever } from "@/lib/store-agent";
import { cn } from "@/components/ui/cn";
import { Card, CardTitle, LiveDot, PillButton, Tag, Typing } from "@/components/dw/ui";
import { Mascot } from "@/components/dw/mascot";
import { Pill } from "@/components/dw/dashboards/charts";
import { SwitchRow } from "./switch";

export const LEVER_LABEL: Record<Lever, string> = {
  facts: "Facts up front",
  "one-pick": "One best pick",
  structured: "Structured buy instructions",
  upsell: "Upsell the yearly plan",
};
/** One line each: why the lever might sell more (mirrors lib/store-agent LEVERS, kept short for the UI). */
const LEVER_WHY: Record<Lever, string> = {
  facts: "Answer the buyer's objections: instant access, cancel any time.",
  "one-pick": "One recommendation with a reason, not a menu of three.",
  structured: "Exact offer ids and prices for agents that read data.",
  upsell: "Lead with the biggest plan. Bigger orders, maybe fewer.",
};
const LEVERS_IN_ORDER: Lever[] = ["facts", "one-pick", "structured", "upsell"];
/** AGENT_TEST_RULES in lib/store-agent (checked after every batch, so the bars are high). */
const SHIP_AT = 0.97;
const RULES = [
  { value: "100+", label: "chats per version" },
  { value: "30+", label: "payments before any call" },
  { value: "97%", label: "chance it's better, to keep it" },
  { value: "3%", label: "or lower, to stop it" },
];

const pctOf = (x?: number) => (x === undefined || !Number.isFinite(x) ? "–" : `${Math.round(x * 100)}%`);
const signedPct = (x?: number) => (x === undefined || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(Math.round(x * 100))}%`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "A/B tests on your agent": autopilot, simulated buyers, the four pitch levers, the live test and the log. */
export function TestsCard({
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
  const pitch = s?.levers.length ? s.levers.map((l) => LEVER_LABEL[l]).join(" + ") : "a plain list of offers";

  return (
    <Card tone="pink" shape="experimenter" corner="br" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <CardTitle
            right={
              running ? (
                <span className="flex items-center gap-1.5 font-medium text-dw-ink">
                  <LiveDot /> Testing now
                </span>
              ) : s?.autopilot ? (
                <span className="font-medium text-dw-ink">Choosing the next test</span>
              ) : undefined
            }
          >
            Tests on Mika&apos;s pitch
          </CardTitle>
          <p className="mt-1.5 max-w-[46rem] text-[14px] leading-snug text-dw-ink/75">
            Ada changes one thing about how Mika pitches at a time. She keeps it only if more chats end in a payment. The pitch today:{" "}
            <b className="font-semibold text-dw-ink">{pitch}</b>.
          </p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-[42rem]">
          <SwitchRow
            on={!!s?.autopilot}
            onChange={onAutopilot}
            label="Autopilot"
            hint="Test one lever at a time; keep winners, stop losers"
            icon={<Cpu />}
            title="Test one pitch lever at a time; keep winners, stop losers"
          />
          <SwitchRow
            on={simOn}
            onChange={onSim}
            label="Simulated buyers"
            hint="80 simulated buyer agents every 3 s, labelled"
            icon={<Users />}
            title="80 simulated buyer agents every 3 s (labelled)"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col">
          <ul className="flex flex-col gap-1.5">
            {LEVERS_IN_ORDER.map((l) => {
              const t = [...(s?.tests ?? [])].reverse().find((x) => x.lever === l);
              const inPitch = s?.levers.includes(l);
              const status = inPitch ? "pitch" : t?.status === "running" ? "running" : t?.status === "stopped" ? "stopped" : "idle";
              return (
                <li
                  key={l}
                  title={t?.reason}
                  className={cn(
                    "dw-row flex min-h-[60px] items-center gap-3 rounded-[18px] px-3.5 py-2.5",
                    status === "running" ? "bg-white shadow-[0_0_0_1.5px_#141413]" : "bg-white/55",
                  )}
                >
                  <LeverIcon status={status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-semibold">{LEVER_LABEL[l]}</div>
                    <div className="truncate text-[12.5px] text-dw-ink/60">{t?.reason ?? LEVER_WHY[l]}</div>
                  </div>
                  {status === "pitch" ? (
                    <Tag tone="win">In the pitch</Tag>
                  ) : status === "running" ? (
                    <Tag tone="ink">Testing</Tag>
                  ) : status === "stopped" ? (
                    <Tag tone="warn">Stopped</Tag>
                  ) : (
                    <PillButton tone="white" size="sm" onClick={() => onStart(l)} disabled={!!running}>
                      Test it
                    </PillButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex min-w-0 flex-col">
          <LiveTest label={running ? LEVER_LABEL[running.lever] : undefined} result={result} autopilot={!!s?.autopilot} />
        </div>

        <div className="grid min-w-0 content-start gap-3 lg:col-span-2 lg:grid-cols-2 xl:col-span-1 xl:grid-cols-1">
          {!!s?.log.length && (
            <div className="rounded-[22px] bg-white/55 p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[14px] font-semibold">What Ada decided</span>
                <span className="font-dwmono text-[12px] text-dw-ink/55">{s.log.length} notes</span>
              </div>
              <ol className="flex max-h-40 flex-col gap-0.5 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {s.log.slice(0, 8).map((e) => (
                    <motion.li
                      key={`${e.at}-${e.text}`}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2 py-1 text-[13px] leading-snug"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="mt-[2px]">
                        <circle cx="8" cy="8" r="7" fill="#141413" />
                        <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="text-dw-ink/80">{e.text}</span>
                      <span className="font-dwmono text-[11.5px] text-dw-ink/50">{clock(e.at)}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ol>
            </div>
          )}
          <div className="rounded-[22px] bg-white/45 p-4">
            <div className="text-[14px] font-semibold">How Ada calls a test</div>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-3">
              {RULES.map((r) => (
                <div key={r.label}>
                  <dt className="sr-only">{r.label}</dt>
                  <dd className="num text-[18px] leading-tight font-semibold">{r.value}</dd>
                  <dd className="text-[12px] text-dw-ink/65">{r.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </Card>
  );
}

function LeverIcon({ status }: { status: "pitch" | "running" | "stopped" | "idle" }) {
  if (status === "pitch")
    return (
      <span className="dw-tilt grid size-8 shrink-0 place-items-center rounded-full bg-dw-ink text-white">
        <Check className="size-4" strokeWidth={2.5} />
      </span>
    );
  if (status === "running")
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-pink">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
      </span>
    );
  if (status === "stopped")
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-warn-bg text-dw-warn">
        <X className="size-4" strokeWidth={2.5} />
      </span>
    );
  return <span className="dw-tilt size-8 shrink-0 rounded-full border-[1.5px] border-dashed border-dw-ink/40" aria-hidden />;
}

/** The running test as the design's A vs B: dashed pill = current pitch (A), solid = with the lever (B). */
function LiveTest({ label, result, autopilot }: { label?: string; result?: AgentTestResult; autopilot: boolean }) {
  if (!label) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[22px] bg-white/55 px-5 py-8 text-center">
        <Mascot kind="experimenter" size={52} frame active={autopilot} title="Ada, the tester" />
        <p className="max-w-[22rem] text-[14px] text-dw-ink/70">
          {autopilot ? "Ada starts the next test as soon as buyer agents arrive." : "No test running. Turn on Autopilot, or press Test it on a lever to start one."}
        </p>
      </div>
    );
  }
  const n = result ? result.control.conversations + result.treatment.conversations : 0;
  if (!result || n === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[22px] bg-white/70 px-5 py-8 text-center">
        <Typing />
        <p className="text-[14px] text-dw-ink/70">Testing “{label}”. Waiting for the first buyer agents…</p>
      </div>
    );
  }
  const max = Math.max(result.control.rate, result.treatment.rate, 0.01);
  const p = result.probabilityToBeat;
  return (
    <div className="rounded-[22px] bg-white/70 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] font-semibold">Testing “{label}”</span>
        <span className="shrink-0 font-dwmono text-[12px] text-dw-ink/55">{n.toLocaleString("en-GB")} conversations</span>
      </div>
      <div className="mt-3 flex items-end gap-5">
        <div className="flex items-end gap-3">
          <div className="flex flex-col items-center">
            <Pill value={result.control.rate} max={max} height={110} width={30} dashed label={pctOf(result.control.rate)} tip={`${result.control.paid} of ${result.control.conversations} paid`} />
            <span className="mt-1.5 text-[12px] text-dw-ink/60">Today</span>
          </div>
          <div className="flex flex-col items-center">
            <Pill value={result.treatment.rate} max={max} height={110} width={30} label={pctOf(result.treatment.rate)} tip={`${result.treatment.paid} of ${result.treatment.conversations} paid`} />
            <span className="mt-1.5 text-[12px] text-dw-ink/60">New</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 pb-6">
          <div className="num text-[40px] leading-none font-semibold tracking-[-0.03em]">{signedPct(result.lift)}</div>
          <div className="mt-1 text-[13px] text-dw-ink/70">more paid chats with the new pitch than with today&apos;s</div>
        </div>
      </div>
      {p !== undefined && (
        <div className="mt-2">
          <div className="flex justify-between text-[12.5px] text-dw-ink/70">
            <span>
              <b className="num font-semibold text-dw-ink">{pctOf(p)}</b> chance the new pitch is better
            </span>
            <span>kept at {Math.round(SHIP_AT * 100)}%</span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full bg-dw-ink/10">
            <div className="h-full rounded-full bg-dw-ink transition-[width] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]" style={{ width: `${Math.max(2, Math.min(100, p * 100))}%` }} />
            <span className="absolute -top-1 h-4 w-[2px] rounded-full bg-dw-ink" style={{ left: `${SHIP_AT * 100}%` }} aria-hidden />
          </div>
          {result.liftInterval && (
            <div className="mt-1.5 text-[12px] text-dw-ink/55">
              Likely between {signedPct(result.liftInterval[0])} to {signedPct(result.liftInterval[1])}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
