"use client";

import Link from "next/link";
import { MotionConfig, motion } from "motion/react";
import { ArrowRight, Gauge, Store } from "lucide-react";
import { Mascot } from "@/components/dw/mascot";
import { BrandGlyph, type BrandKey } from "@/components/dw/brand-logos";
import { Art } from "@/components/dw/art";
import { GelLink } from "@/components/dw/gel";
import { LandingLoop } from "@/components/console/landing-loop";
import { AgentStickers } from "./agent-stickers";
import { Timeline } from "./timeline";
import { Crew } from "./crew";
import { Questions } from "./questions";
import { Closing } from "./closing";
import { Footer } from "./footer";

const EASE = [0.2, 0.8, 0.2, 1] as const;

const SHOPPERS: { brand: BrandKey; name: string }[] = [
  { brand: "openai", name: "ChatGPT" },
  { brand: "claude", name: "Claude" },
  { brand: "perplexity", name: "Perplexity" },
  { brand: "gemini", name: "Gemini" },
  { brand: "grok", name: "Grok" },
  { brand: "copilot", name: "Copilot" },
];

/** Words over the painting: white, lifted off the sky by a soft shadow. */
const ON_ART = "text-white [text-shadow:0_1px_10px_rgba(20,40,60,0.45)]";

const NAV_LINK =
  "flex h-10 items-center gap-1.5 rounded-full bg-dw-bg/90 px-3.5 text-[14.5px] font-medium text-dw-ink/80 transition-colors hover:bg-dw-bg hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-white max-sm:w-10 max-sm:justify-center max-sm:px-0";

/**
 * The public landing page: one screen. A painting, the headline, one gel door, and the Darwin
 * dashboard itself, live, running on simulated shoppers (a swipeable strip of cards on phones).
 */
export function Landing() {
  // Same props on the server and the client (no hydration mismatch); MotionConfig drops the movement
  // for people who ask for reduced motion.
  const rise = (delay: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: EASE } });

  return (
    <MotionConfig reducedMotion="user">
      <div data-dw className="relative isolate flex min-h-[100svh] w-full flex-col overflow-x-hidden bg-dw-bg font-dw text-dw-ink lg:h-[100svh] lg:overflow-hidden">
        {/* the painting: full-bleed on a computer, the hero's sky on a phone */}
        <Art id="marsh" position="50% 0%" priority scrim="bg-[#0b2533]/25 max-sm:bg-[#0b2533]/25" className="-z-10 max-sm:bottom-auto max-sm:h-[456px]" />
        {/* a few AI-shopper stickers pressed onto the sky, in the margins (decoration) */}
        <AgentStickers />

        {/* quiet nav */}
        <header className="mx-auto flex h-16 w-full max-w-[1600px] shrink-0 items-center justify-between gap-3 px-4 pt-4 sm:px-7">
          <Link href="/" className="flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-dw-ink" aria-label="Darwin home">
            <Mascot kind="leader" size={32} active />
            <span className={`text-[22px] font-semibold tracking-[-0.02em] ${ON_ART}`}>darwin</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1.5">
            <Link href="/readiness" className={NAV_LINK} aria-label="Agent readiness">
              <Gauge className="size-4" aria-hidden />
              <span className="max-sm:hidden">Agent readiness</span>
            </Link>
            <Link href="/store" className={NAV_LINK} aria-label="Demo store">
              <Store className="size-4" aria-hidden />
              <span className="max-sm:hidden">Demo store</span>
            </Link>
            <GelLink href="/onboarding" tone="ghost" h={38} fontSize={14} className="ml-1.5 max-sm:hidden">
              Get started
            </GelLink>
          </nav>
        </header>

        <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col items-center px-4 sm:px-7">
          <motion.h1
            {...rise(0.05)}
            className={`isolate mt-8 text-center text-[38px] leading-[1.05] font-semibold tracking-[-0.035em] text-balance max-sm:mt-10 max-sm:self-stretch max-sm:text-left max-sm:text-[44px] max-sm:leading-[1] sm:mt-[clamp(1.5rem,4.5vh,3.25rem)] sm:text-[52px] xl:text-[60px] ${ON_ART}`}
          >
            Your store,{" "}
            <span className="relative inline-block whitespace-nowrap text-dw-ink [text-shadow:none]">
              <motion.span
                aria-hidden
                className="absolute inset-x-[-0.1em] inset-y-[0.05em] -z-10 rounded-[0.16em] bg-dw-yellow"
                style={{ originX: 0 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.45, duration: 0.7, ease: EASE }}
              />
              improving itself.
            </span>
          </motion.h1>
          <motion.p {...rise(0.12)} className={`mt-3 text-center text-[16px] font-medium max-sm:self-stretch max-sm:text-left max-sm:text-[17px] sm:text-[17px] ${ON_ART}`}>
            For the people and the AI agents who shop there.
          </motion.p>

          <motion.div {...rise(0.18)} className="mt-6 flex w-full flex-col items-center gap-2.5 max-sm:mt-7 sm:w-auto sm:flex-row">
            <GelLink href="/onboarding" h={56} fontSize={17} className="group w-full sm:w-auto">
              Set up your store
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </GelLink>
            <GelLink href="/console" tone="ghost" h={56} fontSize={17} className="max-sm:hidden">
              Open Darwin
            </GelLink>
            <Link
              href="/console"
              className="flex h-11 items-center rounded-full bg-dw-bg/85 px-5 text-[15.5px] font-medium text-dw-ink shadow-[0_1px_2px_rgba(20,20,19,0.12)] transition-colors hover:bg-dw-bg focus-visible:outline-2 focus-visible:outline-white sm:hidden"
            >
              Open Darwin
            </Link>
          </motion.div>

          <motion.p
            {...rise(0.24)}
            className={`mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13.5px] max-sm:mt-3 max-sm:rounded-full max-sm:bg-[#0b2533]/40 max-sm:px-3.5 max-sm:py-1.5 max-sm:font-medium ${ON_ART}`}
          >
            <span>Sells to AI shoppers in</span>
            <span className="flex items-center gap-3 [filter:drop-shadow(0_1px_4px_rgba(20,40,60,0.45))]">
              {SHOPPERS.map((s) => (
                <BrandGlyph key={s.brand} brand={s.brand} size={16} title={s.name} />
              ))}
            </span>
          </motion.p>

          {/* the dashboard, live */}
          <div className="relative mt-6 w-full max-w-[1320px] max-sm:mt-14 max-sm:pb-8 lg:mt-[clamp(1rem,3.5vh,2.25rem)] lg:min-h-0 lg:flex-1">
            <LandingLoop className="lg:h-full" />
          </div>
        </main>
      </div>

      {/* below the hero: how it works, the crew, questions, the last door, the footer (cloned from Wayari) */}
      <div data-dw className="relative w-full overflow-x-clip bg-dw-bg font-dw text-dw-ink">
        <Timeline />
        <Crew />
        <Questions />
        <Closing />
        <Footer />
      </div>
    </MotionConfig>
  );
}
