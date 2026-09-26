"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { timeAgo } from "@/lib/console/format";
import { useNow } from "@/lib/console/hooks";
import { BrandGlyph } from "../brand-logos";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Card, pct0, PillButton, Segmented, signed0, Typing } from "../ui";
import { getJson, HttpError, useOrigin, type Briefing, type BriefingAction, type BriefingItem } from "./data";
import { Snippet } from "./snippet";

const DOCS = "https://github.com/jawadjalal/ecomhack/blob/main/docs/GROK_BOT.md";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; briefing: Briefing } | { kind: "error"; message: string; status?: number };

const STATUS: Record<BriefingItem["status"], string> = {
  ready: "Ready to ship",
  winning: "Winning",
  losing: "Losing",
  running: "Running",
  shipped: "Shipped",
  stopped: "Stopped",
};
const KIND: Record<BriefingItem["kind"], string> = { loop: "Store page", web: "Website", agent: "Store agent" };
const MAX_LINES = 5;
const STEPS = [
  "Every hour, it reads Darwin's briefing.",
  "If a test is ready or clearly losing, it messages you with one question.",
  "You answer yes, and it ships or stops the test, then tells you what happened.",
];

/** The team's Grok bot: reads GET /api/briefing every hour and asks the merchant to ship or stop. */
export function GrokCard({ className }: { className?: string }) {
  const { mock, notify } = useDarwin();
  const origin = useOrigin();
  const now = useNow();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [acting, setActing] = useState<string | null>(null);
  const [tab, setTab] = useState<"read" | "act">("read");

  const load = async () => {
    setState({ kind: "loading" });
    try {
      const briefing = await getJson<Briefing>("/api/briefing");
      setState({ kind: "ready", briefing });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : undefined;
      const message =
        status === 404
          ? "The briefing isn't on this server yet. Update Darwin and it will show up here."
          : status === 401 || status === 403
            ? "This server wants the admin key. Open mission control with ?key=… once, then try again."
            : `Couldn't fetch the briefing: ${(e as Error).message}`;
      setState({ kind: "error", message, status });
    }
  };

  const act = async (id: string, action: BriefingAction) => {
    setActing(`${id}:${action}`);
    try {
      const res = await getJson<{ ok: boolean; text: string; briefing?: Briefing }>("/api/briefing/act", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      notify(res.text, res.ok ? "info" : "bad");
      if (res.briefing) setState({ kind: "ready", briefing: res.briefing });
    } catch (e) {
      notify(`Couldn't ${action}: ${(e as Error).message}`);
    } finally {
      setActing(null);
    }
  };

  const read = `curl -s ${origin}/api/briefing \\\n  -H "Authorization: Bearer $DARWIN_ADMIN_TOKEN"`;
  const write = `curl -s -X POST ${origin}/api/briefing/act \\\n  -H "Authorization: Bearer $DARWIN_ADMIN_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"id":"<item id>","action":"ship"}'`;

  return (
    <Card tone="pink" shape="experimenter" corner="tr" className={cn("flex flex-col overflow-clip p-6 sm:p-7", className)} aria-label="Your Grok teammate">
      <div className="flex items-start gap-4">
        <span className="relative flex shrink-0 items-center">
          <span className="grid size-[52px] place-items-center rounded-[18px] bg-dw-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_18px_-6px_rgba(20,20,19,0.45)]">
            <BrandGlyph brand="grok" size={26} title="Grok" />
          </span>
          <span className="absolute -right-3 -bottom-2">
            <Mascot kind="leader" size={28} active title="Darwin" />
          </span>
        </span>
        <div className="min-w-0 flex-1 pl-2">
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Your Grok teammate</h2>
          <p className="mt-1.5 max-w-[42rem] text-[14.5px] leading-snug text-[#5A2342]">
            A Grok bot reads Darwin every hour and messages you when there&apos;s a call to make, like “your new checkout is winning at 91%: want me to ship it?” Say yes and it
            ships, through the same API below.
          </p>
        </div>
        <a
          href={DOCS}
          target="_blank"
          rel="noreferrer"
          className="hidden shrink-0 items-center gap-1 rounded-full bg-white/60 px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none sm:inline-flex"
        >
          Setup guide <ArrowUpRight className="size-3.5" />
        </a>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        {/* ------------------------------------------------ preview */}
        <div className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-white/55 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold">Today&apos;s briefing</span>
            {state.kind === "ready" ? (
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-dw-ink/70 transition-colors hover:bg-white hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none"
              >
                <RefreshCw className="size-3.5" /> {timeAgo(state.briefing.generatedAt, now) === "now" ? "just now" : `${timeAgo(state.briefing.generatedAt, now)} ago`}
              </button>
            ) : null}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {state.kind === "idle" || state.kind === "loading" ? (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex flex-1 flex-col justify-center gap-4 rounded-2xl border border-dashed border-dw-ink/20 p-4"
              >
                {/* A ghost of the message to come. */}
                <div className="flex items-end gap-2.5" aria-hidden>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-ink/10 text-dw-ink/40">
                    <BrandGlyph brand="grok" size={15} />
                  </span>
                  <div className={cn("flex w-full max-w-[22rem] flex-col gap-2 rounded-[20px] rounded-bl-md bg-dw-ink/[0.06] px-4 py-3.5", state.kind === "loading" && "animate-pulse")}>
                    <span className="h-2.5 w-[85%] rounded-full bg-dw-ink/15" />
                    <span className="h-2.5 w-[65%] rounded-full bg-dw-ink/15" />
                    <span className="h-2 w-[45%] rounded-full bg-dw-ink/10" />
                  </div>
                </div>
                <p className="text-[13.5px] leading-snug text-dw-ink/70">See exactly what the bot would send you right now, from Darwin&apos;s live numbers.</p>
                <PillButton size="sm" onClick={() => void load()} disabled={state.kind === "loading"} aria-busy={state.kind === "loading"} className="self-start">
                  {state.kind === "loading" ? (
                    <span className="flex items-center gap-2 [&_.bg-dw-ink]:bg-white">
                      Reading Darwin <Typing />
                    </span>
                  ) : (
                    <>
                      <BrandGlyph brand="grok" size={14} /> Preview today&apos;s briefing
                    </>
                  )}
                </PillButton>
                {mock && <p className="text-[12px] text-dw-ink/55">The briefing reads the server, not this in-browser demo.</p>}
              </motion.div>
            ) : state.kind === "error" ? (
              <motion.div key="err" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-start gap-3 rounded-2xl bg-dw-warn-bg p-4">
                <p className="text-[13.5px] leading-snug text-dw-warn">{state.message}</p>
                <PillButton size="sm" tone="white" onClick={() => void load()}>
                  Try again
                </PillButton>
              </motion.div>
            ) : (
              <motion.div key="ready" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2.5">
                <Message briefing={state.briefing} />
                {state.briefing.ask && (
                  <Replies ask={state.briefing.ask} item={state.briefing.items.find((x) => x.id === state.briefing.ask?.id)} acting={acting} onAct={(id, a) => void act(id, a)} />
                )}
                {state.briefing.items.length > 0 && (
                  <ul className="mt-1 flex flex-col" aria-label="Everything in the briefing">
                    {state.briefing.items.slice(0, MAX_LINES).map((item, i) => (
                      <Line key={item.id} i={i} item={item} asked={state.briefing.ask?.id === item.id} />
                    ))}
                    {state.briefing.items.length > MAX_LINES && (
                      <li className="px-2 pt-1 text-[12.5px] text-dw-ink/60">+{state.briefing.items.length - MAX_LINES} more in the full briefing</li>
                    )}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ------------------------------------------------ setup */}
        <div className="flex min-w-0 flex-col gap-3">
          <ol className="relative mb-1 flex flex-col gap-2.5" aria-label="How it works">
            <span aria-hidden className="absolute top-3 bottom-3 left-[11px] w-px bg-[#5A2342]/20" />
            {STEPS.map((step, i) => (
              <motion.li
                key={step}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.08 }}
                className="relative flex items-start gap-3 text-[13.5px] leading-snug"
              >
                <span className="num grid size-[23px] shrink-0 place-items-center rounded-full bg-dw-ink text-[11.5px] font-semibold text-white ring-4 ring-dw-pink">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </motion.li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold">Hook up your bot</span>
            <Segmented
              value={tab}
              onChange={setTab}
              className="bg-white/55"
              options={[
                { value: "read", label: "Every hour" },
                { value: "act", label: "When you say yes" },
              ]}
            />
          </div>
          <p className="text-[13px] leading-snug text-[#5A2342]">
            {tab === "read"
              ? "The bot fetches the briefing and forwards the headline as-is. Simulated numbers are labelled."
              : "Each item has an id. Ship or stop it with one call, and the bot gets a sentence back to reply with."}
          </p>
          <Snippet dark label={tab === "read" ? "Read the briefing" : "Act on an item"} code={tab === "read" ? read : write} />
          <p className="text-[12.5px] leading-snug text-[#5A2342]">
            Keep <span className="font-dwmono text-[12px]">DARWIN_ADMIN_TOKEN</span> in the bot&apos;s secrets.{" "}
            <a href={DOCS} target="_blank" rel="noreferrer" className="font-medium text-dw-ink underline decoration-dw-ink/30 underline-offset-2 hover:decoration-dw-ink">
              Read the full guide
            </a>
          </p>
        </div>
      </div>
    </Card>
  );
}

/** The headline as the chat message the merchant would get. */
function Message({ briefing }: { briefing: Briefing }) {
  const rest = briefing.text.startsWith(briefing.headline) ? briefing.text.slice(briefing.headline.length).trim() : briefing.text;
  return (
    <div className="flex items-end gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-ink text-white">
        <BrandGlyph brand="grok" size={15} />
      </span>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        style={{ transformOrigin: "bottom left" }}
        className="min-w-0 rounded-[20px] rounded-bl-md bg-dw-ink px-4 py-3 text-white"
      >
        <p className="text-[14.5px] leading-snug font-medium">{briefing.headline}</p>
        {rest && <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-white/70" title={rest}>{rest}</p>}
      </motion.div>
    </div>
  );
}

/** The merchant's quick replies to the question, exactly what the bot's "yes" / "no" would do. */
function Replies({
  ask,
  item,
  acting,
  onAct,
}: {
  ask: NonNullable<Briefing["ask"]>;
  item?: BriefingItem;
  acting: string | null;
  onAct: (id: string, a: BriefingAction) => void;
}) {
  const other: BriefingAction = ask.action === "ship" ? "stop" : "ship";
  const actions = item ? [ask.action, ...item.actions.filter((a) => a !== ask.action)] : [ask.action];
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex flex-wrap items-center justify-end gap-1.5 pl-10">
      <span className="mr-1 text-[12px] text-dw-ink/55">Reply</span>
      {actions.map((a) => (
        <PillButton
          key={a}
          size="sm"
          tone={a === ask.action ? "ink" : "white"}
          disabled={!!acting}
          onClick={() => onAct(ask.id, a)}
          className="h-8 px-3.5 text-[13px]"
          aria-label={`${a === "ship" ? "Ship" : "Stop"} “${item?.title ?? ask.id}”`}
        >
          {acting === `${ask.id}:${a}` ? <Typing /> : a === ask.action ? (a === "ship" ? "Yes, ship it" : "Yes, stop it") : a === other ? (a === "ship" ? "Ship it instead" : "No, stop it") : a}
        </PillButton>
      ))}
    </motion.div>
  );
}

const DOT: Record<BriefingItem["status"], string> = {
  ready: "bg-dw-live",
  winning: "bg-dw-live",
  losing: "bg-dw-warn",
  running: "bg-dw-ink/35",
  shipped: "bg-dw-ink",
  stopped: "bg-dw-ink/20",
};

/** One compact line per item: status, title, chance to win. The full sentence is in the tooltip. */
function Line({ i, item, asked }: { i: number; item: BriefingItem; asked: boolean }) {
  const path = toPath(item.url);
  const body = (
    <>
      <span className={cn("size-2 shrink-0 rounded-full", DOT[item.status], (item.status === "winning" || item.status === "ready") && "dw-live-dot")} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[13.5px]">
        <span className={cn("font-medium", asked && "font-semibold")}>{item.title}</span>
        <span className="text-dw-ink/50">
          {" "}
          · {STATUS[item.status].toLowerCase()} · {KIND[item.kind].toLowerCase()}
          {item.traffic !== "real" ? ` · ${item.traffic === "simulated" ? "simulated" : "partly simulated"}` : ""}
        </span>
      </span>
      {item.probabilityToBeat !== undefined && (
        <span className="num shrink-0 text-[13px] font-semibold" title="Chance it beats the original">
          {pct0(item.probabilityToBeat)}
          {item.lift !== undefined && <span className="ml-1.5 font-normal text-dw-ink/50">{signed0(item.lift)}</span>}
        </span>
      )}
    </>
  );
  const cls = "dw-row flex h-9 items-center gap-2.5 rounded-xl px-2 hover:bg-white/70";
  return (
    <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }} title={item.say}>
      {path ? (
        <a href={path} className={cn(cls, "focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none")}>
          {body}
        </a>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </motion.li>
  );
}

/** Briefing links are absolute (for the bot); open them in-app when they point here. */
function toPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.origin === window.location.origin ? `${u.pathname}${u.search}` : url;
  } catch {
    return undefined;
  }
}
