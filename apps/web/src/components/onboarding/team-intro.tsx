"use client";

/**
 * Onboarding, "Meet your team": Darwin (the only one the merchant talks to) introduces his specialists
 * one by one. Each starts asleep, wakes when Darwin calls on it, and shows what it can do: its real tool
 * list from lib/team/roster (the same names the agents call), with the ones that wait for your OK marked.
 * Tap any mascot to say hi. "Skip" (or reduced motion) shows everyone at once.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Lock, MessageCircle, Wrench } from "lucide-react";
import type { AgentId, MascotState, TeamAgent } from "@/lib/contracts/team";
import { EXAMPLE_ASKS, SPECIALISTS, getAgent } from "@/lib/team/roster";
import { cn } from "@/components/ui/cn";
import { PillButton, Typing } from "@/components/dw/ui";
import { AnimatedMascot, preloadMascots } from "@/components/mascots/animated-mascot";
import { BrainChip, EASE, type Brain } from "@/components/dw/onboarding/bits";

type Line = { id: string; text: string; agent?: AgentId };

/** Darwin's script. `agent` wakes that specialist when the line lands. */
function script(connectedTo: string): Line[] {
  const store = connectedTo || "your store";
  return [
    { id: "hi", text: `Hi, I'm Darwin. I lead the team that looks after ${store}.` },
    { id: "how", text: "You only ever talk to me. I split the job up, hand each piece to the right specialist, run them side by side and come back with one answer." },
    { id: "iris", agent: "iris", text: "Iris watches: every visit, every AI shopper, and what your competitors are up to. She builds your dashboards." },
    { id: "pixel", agent: "pixel", text: "Pixel edits: your live pages and your code, always as a change you can look at first." },
    { id: "fizz", agent: "fizz", text: "Fizz tests: nothing ships on a hunch. Every change runs as an A/B test before it counts." },
    { id: "dash", agent: "dash", text: "Dash ships: winners go to your repo as pull requests, and Dash follows them until they merge." },
    { id: "ok", text: "Anything that changes your site, your code or your settings waits for your OK. Tap any of us to say hi." },
  ];
}

const TYPE_MS = 700;

/** Time to read a line before Darwin starts typing the next one. */
const readMs = (line?: Line) => (line ? Math.min(2000, Math.max(850, line.text.length * 16)) : 350);

