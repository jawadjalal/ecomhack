"use client";

/**
 * Questions: the ones a store owner asks before connecting a store, answered in plain words (a clone of
 * Wayari's Questions: a window on the desk, every question a button over its answer, the first open).
 * Each fold opens and shuts by its height; reduced motion shows it at once.
 */
import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { BrandGlyph, WhopLogo } from "@/components/dw/brand-logos";
import { CARD, EASE, H2, Reveal, Sel } from "./bits";

const README = "https://github.com/jawadjalal/ecomhack#readme";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "What does Darwin do?",
    a: "Darwin watches how people and AI shoppers use your store, finds where they get stuck, tests a fix, and keeps the version that sells more. Then it starts again.",
  },
  {
    q: "Do I need to code?",
    a: "No. Paste one script tag into your site, or connect your Whop store. Darwin does the rest.",
  },
  {
    q: "What are AI shoppers?",
    a: "Assistants like ChatGPT, Claude and Perplexity that look for products and buy them for people. Darwin makes sure they can find your prices, sizes and delivery times, so they can recommend you.",
  },
  {
    q: "Is the data real?",
    a: "Your own store's numbers come from real visits. The demo store runs on simulated shoppers so you can watch the loop work, and every simulated visit is labelled as simulated.",
  },
  {
    q: "Will it invent claims about my store?",
    a: "No. Darwin only uses facts that are already on your page, like prices, sizes and delivery times. It never makes up reviews, discounts or promises.",
  },
  {
    q: "Can I undo a change?",
    a: "Yes. Any change Darwin ships can be undone in one click.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Darwin is free while it is in beta.",
  },
  {
    q: "Which tools does it work with?",
    a: (
      <>
        <span className="mb-2.5 flex items-center gap-2.5 text-dw-ink" aria-hidden>
          <BrandGlyph brand="shopify" size={18} />
          <BrandGlyph brand="github" size={18} />
          <WhopLogo size={18} />
        </span>
        Shopify, Webflow, WordPress, Whop and GitHub. Coding agents like Claude Code, Cursor and Codex can drive it for you too.
      </>
    ),
  },
];

function Item({ q, a, open, onToggle, last }: { q: string; a: ReactNode; open: boolean; onToggle: () => void; last: boolean }) {
  const id = useId();
  return (
    <li className={cn(!last && "border-b border-dw-hairline")}>
      <h3>
        <button
          type="button"
          id={`${id}-q`}
          aria-expanded={open}
          aria-controls={`${id}-a`}
          onClick={onToggle}
          className="group flex w-full items-center gap-4 px-5 py-5 text-left text-[17px] font-semibold tracking-[-0.01em] transition-colors hover:bg-dw-bg/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-dw-ink sm:px-7 sm:text-[19px]"
        >
          <span className="flex-1">{q}</span>
          <span
            aria-hidden
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-300",
              open ? "rotate-45 bg-dw-pink" : "bg-dw-sand group-hover:bg-dw-pink/60",
            )}
          >
            <Plus className="size-4" strokeWidth={2.4} />
          </span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-a`}
            role="region"
            aria-labelledby={`${id}-q`}
            key="a"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: 0.42, ease: EASE }, opacity: { duration: 0.28 } }}
            className="overflow-hidden"
          >
            <div className="max-w-[640px] px-5 pb-6 text-[16px] leading-relaxed text-dw-ink/75 sm:px-7 sm:text-[17px]">{a}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function Questions() {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section id="questions" aria-labelledby="questions-title" className="relative scroll-mt-6 px-4 py-20 sm:px-7 sm:py-28">
      <div className="mx-auto max-w-[880px]">
        <Reveal as="header" className="text-center">
          <p className="text-[14px] font-medium text-dw-muted">Questions</p>
          <h2 id="questions-title" className={cn(H2, "mt-3")}>
            Your questions, <Sel>answered.</Sel>
          </h2>
        </Reveal>

        <Reveal delay={0.08} className={cn(CARD, "mt-12 overflow-hidden")}>
          <div className="flex h-12 items-center gap-2 border-b border-dw-hairline px-5 sm:px-7">
            <span aria-hidden className="flex gap-1.5">
              <i className="size-2.5 rounded-full bg-dw-pink-shape" />
              <i className="size-2.5 rounded-full bg-dw-yellow-shape" />
              <i className="size-2.5 rounded-full bg-dw-olive" />
            </span>
            <span className="ml-1 text-[13.5px] font-medium text-dw-ink/80">Questions</span>
            <span className="ml-auto rounded-full bg-dw-win-bg px-2.5 py-0.5 text-[12px] font-medium text-dw-win tabular-nums">{QA.length} answered</span>
          </div>
          <ul>
            {QA.map((x, i) => (
              <Item key={x.q} q={x.q} a={x.a} open={open.has(i)} onToggle={() => toggle(i)} last={i === QA.length - 1} />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dw-hairline bg-dw-bg/50 px-5 py-4 sm:px-7">
            <span className="text-[14.5px] text-dw-muted">Something else?</span>
            <a
              href={README}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full px-1 text-[14.5px] font-medium underline decoration-dw-ink/30 underline-offset-4 transition-colors hover:decoration-dw-ink focus-visible:outline-2 focus-visible:outline-dw-ink"
            >
              Read the docs
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
