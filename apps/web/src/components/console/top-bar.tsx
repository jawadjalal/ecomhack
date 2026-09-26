"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Bot, Cpu, FlaskRound, Gauge, LayoutDashboard, LoaderCircle, Maximize, Radar, RotateCcw, Search, Sparkles, StepForward, Store, WandSparkles } from "lucide-react";
import type { GithubStatusResponse } from "@/lib/contracts";
import type { ApiGroup } from "@/lib/console/api";
import { API_GROUP_ROUTES } from "@/lib/console/api";
import type { SourceBadge } from "@/lib/console/format";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/switch";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/components/ui/cn";
import { DarwinWordmark, GithubMark } from "./brand";

function Chip({
  children,
  className,
  title,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] font-medium whitespace-nowrap text-white/75 [&_svg]:size-[0.95rem]",
        onClick && "transition-colors hover:border-white/20 hover:bg-white/[0.07] hover:text-white",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function TopBar({
  github,
  source,
  mockedGroups,
  forcedMock,
  synthetic,
  trafficOn,
  onTraffic,
  eventsRate,
  autopilot,
  onAutopilot,
  onStep,
  stepping,
  onReset,
  onFullscreen,
  onConnect,
  generation,
  specVersion,
}: {
  github?: GithubStatusResponse;
  source?: SourceBadge;
  mockedGroups: ApiGroup[];
  forcedMock: boolean;
  synthetic: boolean;
  trafficOn: boolean;
  onTraffic: (on: boolean) => void;
  eventsRate: number;
  autopilot: boolean;
  onAutopilot: (on: boolean) => void;
  onStep: () => void;
  stepping: boolean;
  onReset: () => void;
  onFullscreen: () => void;
  onConnect: () => void;
  generation: number;
  specVersion?: number;
}) {
  const mockTitle = forcedMock
    ? "Mock mode (?mock=1): the whole loop runs in your browser with simulated data."
    : `Not built yet, served by the in-browser simulation:\n${mockedGroups.map((g) => API_GROUP_ROUTES[g].join(", ")).join("\n")}`;

  return (
    <header className="flex min-h-[3.6rem] shrink-0 flex-wrap items-center gap-x-3 gap-y-2 xl:h-[3.6rem] xl:flex-nowrap">
      <Link href="/" className="mr-1 flex items-center rounded-lg pr-2" title="Darwin home">
        <DarwinWordmark sub="mission control" />
      </Link>
      <div className="hidden h-7 w-px bg-white/10 xl:block" />

      {/* Below xl the chips get a row of their own that scrolls sideways inside itself, never the page. */}
      <div className="order-last flex w-full min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:none] xl:order-none xl:w-auto xl:flex-1 [&::-webkit-scrollbar]:hidden">
        <Chip title="The demo store Darwin is optimizing">
          <Store className="text-white/50" />
          <span className="text-white/85">PACE</span>
          <Link href="/store" target="_blank" className="text-white/40 underline-offset-2 hover:text-white hover:underline">
            /store
          </Link>
        </Chip>

        <Link
          href="/console/personalize"
          title="Personalize any store with darwin.js: per traffic source and search query, A/B tested"
          className="flex h-9 items-center gap-2 rounded-xl border border-brand/25 bg-brand/[0.07] px-3 text-[0.82rem] font-medium whitespace-nowrap text-brand transition-colors hover:bg-brand/[0.14] [&_svg]:size-[0.95rem]"
        >
          <WandSparkles />
          Personalize
        </Link>

        <Link
          href="/console/traffic"
          title="Where visitors came from: channel, referring site, search query, campaign, country. Humans and AI agents."
          className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] font-medium whitespace-nowrap text-white/80 transition-colors hover:bg-white/[0.08] [&_svg]:size-[0.95rem]"
        >
          <Radar />
          Traffic
        </Link>

        <Link
          href="/console/dashboards"
          title="The dashboards Darwin built from your tracking plan (set one up in /onboarding)"
          className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] font-medium whitespace-nowrap text-white/80 transition-colors hover:bg-white/[0.08] [&_svg]:size-[0.95rem]"
        >
          <LayoutDashboard />
          Dashboards
        </Link>

        <Link
          href="/readiness"
          title="Audit any store URL: how easily can AI shopping agents find, understand and buy from it?"
          className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] font-medium whitespace-nowrap text-white/80 transition-colors hover:bg-white/[0.08] [&_svg]:size-[0.95rem]"
        >
          <Gauge />
          Readiness
        </Link>

        <Link
          href="/console/research"
          title="Market & competitor research with sources, turned into A/B test ideas"
          className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] font-medium whitespace-nowrap text-white/80 transition-colors hover:bg-white/[0.08] [&_svg]:size-[0.95rem]"
        >
          <Search />
          Research
        </Link>

        <Link
          href="/console/agents"
          title="Your Whop store's own AI agent: buyer agents shop it over A2A and pay through tagged checkout links"
          className="flex h-9 items-center gap-2 rounded-xl border border-agent/30 bg-agent/[0.08] px-3 text-[0.82rem] font-medium whitespace-nowrap text-[#f5a6cb] transition-colors hover:bg-agent/[0.14] [&_svg]:size-[0.95rem]"
        >
          <Bot />
          Store agent
        </Link>

        <Chip onClick={onConnect} title={github?.repo ? (github.error ? `${github.repo}: ${github.error}, so pull requests are previews` : "Connected repository (click for details)") : "Connect a GitHub repo"}>
          <GithubMark className="text-white/70" />
          {github?.repo ? (
            <>
              <span className="max-w-[14rem] truncate text-white/85">{github.repo}</span>
              {((github as { dryRun?: boolean }).dryRun ?? (!github.configured || github.valid === false)) && (
                <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[0.65rem] tracking-wide text-white/50 uppercase">
                  {github.configured && (github as { mode?: string }).mode === "offline" ? "token rejected" : "dry run"}
                </span>
              )}
            </>
          ) : (
            <span className="text-brand">Connect repo</span>
          )}
        </Chip>

        <Chip title={source?.model ? `Proposals written by ${source.model}` : "Proposals will show which model (or heuristic) wrote them"}>
          {source?.label === "Heuristic" ? <Cpu className="text-white/50" /> : <Sparkles className="text-brand" />}
          <span className={cn(source ? "text-white/85" : "text-white/40")}>{source?.label ?? "LLM"}</span>
          {source?.model && <span className="hidden max-w-[9rem] truncate font-mono text-[0.7rem] text-white/35 2xl:inline">{source.model}</span>}
        </Chip>

        <AnimatePresence>
          {(forcedMock || mockedGroups.length > 0) && (
            <motion.div key="mock" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <Chip className="border-warn/30 bg-warn/[0.08] text-[#ffd27a]" title={mockTitle}>
                <FlaskRound />
                {forcedMock ? "Mock mode" : `Simulated API · ${mockedGroups.length}`}
              </Chip>
            </motion.div>
          )}
          {synthetic && (
            <motion.div key="synthetic" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <Chip
                className="border-warn/25 bg-transparent text-[#f8cf7a]"
                title="Traffic is generated by Darwin's simulator (properties.synthetic = true). Every synthetic event is labelled."
              >
                <Bot />
                Synthetic traffic
              </Chip>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 xl:hidden" />

      <div className="flex items-baseline gap-2 pr-2" title={specVersion !== undefined ? `Live spec v${specVersion}` : undefined}>
        <span className="text-[0.7rem] font-medium tracking-[0.2em] text-white/40 uppercase">Gen</span>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={generation}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            className="text-[1.6rem] leading-none font-semibold text-white tabular"
          >
            {generation}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Toggle
          on={trafficOn}
          onChange={onTraffic}
          tone="human"
          icon={<Activity />}
          title="Simulated shoppers: 12 humans + 3 AI agents every 1.5s (T)"
          label={
            <span className="flex items-baseline gap-1.5">
              Traffic
              {trafficOn && eventsRate > 0 && <span className="font-mono text-[0.72rem] text-white/50 tabular">{Math.round(eventsRate)}/s</span>}
            </span>
          }
          hint={<Kbd>T</Kbd>}
        />
        <Toggle on={autopilot} onChange={onAutopilot} label="Autopilot" hint={<Kbd>A</Kbd>} title="Let Darwin run the loop on its own (A)" />
        <Button variant="primary" onClick={onStep} disabled={stepping || autopilot} className="h-10 min-w-[7.2rem]" title="Advance one phase (Space)">
          {stepping ? <LoaderCircle className="animate-spin" /> : <StepForward />}
          Step
          <Kbd className="border-black/20 bg-black/10 text-black/60">Space</Kbd>
        </Button>
        <Button variant="ghost" size="md" onClick={onReset} title="Reset to Gen 0 (R)" className="w-10 px-0">
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="md" onClick={onFullscreen} title="Fullscreen (F)" className="w-10 px-0">
          <Maximize />
        </Button>
      </div>
    </header>
  );
}