export function TeamIntro({ connectedTo, brain, onBack, onDone }: { connectedTo: string; brain: Brain | null; onBack: () => void; onDone: () => void }) {
  const reduce = useReducedMotion();
  const lines = useMemo(() => script(connectedTo), [connectedTo]);
  const [shown, setShown] = useState(0);
  const [typing, setTyping] = useState(false);
  /** Skipped (or reduced motion): everyone shows at once, without the wake-up hops. */
  const [quiet, setQuiet] = useState(false);
  const done = shown >= lines.length;

  useEffect(() => preloadMascots(["leader", ...SPECIALISTS.map((a) => a.mascot)]), []);

  // The script: pause to read the last line, type, show the next line.
  const last = lines[shown - 1];
  useEffect(() => {
    if (done) return;
    if (reduce) {
      const t = setTimeout(() => {
        setQuiet(true);
        setShown(lines.length);
      }, 0);
      return () => clearTimeout(t);
    }
    const wait = readMs(last);
    const t1 = setTimeout(() => setTyping(true), wait);
    const t2 = setTimeout(() => {
      setTyping(false);
      setShown((n) => n + 1);
    }, wait + TYPE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [shown, done, reduce, last, lines.length]);

  const skip = () => {
    setQuiet(true);
    setTyping(false);
    setShown(lines.length);
  };

  const awake = new Set(lines.slice(0, shown).flatMap((l) => (l.agent ? [l.agent] : [])));
  const talkingAbout = !done && shown > 0 ? lines[shown - 1]?.agent : undefined;
  const darwinState: MascotState = typing ? "thinking" : "idle";
  const darwin = getAgent("darwin");

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] lg:gap-10">
        {/* Darwin and what he says */}
        <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-center gap-4">
            <AnimatedMascot kind="leader" state={darwinState} size={104} interactive title="Darwin" flash={done && !quiet ? { state: "success", key: "done" } : undefined} className="-my-3 -ml-2" />
            <div className="min-w-0">
              <h1 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[40px]">Meet your team</h1>
              <p className="mt-1.5 text-[15px] text-dw-ink/65">
                <b className="font-semibold text-dw-ink">Darwin</b> · {darwin.role}
              </p>
            </div>
          </div>
          <BrainChip brain={brain} className="self-start" />

          <ol className="flex flex-col gap-2.5" aria-live="polite">
            {lines.slice(0, shown).map((l) => (
              <motion.li
                key={l.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className={cn(
                  "rounded-[20px] rounded-tl-[8px] border bg-dw-surface px-4 py-2.5 text-[15px] leading-relaxed text-dw-ink/85 shadow-[0_12px_30px_-24px_rgba(20,20,19,0.35)] transition-colors duration-500",
                  talkingAbout && l.agent === talkingAbout ? "border-dw-ink/15" : "border-dw-hairline",
                )}
              >
                {l.agent ? <AgentName id={l.agent} /> : null}
                {l.agent ? l.text.replace(new RegExp(`^${getAgent(l.agent).name}\\s`), " ") : l.text}
              </motion.li>
            ))}
            {!done && typing && (
              <li className="self-start rounded-[20px] rounded-tl-[8px] border border-dw-hairline bg-dw-surface px-4 py-3.5">
                <Typing />
              </li>
            )}
          </ol>

          <DarwinTools agent={darwin} className="max-lg:hidden" />
        </div>

        {/* The specialists */}
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {SPECIALISTS.map((a, i) => (
            <AgentCard key={a.id} agent={a} index={i} awake={awake.has(a.id)} spotlight={talkingAbout === a.id} quiet={quiet} />
          ))}
        </div>
        {/* On small screens Darwin's own tools come after his team, so the cards follow his intro. */}
        <DarwinTools agent={darwin} className="lg:hidden" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillButton tone="ghost" onClick={onBack}>
          Back
        </PillButton>
        <div className="flex items-center gap-2">
          <AnimatePresence initial={false}>
            {!done && (
              <motion.span key="skip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <PillButton tone="ghost" onClick={skip}>
                  Skip intro
                </PillButton>
              </motion.span>
            )}
          </AnimatePresence>
          <PillButton size="lg" onClick={onDone}>
            Nice to meet you all <ArrowRight />
          </PillButton>
        </div>
      </div>
    </div>
  );
}

function AgentName({ id }: { id: AgentId }) {
  const a = getAgent(id);
  return (
    <b className="font-semibold" style={{ color: shade(a.color) }}>
      {a.name}
    </b>
  );
}

/** Darwin's own tools, as a compact line under his intro. */
function DarwinTools({ agent, className }: { agent: TeamAgent; className?: string }) {
  return (
    <div className={cn("rounded-[20px] bg-dw-sand/70 p-3.5", className)}>
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-[0.02em] text-dw-ink/55 uppercase">
        <Wrench className="size-3.5" aria-hidden /> What Darwin does himself
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {agent.tools?.map((t) => (
          <li key={t.name} title={t.name} className="inline-flex h-7 items-center rounded-full bg-dw-surface px-2.5 text-[12.5px] text-dw-ink/80 shadow-[0_0_0_1px_rgba(20,20,19,0.05)]">
            {t.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentCard({ agent, index, awake, spotlight, quiet }: { agent: TeamAgent; index: number; awake: boolean; spotlight: boolean; quiet: boolean }) {
  const reduce = useReducedMotion();
  const tools = agent.tools ?? [];
  const asks = tools.filter((t) => t.confirm).length;
  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: reduce ? 0 : 0.08 * index, ease: EASE }}
      aria-label={`${agent.name}, ${agent.role}`}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-[26px] border bg-dw-surface p-4 transition-[border-color,box-shadow,opacity] duration-500 sm:p-5",
        spotlight ? "shadow-[0_24px_50px_-30px_rgba(20,20,19,0.45)]" : "shadow-[0_12px_30px_-26px_rgba(20,20,19,0.35)]",
        awake ? "opacity-100" : "opacity-70",
      )}
      style={{ borderColor: spotlight ? `${agent.color}80` : "var(--color-dw-hairline)" }}
    >
      {/* A soft wash of the agent's colour, brighter while Darwin talks about it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full blur-2xl transition-opacity duration-700"
        style={{ background: agent.color, opacity: spotlight ? 0.2 : awake ? 0.1 : 0.04 }}
      />
      <div className="relative flex items-center gap-3">
        <AnimatedMascot
          kind={agent.mascot}
          state={awake ? "idle" : "sleeping"}
          flash={awake && !quiet ? { state: "tapped", key: "wake" } : undefined}
          size={76}
          interactive
          title={agent.name}
          className="-my-2 -ml-2"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{agent.name}</h2>
          <span
            className="mt-1 inline-flex h-6 items-center rounded-full px-2.5 text-[12.5px] font-semibold"
            style={{ background: `${agent.color}1f`, color: shade(agent.color) }}
          >
            {agent.role}
          </span>
        </div>
        {!awake && <span className="self-start text-[12px] text-dw-ink/40">asleep</span>}
      </div>

      <p className="relative mt-3 text-[14.5px] leading-snug text-dw-ink/75">{agent.blurb}</p>

      <p className="relative mt-4 text-[12px] font-semibold tracking-[0.02em] text-dw-ink/50 uppercase">What {agent.name} can do</p>
      <ul className="relative mt-2 flex flex-col gap-1">
        {tools.map((t) => (
          <li key={t.name} className="flex items-start gap-2 text-[13.5px] leading-snug text-dw-ink/85" title={t.name}>
            <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full" style={{ background: agent.color }} />
            <span className="min-w-0 flex-1">{t.label}</span>
            {t.confirm && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-dw-sand px-2 py-0.5 text-[11.5px] font-medium text-dw-ink/65">
                <Lock className="size-3" aria-hidden /> asks you first
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="relative mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <span className="inline-flex min-w-0 items-start gap-1.5 text-[12.5px] leading-snug text-dw-ink/55">
          <MessageCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="sr-only">Try asking: </span>“{EXAMPLE_ASKS[agent.id]}”
          </span>
        </span>
        {asks > 0 && <span className="sr-only">{asks} of these wait for your confirmation.</span>}
      </div>
    </motion.article>
  );
}

/** A darker version of an agent colour, readable as text on cream. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = 0.62;
  const c = (v: number) => Math.round(v * f);
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}
