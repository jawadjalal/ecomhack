"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { ArrowUp, Check, ExternalLink, LoaderCircle, Play, ShoppingBag } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Card, CardTitle, Tag, Typing } from "@/components/dw/ui";
import { BuyerAvatar, StoreAvatar } from "./avatars";

export interface ChatOffer {
  id: string;
  title: string;
  description?: string;
  priceLabel: string;
}

export interface ChatLine {
  from: "you" | "store";
  text: string;
  /** Buyer side: who is talking ("console (you)" or a simulated buyer agent's name). */
  buyer?: string;
  /** A turn from Darwin's simulated buyer agent (labelled). */
  simulated?: boolean;
  /** Store side: the A2A data part, when the reply carried one. */
  offers?: ChatOffer[];
  facts?: string[];
  checkout?: { url: string; title: string; tagged?: boolean };
  pending?: boolean;
  error?: boolean;
}

export const SUGGEST = ["Trail running coaching under £40 a month", "Something one-off under £20", "Buy the first one", "What do you sell?"];

/** "Talk to it like a buyer agent": the transcript over the real /a2a/whop endpoint, plus the composer. */
export function ChatCard({
  lines,
  text,
  onText,
  onSend,
  busy,
  running,
  onRunBuyer,
  demo,
}: {
  lines: ChatLine[];
  text: string;
  onText: (t: string) => void;
  onSend: (t: string) => void;
  busy: boolean;
  running: boolean;
  onRunBuyer: () => void;
  demo: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const count = lines.length;
  const lastPending = !!lines[count - 1]?.pending;
  useEffect(() => {
    const el = scroller.current;
    if (el && count) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, lastPending]);

  return (
    <Card tone="white" hover={false} className="flex min-w-0 flex-col p-0 [&>div.relative]:flex [&>div.relative]:flex-1 [&>div.relative]:flex-col" style={{ minHeight: 640 }}>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <CardTitle>Talk to it like a buyer agent</CardTitle>
            <p className="mt-1 text-[14px] text-dw-ink/65">
              Every message goes over the real <span className="font-dwmono text-[12.5px]">/a2a/whop</span> endpoint, exactly as an outside agent would send it.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunBuyer}
            disabled={running}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-dw-sand px-4 text-[14px] font-medium transition-[background-color,transform] hover:bg-[#e4dccb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink active:scale-[0.98] disabled:opacity-50"
          >
            {running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run a simulated buyer agent
          </button>
        </div>

        <div
          ref={scroller}
          className="mx-4 mt-4 flex min-h-[22rem] flex-1 flex-col gap-4 overflow-y-auto rounded-[22px] bg-dw-bg/70 p-4 sm:mx-6 sm:p-5"
          style={{ maxHeight: 560 }}
          aria-live="polite"
        >
          {!lines.length && (
            <div className="m-auto flex max-w-sm flex-col items-center gap-3 py-8 text-center">
              <div className="flex items-end gap-2">
                <StoreAvatar size={56} />
                <BuyerAvatar name="console (you)" size={40} />
              </div>
              <p className="text-[15px] text-dw-ink/70">
                Ask what&apos;s for sale, then say “buy the first one”. Or run a simulated buyer agent and watch it shop.
              </p>
            </div>
          )}
          {lines.map((l, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              className={cn("flex items-end gap-2.5", l.from === "you" ? "flex-row-reverse" : "flex-row")}
            >
              {l.from === "you" ? <BuyerAvatar name={l.buyer ?? "console (you)"} size={32} /> : <StoreAvatar size={34} active={!!l.pending} />}
              {l.from === "you" ? <BuyerBubble line={l} /> : <StoreBubble line={l} demo={demo} />}
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col gap-2.5 px-4 pt-4 pb-5 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSend(text);
            }}
            className="flex h-14 items-center gap-2 rounded-full bg-dw-sand pr-2 pl-5 transition-shadow focus-within:shadow-[0_0_0_2px_#141413]"
          >
            <input
              value={text}
              onChange={(e) => onText(e.target.value)}
              placeholder="Message the store agent…"
              aria-label="Message the store agent"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-dw-ink/45"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label="Send"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-[transform,opacity] hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink active:scale-95 disabled:opacity-30"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
            </button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {SUGGEST.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSend(s)}
                disabled={busy}
                className="h-8 rounded-full border border-dw-ink/10 bg-white px-3.5 text-[13px] text-dw-ink/75 transition-colors hover:border-dw-ink/30 hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BuyerBubble({ line }: { line: ChatLine }) {
  return (
    <div className="flex max-w-[82%] flex-col items-end gap-1">
      {line.simulated && (
        <span className="flex items-center gap-1.5 pr-1 text-[12px] text-dw-ink/55">
          {line.buyer ?? "Simulated buyer"} <Tag tone="warn" className="h-5 px-2 text-[11px]">simulated</Tag>
        </span>
      )}
      <div className="rounded-[16px_16px_4px_16px] bg-dw-ink px-3.5 py-2.5 text-[14px] leading-[1.4] whitespace-pre-line text-white">{line.text}</div>
    </div>
  );
}

function StoreBubble({ line, demo }: { line: ChatLine; demo: boolean }) {
  if (line.pending) {
    return (
      <div className="rounded-[16px_16px_16px_4px] bg-white px-4 py-3.5 shadow-[0_0_0_1px_rgba(20,20,19,0.06)]">
        <Typing />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex max-w-[88%] min-w-0 flex-col gap-3 rounded-[16px_16px_16px_4px] bg-white p-3.5 shadow-[0_0_0_1px_rgba(20,20,19,0.06),0_8px_20px_-14px_rgba(20,20,19,0.3)]",
        line.error && "bg-dw-warn-bg text-dw-warn",
      )}
    >
      <p className="text-[14px] leading-[1.45] break-words whitespace-pre-line">{line.text}</p>
      {!!line.offers?.length && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-dw-ink/55">In the data part, for agents that read it</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {line.offers.map((o, i) => (
              <div key={o.id} className="dw-row flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-dw-sand/70 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[13.5px] font-semibold">
                    <span className="mr-1 font-dwmono text-[11.5px] font-normal text-dw-ink/50">{i + 1}</span>
                    {o.title}
                  </span>
                  <span className="num shrink-0 font-dwmono text-[12.5px]">{o.priceLabel}</span>
                </div>
                <span className="truncate font-dwmono text-[11px] text-dw-ink/45">{o.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!!line.facts?.length && (
        <ul className="flex flex-col gap-1">
          {line.facts.map((f) => (
            <li key={f} className="flex items-start gap-2 text-[13px] text-dw-ink/75">
              <Check className="mt-0.5 size-3.5 shrink-0" /> {f}
            </li>
          ))}
        </ul>
      )}
      {line.checkout && (
        <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-dw-sand p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white">
            <ShoppingBag className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">Checkout ready: {line.checkout.title}</div>
            <div className="text-[12.5px] text-dw-ink/60">
              {line.checkout.tagged === false ? "Plain checkout link" : "Tagged link: the sale is credited to this conversation"}
              {demo ? " · demo checkout, no real charge" : " · payment on Whop"}
            </div>
          </div>
          <a
            href={line.checkout.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-dw-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
          >
            Open checkout <ExternalLink className="size-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}
