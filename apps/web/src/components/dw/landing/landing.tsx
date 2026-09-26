"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Gauge, Store } from "lucide-react";
import { Mascot } from "@/components/dw/mascot";
import { BrandGlyph, type BrandKey } from "@/components/dw/brand-logos";
import { PillButton } from "@/components/dw/ui";
import { LandingLoop } from "@/components/console/landing-loop";

const EASE = [0.2, 0.8, 0.2, 1] as const;

const SHOPPERS: { brand: BrandKey; name: string }[] = [
  { brand: "openai", name: "ChatGPT" },
  { brand: "claude", name: "Claude" },
  { brand: "perplexity", name: "Perplexity" },
  { brand: "gemini", name: "Gemini" },
  { brand: "grok", name: "Grok" },
  { brand: "copilot", name: "Copilot" },
];

/** Same soft glow as the onboarding's first screen. */
const GLOW =
  "radial-gradient(52rem 30rem at 50% 30%, rgba(246,215,107,0.30), transparent 70%), radial-gradient(36rem 26rem at 8% 96%, rgba(184,202,238,0.30), transparent 70%), radial-gradient(36rem 26rem at 94% 92%, rgba(243,181,213,0.28), transparent 70%)";

const NAV_LINK =
  "flex h-10 items-center gap-1.5 rounded-full px-3 text-[14.5px] font-medium text-dw-ink/70 transition-colors hover:bg-dw-sand hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-dw-ink";

/**
 * The public landing page: one screen. Headline, two actions, and the Darwin dashboard itself,
 * live, running on simulated shoppers.
 */
export function Landing() {
  const reduce = useReducedMotion();
  const rise = (delay: number) => (reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: EASE } });

  return (
    <div data-dw className="relative isolate flex min-h-[100svh] w-full flex-col overflow-x-hidden bg-dw-bg font-dw text-dw-ink lg:h-[100svh] lg:overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: GLOW }} />

      {/* quiet nav */}
      <header className="mx-auto flex h-16 w-full max-w-[1600px] shrink-0 items-center justify-between gap-3 px-4 pt-4 sm:px-7">
        <Link href="/" className="flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-dw-ink" aria-label="Darwin home">
          <Mascot kind="analyst" size={32} active />
          <span className="text-[22px] font-semibold tracking-[-0.02em]">darwin</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5">
          <Link href="/readiness" className={NAV_LINK} aria-label="Agent readiness">
            <Gauge className="size-4" aria-hidden />
            <span className="max-sm:hidden">Agent readiness</span>
          </Link>
          <Link href="/store" className={NAV_LINK} aria-label="Demo store">
            <Store className="size-4" aria-hidden />
            <span className="max-sm:hidden">Demo store</span>
          </Link>
          <PillButton href="/onboarding" size="sm" className="ml-1.5 h-9 px-4">
            Get started
          </PillButton>
        </nav>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col items-center px-4 sm:px-7">
        <motion.h1
          {...rise(0.05)}
          className="isolate mt-8 text-center text-[38px] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:mt-[clamp(1.5rem,4.5vh,3.25rem)] sm:text-[52px] xl:text-[60px]"
        >
          Your store,{" "}
          <span className="relative inline-block whitespace-nowrap">
            <motion.span
              aria-hidden
              className="absolute inset-x-[-0.1em] bottom-[0.06em] -z-10 h-[0.4em] rounded-full bg-dw-yellow"
              style={{ originX: 0 }}
              initial={reduce ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.45, duration: 0.7, ease: EASE }}
            />
            improving itself.
          </span>
        </motion.h1>
        <motion.p {...rise(0.12)} className="mt-3 text-center text-[16px] text-dw-ink/65 sm:text-[17px]">
          For the people and the AI agents who shop there.
        </motion.p>

        <motion.div {...rise(0.18)} className="mt-6 flex w-full flex-col items-center gap-2.5 sm:w-auto sm:flex-row">
          <PillButton href="/onboarding" size="lg" className="group w-full sm:w-auto">
            Set up your store
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </PillButton>
          <PillButton href="/console" size="lg" tone="white" className="w-full sm:w-auto">
            Open Darwin
          </PillButton>
        </motion.div>

        <motion.p {...rise(0.24)} className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-dw-ink/50">
          <span>Works with</span>
          <span className="flex items-center gap-3 text-dw-ink/55">
            {SHOPPERS.map((s) => (
              <BrandGlyph key={s.brand} brand={s.brand} size={16} title={s.name} />
            ))}
          </span>
        </motion.p>

        {/* the dashboard, live */}
        <div className="relative mt-6 w-full max-w-[1320px] lg:mt-[clamp(1rem,3.5vh,2.25rem)] lg:min-h-0 lg:flex-1">
          <LandingLoop className="lg:h-full" />
          {/* fade the bottom edge into the page */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-dw-bg to-transparent max-lg:hidden" />
        </div>
      </main>
    </div>
  );
}
