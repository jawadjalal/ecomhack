"use client";

/**
 * Onboarding, screen 2: Darwin asks two questions in a chat (what to track, where), and the answers are
 * appended to the prompt that goes to POST /api/onboarding/plan, so the plan is personalised.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Globe, Plus } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Mascot } from "@/components/dw/mascot";
import { PillButton, Typing } from "@/components/dw/ui";
import { Gel } from "@/components/dw/gel";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { WhopLogo } from "@/components/dw/brand-logos";
import { AgentBubble, BrainChip, CheckPop, EASE, YouBubble, type Brain } from "./bits";

export interface Answers {
  track: string[];
  note: string;
  where: string[];
}

/** `phrase` is what goes into the prompt; it uses the words the planner listens for. */
export const TRACK_OPTIONS = [
  {
    id: "checkout",
    label: "Checkout drop-off",
    phrase: "checkout drop-off",
    match: /checkout|cart|abandon|pay/,
  },
  {
    id: "sizing",
    label: "Sizing questions",
    phrase: "sizing questions",
    match: /\bsiz|\bfit\b/,
  },
  {
    id: "mobile",
    label: "Mobile vs desktop",
    phrase: "mobile vs desktop",
    match: /mobile|phone|tablet/,
  },
  {
    id: "coupons",
    label: "Coupons",
    phrase: "coupon codes",
    match: /coupon|discount|promo/,
  },
  {
    id: "agents",
    label: "AI shoppers",
    phrase: "AI shoppers",
    match: /\bai\b|agent|chatgpt|\bbots?\b/,
  },
  {
    id: "search",
    label: "Search",
    phrase: "what people search for",
    match: /search/,
  },
] as const;

export const WHERE_OPTIONS = [
  {
    id: "website",
    label: "Your website",
    sub: "darwin.js records every visit",
    phrase: "my website (darwin.js)",
  },
  {
    id: "agents",
    label: "AI shopping agents",
    sub: "Your store agent at /a2a/whop",
    phrase: "AI shopping agents (my store agent at /a2a/whop)",
  },
  {
    id: "whop",
    label: "Whop payments",
    sub: "Sales and refunds, by webhook",
    phrase: "Whop sales",
  },
] as const;

export const Q_TRACK = "What would you like to track in your store?";
export const Q_WHERE = "Where do you want to track your customers?";

/** POST /api/onboarding/plan accepts up to 1000 characters of prompt. */
const PROMPT_MAX = 1000;

/** What the planner reads: the merchant's words, then the answers (the words are trimmed if it's too long). */
export function composePrompt(prompt: string, a: Answers): string {
  const track = TRACK_OPTIONS.filter((o) => a.track.includes(o.id)).map((o) => o.phrase);
  const what = [track.length ? `Track ${track.join(", ")}.` : "", a.note.trim()].filter(Boolean).join(" ");
  const where = WHERE_OPTIONS.filter((o) => a.where.includes(o.id)).map((o) => o.phrase);
  const tail = [what, where.length ? `Customers on: ${where.join(", ")}.` : ""].filter(Boolean).join("\n\n").slice(0, 600);
  const words = prompt.trim().slice(0, Math.max(0, PROMPT_MAX - tail.length - 2));
  return [words, tail].filter(Boolean).join("\n\n");
}

/** The answers as short chips for the merchant's chat bubble. */
export function answerChips(a: Answers): string[] {
  return [
    ...TRACK_OPTIONS.filter((o) => a.track.includes(o.id)).map((o) => o.label),
    ...(a.note.trim() ? [a.note.trim()] : []),
    ...WHERE_OPTIONS.filter((o) => a.where.includes(o.id)).map((o) => o.label),
  ];
}

const AGENTS = ["chatgpt", "claude", "gemini", "perplexity"].map((n) => agentBrand(n));

