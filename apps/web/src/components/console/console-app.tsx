"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSWRConfig } from "swr";
import { TriangleAlert, X } from "lucide-react";
import type { LoopPhase } from "@/lib/contracts";
import { createConsoleApi } from "@/lib/console/api";
import { prsByGeneration, sourceBadge, withStatusPrs, type PrInfo } from "@/lib/console/format";
import {
  ApiContext,
  useApi,
  useAutopilotDriver,
  useEventFeed,
  useExperiments,
  useGithubStatus,
  useHotkeys,
  useLoop,
  useMockedGroups,
  useSessions,
  useSummary,
  useTrafficDriver,
} from "@/lib/console/hooks";
import { Panel } from "@/components/ui/panel";
import { TopBar } from "./top-bar";
import { LoopRing } from "./loop-ring";
import { KpiTiles } from "./kpi-tiles";
import { StagePanel } from "./stage/stage-panel";
import { EvolutionChart } from "./evolution-chart";
import { LiveFeed } from "./live-feed";
import { ActivityLog } from "./activity-log";
import { AgentPanel } from "./agent-panel";
import { ConfirmResetModal, ConnectRepoModal, PrModal } from "./modals";

const FIRST_RUN_KEY = "darwin.console.connect-dismissed";
const TRAFFIC_KEY = "darwin.console.traffic";

interface Toast {
  id: number;
  text: string;
  tone: "bad" | "info";
}

export function ConsoleApp({ mock }: { mock: boolean }) {
  const [api] = useState(() => createConsoleApi(mock ? "mock" : "auto"));
  return (
    <ApiContext.Provider value={api}>
      <Console mock={mock} />
    </ApiContext.Provider>
  );
}

