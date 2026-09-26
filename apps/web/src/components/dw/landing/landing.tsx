"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Gauge, GitPullRequest, Store } from "lucide-react";
import { Mascot } from "@/components/dw/mascot";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { Card, PillButton } from "@/components/dw/ui";
import { LandingLoop } from "@/components/console/landing-loop";

const SHOPPERS = ["ChatGPT", "Claude", "Perplexity", "Gemini", "Grok", "Copilot"].map((n) => agentBrand(n));

const NAV_LINK =
  "flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium text-dw-ink/70 transition-colors hover:bg-dw-sand hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-dw-ink";

/** The public landing page (cream Darwin design). */
export function Landing() {
  const reduce = useReducedMotion();
  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, delay, ease: [0.2, 0.8, 0.2, 1] as const } };

  return (
    <div data-dw className="min-h-screen w-full overflow-x-hidden bg-dw-bg font-dw text-dw-ink">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col px-4 pt-5 pb-16 sm:px-7">
        {/* nav */}
        <header className="flex h-16 items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Darwin home">
            <Mascot kind="analyst" size={34} active />
            <span className="text-[23px] font-semibold tracking-[-0.02em]">darwin</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <Link href="/readiness" className={`${NAV_LINK} max-md:hidden`}>
              <Gauge className="size-4" aria-hidden />
              Agent readiness
            </Link>
            <Link href="/store" className={`${NAV_LINK} max-md:hidden`}>
              <Store className="size-4" aria-hidden />
              Demo store
            </Link>
            <Link href="/console" className={`${NAV_LINK} max-sm:hidden`}>
              Open Darwin
            </Link>
            <PillButton href="/onboarding" className="ml-1">
              Get started
            </PillButton>
          </nav>
        </header>

        {/* hero */}
        <section className="grid items-center gap-10 pt-10 pb-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:pt-14">
          <div className="flex min-w-0 flex-col items-start">
            <motion.h1 {...rise(0)} className="max-w-[13ch] text-[46px] leading-[1.02] font-semibold tracking-[-0.035em] sm:text-[64px] xl:text-[80px]">
              The storefront that improves itself
            </motion.h1>
            <motion.p {...rise(0.08)} className="mt-5 text-[22px] leading-snug font-medium tracking-[-0.01em] sm:text-[26px]">
              For people and AI shoppers.
            </motion.p>
            <motion.p {...rise(0.14)} className="mt-3 max-w-[36rem] text-[17px] leading-relaxed text-dw-ink/70">
              Darwin watches how both move through your store, finds where they drop off, tests a fix on live traffic and ships the winner as a pull
              request. Then it goes round again.
            </motion.p>

            <motion.div {...rise(0.2)} className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <PillButton href="/onboarding" size="lg" className="group">
                Set up your store
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </PillButton>
              <PillButton href="/console" size="lg" tone="white">
                Open Darwin
              </PillButton>
            </motion.div>
            <motion.div {...rise(0.26)} className="mt-4">
              <Link
                href="/readiness"
                className="group inline-flex items-center gap-2 rounded-full py-1.5 pr-2 text-[15px] font-medium text-dw-ink/75 underline-offset-4 hover:text-dw-ink hover:underline focus-visible:outline-2 focus-visible:outline-dw-ink"
              >
                <span className="grid size-7 place-items-center rounded-full bg-dw-yellow">
                  <Gauge className="size-3.5" aria-hidden />
                </span>
                Score any store for AI shoppers
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </motion.div>

            <motion.div {...rise(0.32)} className="mt-10 flex flex-col gap-3">
              <p className="text-[14px] text-dw-ink/60">Works with the AI shoppers people already use</p>
              <ul className="flex flex-wrap items-center gap-2">
                {SHOPPERS.map((b, i) => (
                  <motion.li
                    key={b.key}
                    className="flex h-11 items-center gap-2 rounded-full bg-white/70 py-1 pr-3.5 pl-1 text-[14px] font-medium shadow-[0_1px_0_rgba(20,20,19,0.05)]"
                    whileHover={reduce ? undefined : { y: -3, rotate: i % 2 ? 2 : -2 }}
                    transition={{ type: "spring", stiffness: 400, damping: 18 }}
                  >
                    <AgentTile brand={b} size={34} />
                    {b.name}
                  </motion.li>
                ))}
              </ul>
            </motion.div>
          </div>

          <motion.div
            initial={reduce ? undefined : { opacity: 0, scale: 0.96 }}
            animate={reduce ? undefined : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
            className="min-w-0"
          >
            <LandingLoop />
          </motion.div>
        </section>

        {/* why it works: 1.7fr / 1fr */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card tone="blue" shape="observer" corner="br" className="p-7 sm:p-8">
            <h2 className="max-w-[28rem] text-[26px] leading-tight font-semibold tracking-[-0.02em]">Two kinds of shopper, one loop</h2>
            <p className="mt-3 max-w-[40rem] text-[16px] leading-relaxed text-dw-ink/75">
              People get a clearer page. AI shoppers get a better store API: stock, delivery dates, returns and the landed price, over MCP and A2A.
              Darwin tells them apart and judges every change on the shoppers it was made for.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="flex h-10 items-center gap-2 rounded-full bg-white/70 pr-4 pl-1.5 text-[14px] font-medium">
                <Mascot kind="experimenter" size={30} active={false} /> People see the page
              </span>
              <span className="flex h-10 items-center gap-2 rounded-full bg-white/70 pr-4 pl-1.5 text-[14px] font-medium">
                <AgentTile brand={SHOPPERS[0]} size={30} invert /> Agents read the API
              </span>
            </div>
          </Card>
          <Card tone="olive" shape="shipper" corner="br" className="p-7 sm:p-8">
            <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">Proof, not vibes</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-dw-ink/80">
              Every change is A/B tested and ships as a pull request your team reviews. Losers are dropped. Simulated traffic is always labelled.
            </p>
            <span className="mt-6 inline-flex h-10 items-center gap-2 rounded-full bg-dw-ink px-4 text-[14px] font-medium text-white">
              <GitPullRequest className="size-4" aria-hidden /> Winners arrive as pull requests
            </span>
          </Card>
        </section>
      </div>
    </div>
  );
}
