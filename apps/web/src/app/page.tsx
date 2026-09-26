import Link from "next/link";
import { ArrowRight, Bot, FlaskConical, GitPullRequest, ShieldCheck, Store } from "lucide-react";
import { DarwinWordmark } from "@/components/console/brand";
import { LandingLoop } from "@/components/console/landing-loop";

const PROPS = [
  {
    icon: Bot,
    title: "Two audiences, one loop",
    body: "Humans get a better page. AI shoppers get a better agent API: stock, delivery ETA, returns, landed price and negotiation over MCP.",
    accent: "text-agent",
  },
  {
    icon: ShieldCheck,
    title: "Safe, declarative changes",
    body: "Every change is a validated PageSpec diff: A/B tested, reversible, and shipped as a normal pull request your team reviews.",
    accent: "text-human",
  },
  {
    icon: FlaskConical,
    title: "Proof, not vibes",
    body: "Bayesian A/B tests decide. Losers are rejected, winners become the next generation. Simulated traffic is always labelled.",
    accent: "text-brand",
  },
];

const FLOW = ["behaviour", "insight", "page change", "A/B test", "pull request"];

export default function Home() {
  return (
    <main data-darwin-dark className="darwin-bg relative min-h-screen w-full overflow-hidden text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[84rem] flex-col px-5 sm:px-8">
        {/* nav */}
        <nav className="flex h-20 shrink-0 items-center justify-between">
          <DarwinWordmark />
          <div className="flex items-center gap-2 text-[0.9rem]">
            <Link href="/store" className="hidden rounded-lg px-3 py-2 text-white/60 transition-colors hover:text-white sm:block">
              Demo store
            </Link>
            <Link
              href="/console"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-2 font-medium text-white/90 transition-colors hover:border-white/20 hover:bg-white/10"
            >
              Mission control <ArrowRight className="size-4" />
            </Link>
          </div>
        </nav>

        {/* hero */}
        <section className="grid flex-1 items-center gap-10 py-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-6 lg:py-0">
          <div className="flex flex-col items-start">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/[0.07] px-3 py-1 text-[0.8rem] font-medium text-brand">
              <span className="size-1.5 rounded-full bg-brand pulse-dot" />
              Self-improving commerce · Cursor Commerce London
            </div>
            <h1 className="text-[2.7rem] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[4rem] xl:text-[4.9rem]">
              The storefront that
              <br />
              improves itself
              <span className="mt-2 block bg-gradient-to-r from-[#9cc5ff] via-[#e8e6ff] to-[#f5a6cb] bg-clip-text pb-1 text-transparent">
                for humans and AI agents.
              </span>
            </h1>
            <p className="mt-6 max-w-[38rem] text-[1.05rem] leading-relaxed text-white/60 sm:text-[1.15rem]">
              Darwin watches how people <em className="text-white/80 not-italic">and</em> shopping agents move through your store, finds where
              they drop, changes the page, proves it with an A/B test and ships the winner as a pull request. Then it does it again.
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href="/console"
                className="group flex h-13 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[1rem] font-semibold text-[#0b1200] shadow-[0_0_0_1px_rgba(182,240,90,0.4),0_12px_40px_-10px_rgba(182,240,90,0.6)] transition-colors hover:bg-[#c8f77c]"
              >
                Open mission control
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/store"
                className="flex h-13 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-6 text-[1rem] font-medium text-white/90 transition-colors hover:border-white/25 hover:bg-white/[0.08]"
              >
                <Store className="size-4 text-white/60" />
                Visit the demo store
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.78rem] text-white/40">
              {FLOW.map((f, i) => (
                <span key={f} className="flex items-center gap-2">
                  {i > 0 && <span className="text-white/20">→</span>}
                  <span className={i === FLOW.length - 1 ? "flex items-center gap-1 text-brand/80" : ""}>
                    {i === FLOW.length - 1 && <GitPullRequest className="size-3.5" />}
                    {f}
                  </span>
                </span>
              ))}
              <span className="text-white/20">↺</span>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <LandingLoop />
          </div>
        </section>

        {/* value props */}
        <section className="grid shrink-0 gap-3 pb-6 md:grid-cols-3 lg:pb-8">
          {PROPS.map(({ icon: Icon, title, body, accent }) => (
            <div key={title} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 backdrop-blur-sm">
              <div className="flex items-center gap-2.5">
                <span className={`flex size-8 items-center justify-center rounded-lg bg-white/[0.05] ${accent}`}>
                  <Icon className="size-4" />
                </span>
                <h2 className="text-[1.02rem] font-semibold tracking-[-0.01em]">{title}</h2>
              </div>
              <p className="mt-2.5 text-[0.9rem] leading-relaxed text-white/55">{body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