function Console({ mock }: { mock: boolean }) {
  const api = useApi();
  const { mutate: globalMutate } = useSWRConfig();
  const mocked = useMockedGroups();
  const { loop, mutate: mutateLoop, error: loopError } = useLoop();
  const experiments = useExperiments();
  const specVersion = loop?.liveSpec.version;
  const { summary: summaryAll } = useSummary({}, 2000);
  const { summary: summaryGen } = useSummary(specVersion !== undefined ? { specVersion } : null, 2000);
  const gen0Version = loop?.history[0]?.specVersion;
  const { summary: summaryGen0 } = useSummary(
    gen0Version !== undefined && (loop?.generation ?? 0) > 0 ? { specVersion: gen0Version } : null,
    6000,
  );
  const feed = useEventFeed();
  const sessions = useSessions(12);
  const { status: github, mutate: mutateGithub } = useGithubStatus();

  /* toasts */
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const notify = useCallback((text: string, tone: Toast["tone"] = "bad") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  /* step (never overlapping) */
  const inFlight = useRef(false);
  const [stepping, setStepping] = useState(false);
  const step = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStepping(true);
    try {
      const next = await api.stepLoop();
      await mutateLoop(next, { revalidate: false });
      void globalMutate((key) => Array.isArray(key) && key[1] === "experiments");
    } catch (e) {
      notify(`Step failed: ${(e as Error).message}`);
    } finally {
      inFlight.current = false;
      setStepping(false);
    }
  }, [api, mutateLoop, globalMutate, notify]);

  /* traffic (remembered for this tab, so a reload mid-demo keeps shoppers coming) */
  const [trafficOn, setTrafficOn] = useState(false);
  useTrafficDriver(trafficOn, notify);
  useEffect(() => {
    let on = false;
    try {
      on = sessionStorage.getItem(TRAFFIC_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    if (!on) return;
    const t = setTimeout(() => setTrafficOn(true), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(TRAFFIC_KEY, trafficOn ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  }, [trafficOn]);

  /* autopilot (server state is the source of truth; this tab drives the steps) */
  const autopilot = loop?.autopilot ?? false;
  const setAutopilot = useCallback(
    async (on: boolean) => {
      try {
        const next = await api.setAutopilot(on);
        await mutateLoop(next, { revalidate: false });
        if (on) setTrafficOn(true);
      } catch (e) {
        notify(`Autopilot: ${(e as Error).message}`);
      }
    },
    [api, mutateLoop, notify],
  );
  useAutopilotDriver(autopilot, step);

  /* peek at a phase (resets when the live phase moves on) */
  const livePhase: LoopPhase = loop?.phase ?? "idle";
  const [peek, setPeek] = useState<{ phase: LoopPhase; at: LoopPhase } | null>(null);
  const viewPhase = peek && peek.at === livePhase ? peek.phase : livePhase;

  /* modals */
  const [connectOpen, setConnectOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [prModal, setPrModal] = useState<PrInfo | undefined>(undefined);
  const firstRunChecked = useRef(false);
  useEffect(() => {
    if (!github || firstRunChecked.current) return;
    firstRunChecked.current = true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(FIRST_RUN_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    if (!github.repo && !dismissed) {
      const t = setTimeout(() => setConnectOpen(true), 700);
      return () => clearTimeout(t);
    }
  }, [github]);
  const closeConnect = useCallback(() => {
    setConnectOpen(false);
    try {
      localStorage.setItem(FIRST_RUN_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  /* reset */
  const doReset = useCallback(async () => {
    setResetOpen(false);
    setTrafficOn(false);
    try {
      if (autopilot) await api.setAutopilot(false);
      const next = await api.resetLoop();
      await mutateLoop(next, { revalidate: false });
      feed.reset();
      void globalMutate((key) => Array.isArray(key) && key[0] === api.mode && key[1] !== "loop");
      setPeek(null);
      notify("Reset to Gen 0", "info");
    } catch (e) {
      notify(`Reset failed: ${(e as Error).message}`);
    }
  }, [api, autopilot, feed, globalMutate, mutateLoop, notify]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  useHotkeys({
    space: () => (autopilot ? notify("Autopilot is driving. Press A to take the wheel.", "info") : void step()),
    a: () => void setAutopilot(!autopilot),
    t: () => setTrafficOn((on) => !on),
    r: () => setResetOpen(true),
    f: toggleFullscreen,
    escape: () => setPeek(null),
  });

  /* derived */
  const experiment =
    (loop?.experimentId && experiments?.find((e) => e.id === loop.experimentId)) ||
    (["experiment", "decide", "ship"].includes(livePhase) ? experiments?.at(-1) : undefined) ||
    undefined;
  const prs = withStatusPrs(prsByGeneration(loop), github, loop?.history ?? []);
  const pr = loop ? prs.get(loop.generation) : undefined;
  const [lastSource, setLastSource] = useState<string | undefined>(undefined);
  const curSource = loop?.proposal?.source;
  if (curSource && curSource !== lastSource) setLastSource(curSource);

  const openPrForGeneration = (generation: number) => {
    const p = prs.get(generation);
    if (p) setPrModal(p);
    else notify(`No PR details recorded for Gen ${generation}`, "info");
  };

  return (
    <div data-console-root data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white xl:h-screen xl:overflow-hidden">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative flex h-full flex-col gap-4 p-4">
        <TopBar
          github={github}
          source={sourceBadge(curSource ?? lastSource)}
          mockedGroups={mocked}
          forcedMock={mock}
          synthetic={feed.synthetic}
          trafficOn={trafficOn}
          onTraffic={setTrafficOn}
          eventsRate={feed.rate}
          autopilot={autopilot}
          onAutopilot={(on) => void setAutopilot(on)}
          onStep={() => void step()}
          stepping={stepping}
          onReset={() => setResetOpen(true)}
          onFullscreen={toggleFullscreen}
          onConnect={() => setConnectOpen(true)}
          generation={loop?.generation ?? 0}
          specVersion={specVersion}
        />

        <AnimatePresence>
          {loopError && !loop && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad/[0.08] px-4 py-2 text-[0.85rem] text-[#ffb4b4]"
            >
              <TriangleAlert className="size-4" /> Loop API error: {loopError.message}. Open <code className="font-mono">/console?mock=1</code> for the in-browser loop.
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[26.5rem_minmax(0,1fr)_27rem]">
          {/* left: loop ring + activity */}
          <div className="flex min-h-0 flex-col gap-4">
            <Panel className="shrink-0 items-center justify-center px-4 pt-3 pb-6">
              <LoopRing
                phase={livePhase}
                generation={loop?.generation ?? 0}
                autopilot={autopilot}
                pending={stepping}
                viewPhase={viewPhase}
                onSelectPhase={(p) => setPeek(p === livePhase ? null : { phase: p, at: livePhase })}
                className="max-w-[24.5rem]"
              />
            </Panel>
            <div className="h-[28rem] min-h-0 xl:h-auto xl:flex-1">
              <ActivityLog log={loop?.log ?? []} />
            </div>
          </div>

          {/* centre: KPIs, stage, evolution */}
          <div className="flex min-h-0 flex-col gap-4">
            <div className="h-[7.6rem] shrink-0">
              <KpiTiles loop={loop} summaryAll={summaryAll} summaryGen={summaryGen} summaryGen0={summaryGen0} />
            </div>
            <div className="h-[34rem] min-h-0 xl:h-auto xl:flex-1">
              <StagePanel
                loop={loop}
                viewPhase={viewPhase}
                onBackToLive={() => setPeek(null)}
                summaryGen={summaryGen}
                experiment={experiment}
                pr={pr}
                pending={stepping}
                mock={mock || mocked.includes("optimizer")}
                repo={github?.repo}
                trafficOn={trafficOn}
                hasEvents={feed.rows.length > 0}
                onConnect={() => setConnectOpen(true)}
                onOpenPr={() => setPrModal(pr)}
              />
            </div>
            <div className="h-[18.5rem] shrink-0">
              <EvolutionChart history={loop?.history ?? []} experiment={experiment} prs={prs} onOpenPr={openPrForGeneration} />
            </div>
          </div>

          {/* right: live feed + agents */}
          <div className="flex min-h-0 flex-col gap-4">
            <div className="h-[26rem] min-h-0 xl:h-auto xl:flex-1">
              <LiveFeed rows={feed.rows} rate={feed.rate} trafficOn={trafficOn} />
            </div>
            <div className="h-[29rem] shrink-0">
              <AgentPanel sessions={sessions} />
            </div>
          </div>
        </div>
      </div>

      {/* toasts */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              className={
                t.tone === "bad"
                  ? "pointer-events-auto flex items-center gap-2 rounded-xl border border-bad/30 bg-[#1a0d0f]/95 px-4 py-2.5 text-[0.88rem] text-[#ffc2c2] shadow-2xl"
                  : "pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#11141b]/95 px-4 py-2.5 text-[0.88rem] text-white/80 shadow-2xl"
              }
            >
              {t.tone === "bad" && <TriangleAlert className="size-4" />}
              {t.text}
              <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="ml-1 text-white/40 hover:text-white">
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <ConnectRepoModal
        open={connectOpen}
        onClose={closeConnect}
        status={github}
        onConnected={() => {
          void mutateGithub();
          void mutateLoop();
        }}
      />
      <ConfirmResetModal open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={() => void doReset()} />
      <PrModal pr={prModal} onClose={() => setPrModal(undefined)} />
    </div>
  );
}
