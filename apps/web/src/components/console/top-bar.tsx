"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Activity, Bot, Cpu, Ellipsis, FlaskRound, Gauge, LayoutDashboard, LoaderCircle, Maximize, Radar, RotateCcw, Search, Sparkles, StepForward, Store, WandSparkles } from "lucide-react";
import type { GithubStatusResponse } from "@/lib/contracts";
import type { ApiGroup } from "@/lib/console/api";
import { API_GROUP_ROUTES } from "@/lib/console/api";
import type { SourceBadge } from "@/lib/console/format";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/switch";
import { Kbd } from "@/components/ui/kbd";
import { DarwinWordmark, GithubMark } from "./brand";

const LINKS: { href: string; label: string; hint: string; icon: typeof Store; external?: boolean }[] = [
  { href: "/store", label: "Demo store", hint: "PACE, the shop being optimized", icon: Store, external: true },
  { href: "/console/personalize", label: "Personalize", hint: "Per traffic source, A/B tested", icon: WandSparkles },
  { href: "/console/traffic", label: "Traffic", hint: "Channel, query, campaign", icon: Radar },
  { href: "/console/dashboards", label: "Dashboards", hint: "From your tracking plan", icon: LayoutDashboard },
  { href: "/readiness", label: "Readiness", hint: "How easily agents can buy", icon: Gauge },
  { href: "/console/research", label: "Research", hint: "Competitors, with sources", icon: Search },
  { href: "/console/agents", label: "Store agent", hint: "Your Whop store's buyer agent", icon: Bot },
];

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
  const q = forcedMock ? "?mock=1" : "";
  const mockTitle = forcedMock
    ? "Mock mode (?mock=1): the whole loop runs in your browser with simulated data."
    : `Not built yet, served by the in-browser simulation:\n${mockedGroups.map((g) => API_GROUP_ROUTES[g].join(", ")).join("\n")}`;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3">
      <Link href="/" className="mr-1 flex items-center rounded-lg pr-2" title="Darwin home">
        <DarwinWordmark sub="mission control" />
      </Link>

      <span className="text-[0.8rem] text-white/40" title={specVersion !== undefined ? `Live spec v${specVersion}` : undefined}>
        Gen <span className="text-[1.05rem] font-semibold text-white tabular">{generation}</span>
      </span>

      <div className="flex-1" />

      <Toggle on={autopilot} onChange={onAutopilot} label="Autopilot" hint={<Kbd>A</Kbd>} title="Let Darwin run the loop on its own (A)" />
      <Button variant="primary" onClick={onStep} disabled={stepping || autopilot} className="h-10 min-w-[7.2rem]" title="Advance one phase (Space)">
        {stepping ? <LoaderCircle className="animate-spin" /> : <StepForward />}
        Step
        <Kbd className="border-black/20 bg-black/10 text-black/60">Space</Kbd>
      </Button>
      <ClassicMenu
        q={q}
        github={github}
        source={source}
        mockTitle={mockTitle}
        showMock={forcedMock || mockedGroups.length > 0}
        mockLabel={forcedMock ? "Mock mode" : `Simulated API · ${mockedGroups.length}`}
        synthetic={synthetic}
        trafficOn={trafficOn}
        onTraffic={onTraffic}
        eventsRate={eventsRate}
        onReset={onReset}
        onFullscreen={onFullscreen}
        onConnect={onConnect}
      />
    </header>
  );
}

function ClassicMenu(props: {
  q: string;
  github?: GithubStatusResponse;
  source?: SourceBadge;
  mockTitle: string;
  showMock: boolean;
  mockLabel: string;
  synthetic: boolean;
  trafficOn: boolean;
  onTraffic: (on: boolean) => void;
  eventsRate: number;
  onReset: () => void;
  onFullscreen: () => void;
  onConnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const { github, source } = props;
  const dry = github?.repo && ((github as { dryRun?: boolean }).dryRun ?? (!github.configured || github.valid === false));

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="md" onClick={() => setOpen((o) => !o)} title="More" aria-label="More tools" aria-expanded={open} className="w-10 px-0">
        <Ellipsis />
      </Button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-80 rounded-2xl border border-white/10 bg-[#12141c] p-2 text-[0.85rem] shadow-2xl">
          {LINKS.map((l) => {
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.external || !l.href.startsWith("/console") ? l.href : `${l.href}${props.q}`}
                target={l.external ? "_blank" : undefined}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-white/80 hover:bg-white/[0.06] hover:text-white [&_svg]:size-4"
              >
                <Icon className="text-white/45" />
                <span className="min-w-0">
                  <span className="block font-medium">{l.label}</span>
                  <span className="block text-[0.72rem] text-white/40">{l.hint}</span>
                </span>
              </Link>
            );
          })}

          <button type="button" onClick={() => { setOpen(false); props.onConnect(); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-white/80 hover:bg-white/[0.06] hover:text-white">
            <GithubMark className="size-4 text-white/70" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{github?.repo ?? "Connect repo"}</span>
              <span className="block text-[0.72rem] text-white/40">{dry ? "Pull requests are previews" : github?.repo ? "Connected repository" : "Open a ship-winner pull request"}</span>
            </span>
          </button>

          <div className="mx-2 my-1 border-t border-white/10" />

          <div className="flex items-center gap-2 px-3 py-1.5 text-[0.75rem] text-white/50">
            {source?.label === "Heuristic" ? <Cpu className="size-3.5" /> : <Sparkles className="size-3.5" />}
            <span>{source?.label ?? "LLM"}{source?.model ? ` · ${source.model}` : ""}</span>
          </div>
          {props.showMock && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-[0.75rem] text-[#ffd27a]" title={props.mockTitle}>
              <FlaskRound className="size-3.5" /> {props.mockLabel}
            </div>
          )}
          {props.synthetic && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-[0.75rem] text-[#f8cf7a]" title="Traffic is generated by Darwin's simulator (properties.synthetic = true).">
              <Bot className="size-3.5" /> Synthetic traffic
            </div>
          )}

          <div className="mx-2 my-1 border-t border-white/10" />

          <div className="px-2 py-1.5">
            <Toggle
              on={props.trafficOn}
              onChange={props.onTraffic}
              tone="human"
              icon={<Activity />}
              title="Simulated shoppers: 12 humans + 3 AI agents every 1.5s (T)"
              label={
                <span className="flex items-baseline gap-1.5">
                  Traffic
                  {props.trafficOn && props.eventsRate > 0 && <span className="font-mono text-[0.72rem] text-white/50 tabular">{Math.round(props.eventsRate)}/s</span>}
                </span>
              }
              hint={<Kbd>T</Kbd>}
            />
          </div>
          <div className="flex gap-2 px-2 pt-1 pb-1">
            <Button variant="ghost" size="md" onClick={() => { setOpen(false); props.onReset(); }} title="Reset to Gen 0 (R)" className="flex-1">
              <RotateCcw /> Reset
            </Button>
            <Button variant="ghost" size="md" onClick={() => { setOpen(false); props.onFullscreen(); }} title="Fullscreen (F)" className="flex-1">
              <Maximize /> Fullscreen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
