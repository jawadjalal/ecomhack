"use client";

import Link from "next/link";
import { MotionConfig, motion } from "motion/react";
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

const STEPS = [
  { n: "01", title: "Watch", body: "People and AI shopping agents, on the same store." },
  { n: "02", title: "Find the drop-off", body: "Where a visit stops short of a purchase." },
  { n: "03", title: "Test a change", body: "Half the shoppers see a fix. Darwin measures who buys." },
  { n: "04", title: "Ship the winner", body: "The better version goes live. Then the loop starts again." },
];

const NAV_LINK =
  "flex h-10 items-center gap-1.5 rounded-full px-3 text-[14.5px] font-medium text-dw-ink/70 transition-colors hover:bg-dw-sand hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-dw-ink";

/**
 * Public landing: an editorial column (headline, the loop in four lines, two actions)
 * beside the live dashboard. Not a centred hero sitting on a grid of cards.
 */
export function Landing() {
  const rise = (delay: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: EASE } });

  return (
    <MotionConfig reducedMotion="user">
      <div data-dw className="flex min-h-[100svh] w-full flex-col bg-dw-bg font-dw text-dw-ink">
        <header className="mx-auto flex h-16 w-full max-w-[1600px] shrink-0 items-center justify-between gap-3 px-5 sm:px-8 lg:px-12">
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

        <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <section className="flex flex-col justify-center px-5 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16 xl:px-16">
            <motion.p {...rise(0)} className="text-[13px] font-medium tracking-[0.16em] text-dw-ink/45 uppercase">
              For people and AI shoppers
            </motion.p>
            <motion.h1
              {...rise(0.05)}
              className="mt-4 max-w-[14ch] text-[44px] leading-[0.96] font-semibold tracking-[-0.045em] text-balance sm:text-[60px] xl:text-[68px]"
            >
              Your store,{" "}
              <span className="relative inline-block whitespace-nowrap">
                <motion.span
                  aria-hidden
                  className="absolute inset-x-[-0.06em] bottom-[0.06em] -z-10 h-[0.32em] bg-dw-yellow"
                  style={{ originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.45, duration: 0.7, ease: EASE }}
                />
                improving itself.
              </span>
            </motion.h1>
            <motion.p {...rise(0.12)} className="mt-5 max-w-[36rem] text-[17px] leading-relaxed text-dw-ink/70 sm:text-[18px]">
              Darwin watches how the store is used, finds where shoppers drop off, tests a page change, and ships the winner.
            </motion.p>

            <motion.ol {...rise(0.18)} className="mt-10 max-w-[34rem] border-t border-dw-ink/10">
              {STEPS.map((step) => (
                <li key={step.n} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 border-b border-dw-ink/10 py-3.5">
                  <span className="pt-0.5 font-dwmono text-[12px] text-dw-ink/40">{step.n}</span>
                  <span>
                    <span className="block text-[16px] font-semibold tracking-[-0.02em]">{step.title}</span>
                    <span className="mt-0.5 block text-[14px] leading-snug text-dw-ink/60">{step.body}</span>
                  </span>
                </li>
              ))}
            </motion.ol>

            <motion.div {...rise(0.24)} className="mt-8 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
              <PillButton href="/onboarding" size="lg" className="group w-full sm:w-auto">
                Set up your store
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </PillButton>
              <PillButton href="/console" size="lg" tone="white" className="w-full sm:w-auto">
                Open Darwin
              </PillButton>
            </motion.div>

            <motion.p {...rise(0.3)} className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-dw-ink/50">
              <span>Works with</span>
              <span className="flex items-center gap-3 text-dw-ink/55">
                {SHOPPERS.map((s) => (
                  <BrandGlyph key={s.brand} brand={s.brand} size={16} title={s.name} />
                ))}
              </span>
            </motion.p>
          </section>

          <section className="relative min-h-[560px] border-t border-dw-ink/10 bg-[#EFE8D8] lg:min-h-0 lg:border-t-0 lg:border-l" aria-label="Live demo">
            <div className="absolute inset-0 flex flex-col px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
              <LandingLoop className="min-h-0 flex-1" />
            </div>
          </section>
        </main>
      </div>
    </MotionConfig>
  );
}