export function AskChat({
  prompt,
  connectedTo,
  whop,
  brain,
  initial,
  onBack,
  onDone,
}: {
  prompt: string;
  /** "acme/storefront" or "trail-shop.co.uk". */
  connectedTo: string;
  whop?: string;
  brain: Brain | null;
  initial?: Answers;
  onBack: () => void;
  onDone: (a: Answers) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typing, setTyping] = useState(true);
  const [heard] = useState<string[]>(() => TRACK_OPTIONS.filter((o) => o.match.test(prompt.toLowerCase())).map((o) => o.id));
  // AI shoppers are ticked from the start: they're half of what Darwin is for.
  const [track, setTrack] = useState<string[]>(() => initial?.track ?? [...heard, ...(heard.includes("agents") ? [] : ["agents"])]);
  const [note, setNote] = useState(initial?.note ?? "");
  const [where, setWhere] = useState<string[]>(() => initial?.where ?? ["website", "agents", ...(whop ? ["whop"] : [])]);

  // Darwin "types" for a beat before each question.
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => setTyping(false), 650);
    return () => clearTimeout(t);
  }, [typing]);

  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const answers: Answers = { track, note, where };

  const next = () => {
    setStep(1);
    setTyping(true);
  };
  /** Nothing ticked is not a dead end: Darwin starts with the website (the recommended setup). */
  const whereOrDefault = where.length ? where : ["website"];
  const finish = () => {
    if (!where.length) setWhere(whereOrDefault);
    setStep(2);
    setTimeout(() => onDone({ ...answers, where: whereOrDefault }), 450);
  };

  // Question 2's button can land under the fold: bring it into view as soon as the question is asked.
  const cta = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step !== 1 || typing) return;
    const t = setTimeout(() => cta.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 120);
    return () => clearTimeout(t);
  }, [step, typing]);

  const trackChips = [...TRACK_OPTIONS.filter((o) => track.includes(o.id)).map((o) => o.label), ...(note.trim() ? [note.trim()] : [])];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mascot kind="analyst" frame size={52} active title="Darwin" />
          <div>
            <div className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Darwin</div>
            <div className="text-[13.5px] text-dw-ink/60">Your store&apos;s analyst</div>
          </div>
        </div>
        <BrainChip brain={brain} />
      </div>

      {prompt.trim() && <YouBubble text={prompt.trim()} />}

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
        <AgentBubble working={typing}>
          Connected to <b className="font-semibold text-dw-ink">{connectedTo}</b>
          {whop ? (
            <>
              {" "}
              and <b className="font-semibold text-dw-ink">{whop}</b> on Whop
            </>
          ) : null}
          . Two quick questions.
        </AgentBubble>
      </motion.div>

      {/* Question 1: what to track */}
      <AnimatePresence initial={false}>
        {(step > 0 || !typing) && (
          <motion.div key="q1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="flex flex-col gap-3">
            <AgentBubble working={step === 0}>
              <p className="font-medium text-dw-ink">{Q_TRACK}</p>
              {step === 0 && (
                <form
                  className="mt-3 flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    next();
                  }}
                >
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Things to track">
                    {TRACK_OPTIONS.map((o) => (
                      <Chip key={o.id} on={track.includes(o.id)} onClick={() => setTrack((t) => flip(t, o.id))}>
                        {o.label}
                      </Chip>
                    ))}
                  </div>
                  {heard.length > 0 && <p className="text-[13px] text-dw-ink/55">Ticked from your message. Change anything.</p>}
                  <div className="flex items-center gap-2 rounded-full border border-dw-hairline bg-white py-1 pr-1 pl-4 focus-within:border-dw-ink/40 max-sm:border-dw-ink/10 max-sm:bg-dw-bg">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Anything else? e.g. wishlist adds, returns"
                      aria-label="Anything else to track"
                      maxLength={200}
                      className="h-9 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-dw-ink/35"
                    />
                    <Gel type="submit" h={34} fontSize={13.5}>
                      Next <ArrowRight />
                    </Gel>
                  </div>
                </form>
              )}
            </AgentBubble>
            {step > 0 && <YouBubble chips={trackChips.length ? trackChips : ["The essentials are enough"]} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Question 2: where */}
      <AnimatePresence initial={false}>
        {step > 0 && (
          <motion.div key="q2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="flex flex-col gap-3">
            {typing && step === 1 ? (
              <AgentBubble working>
                <Typing />
              </AgentBubble>
            ) : (
              <AgentBubble working={step === 1}>
                <p className="font-medium text-dw-ink">{Q_WHERE}</p>
                {step === 1 && (
                  <div className="mt-3 flex flex-col gap-2" role="group" aria-label="Where your customers are">
                    {WHERE_OPTIONS.map((o) => {
                      const on = where.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setWhere((w) => flip(w, o.id))}
                          className={cn(
                            "dw-row flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none",
                            on ? "bg-dw-ink text-white" : "bg-dw-sand/80 text-dw-ink hover:bg-dw-sand max-sm:bg-dw-bg",
                          )}
                        >
                          <span
                            aria-hidden
                            className="dw-tilt grid h-10 min-w-10 shrink-0 place-items-center rounded-[13px] bg-white text-dw-ink shadow-[0_0_0_1px_rgba(20,20,19,0.06)]"
                          >
                            {o.id === "website" ? (
                              <Globe className="size-[18px]" />
                            ) : o.id === "whop" ? (
                              <WhopLogo size={18} />
                            ) : (
                              <span className="flex -space-x-2 px-1.5">
                                {AGENTS.map((b) => (
                                  <AgentTile key={b.key} brand={b} size={24} className="ring-2 ring-white" />
                                ))}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium">{o.label}</span>
                            <span className={cn("block truncate text-[13px]", on ? "text-white/65" : "text-dw-ink/55")}>
                              {o.id === "whop" && !whop ? "Connect Whop to bring sales in" : o.sub}
                            </span>
                          </span>
                          <span className="grid size-6 shrink-0 place-items-center">
                            {on ? <CheckPop size={22} tone="live" /> : <span className="size-5 rounded-full border-[1.5px] border-dw-ink/25" />}
                          </span>
                        </button>
                      );
                    })}
                    <div ref={cta} className="relative z-10 mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 scroll-mb-6">
                      {!where.length && <span className="mr-auto text-[13px] text-dw-ink/60">Nothing ticked: Darwin starts with your website.</span>}
                      <Gel h={46} onClick={finish} className="max-sm:w-full">
                        Make my plan <ArrowRight />
                      </Gel>
                    </div>
                  </div>
                )}
              </AgentBubble>
            )}
            {step > 1 && <YouBubble chips={WHERE_OPTIONS.filter((o) => whereOrDefault.includes(o.id)).map((o) => o.label)} />}
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <PillButton tone="ghost" size="sm" onClick={onBack}>
          Back
        </PillButton>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-[background-color,color,transform] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none",
        on ? "bg-dw-ink text-white" : "border border-dw-hairline bg-white text-dw-ink/80 hover:border-dw-ink/25 hover:text-dw-ink max-sm:border-dw-ink/15 max-sm:bg-transparent",
      )}
    >
      {on ? (
        <motion.span
          initial={{ scale: 0, rotate: -40 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 18 }}
          className="grid place-items-center"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
            <path d="M3.6 8.4l2.9 2.9 5.9-6.4" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.span>
      ) : (
        <Plus className="size-3.5 text-dw-ink/50" />
      )}
      {children}
    </button>
  );
}
