/**
 * One provider for every Darwin app page (/console, /console/issues, …): the console API (live, or the
 * in-browser mock with ?mock=1), plus the drivers that must run once per tab — simulated traffic and
 * the autopilot stepping — so they keep going while you move between pages.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSWRConfig } from "swr";
import type { LoopState } from "@/lib/contracts";
import { createConsoleApi, type ConsoleApi } from "@/lib/console/api";
import { sampleEngine } from "@/lib/console/mock";
import { ApiContext, useAutopilotDriver, useLoop, useTrafficDriver } from "@/lib/console/hooks";
import { setLive } from "@/lib/console/live";

const TRAFFIC_KEY = "darwin.console.traffic";

export interface DarwinApp {
  api: ConsoleApi;
  mock: boolean;
  loop?: LoopState;
  loopError?: Error;
  /** Advance the loop one phase (never overlapping). */
  step: () => Promise<void>;
  stepping: boolean;
  autopilot: boolean;
  setAutopilot: (on: boolean) => Promise<void>;
  /** Simulated shoppers (labelled synthetic) arriving every few seconds. */
  trafficOn: boolean;
  setTrafficOn: (on: boolean) => void;
  reset: () => Promise<void>;
  notify: (text: string, tone?: "bad" | "info") => void;
}

const Ctx = createContext<DarwinApp | null>(null);

export function useDarwin(): DarwinApp {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDarwin() outside <DarwinProvider>");
  return v;
}

const SAMPLE_KEY = "darwin.console.sample";
const SAMPLE_EVENT = "darwin:sample";
const subscribeSample = (cb: () => void) => {
  window.addEventListener(SAMPLE_EVENT, cb);
  return () => window.removeEventListener(SAMPLE_EVENT, cb);
};
const readMock = () => {
  if (/[?&]mock=(1|true)\b/.test(window.location.search)) return true;
  if (/[?&]live=1\b/.test(window.location.search)) return false;
  try {
    return sessionStorage.getItem(SAMPLE_KEY) === "1";
  } catch {
    return false;
  }
};

/** Switch this tab to sample data (the live store has nothing to show yet). Labelled "(demo data)" in the header. */
function switchToSampleData() {
  try {
    sessionStorage.setItem(SAMPLE_KEY, "1");
  } catch {
    /* storage blocked: stays live */
    return;
  }
  window.dispatchEvent(new Event(SAMPLE_EVENT));
}

/** Nothing yet: no version shipped, no test, no issues, and Darwin isn't running. */
const isEmptyLoop = (l: LoopState) => l.generation === 0 && !l.experimentId && !l.insights?.length && !l.autopilot && (l.history?.length ?? 0) <= 1;

export function DarwinProvider({ children }: { children: ReactNode }) {
  // ?mock=1 (or a live store with nothing to show yet) runs the in-browser demo engine, a few versions in.
  // Read after hydration (server snapshot = live) so markup matches.
  const mock = useSyncExternalStore(subscribeSample, readMock, () => false);
  const api = useMemo(() => (mock ? createConsoleApi("mock", sampleEngine) : createConsoleApi("auto")), [mock]);
  return (
    <ApiContext.Provider value={api}>
      <Inner api={api} mock={mock}>
        {children}
      </Inner>
    </ApiContext.Provider>
  );
}

interface Toast {
  id: number;
  text: string;
  tone: "bad" | "info";
}

function Inner({ api, mock, children }: { api: ConsoleApi; mock: boolean; children: ReactNode }) {
  const { mutate: globalMutate } = useSWRConfig();
  const { loop, mutate: mutateLoop, error: loopError } = useLoop();
  // An empty live store (a fresh server, nothing run yet) shows sample data instead of blank pages; ?live=1 opts out.
  useEffect(() => {
    if (!mock && loop && isEmptyLoop(loop) && !/[?&]live=1\b/.test(window.location.search)) switchToSampleData();
  }, [mock, loop]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const notify = useCallback((text: string, tone: Toast["tone"] = "bad") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts([{ id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

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

  const [trafficOn, setTrafficOnState] = useState(false);
  useTrafficDriver(trafficOn, notify);
  useEffect(() => {
    let on = false;
    try {
      on = sessionStorage.getItem(TRAFFIC_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    if (!on) return;
    const t = setTimeout(() => setTrafficOnState(true), 0);
    return () => clearTimeout(t);
  }, []);
  const setTrafficOn = useCallback((on: boolean) => {
    setTrafficOnState(on);
    try {
      sessionStorage.setItem(TRAFFIC_KEY, on ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  }, []);

  const autopilot = loop?.autopilot ?? false;
  const setAutopilot = useCallback(
    async (on: boolean) => {
      try {
        const next = await api.setAutopilot(on);
        await mutateLoop(next, { revalidate: false });
        if (on) setTrafficOn(true);
        // Live while Darwin works, still while it rests.
        setLive(on);
      } catch (e) {
        notify(`Autopilot: ${(e as Error).message}`);
      }
    },
    [api, mutateLoop, notify, setTrafficOn],
  );
  useAutopilotDriver(autopilot, step);

  const reset = useCallback(async () => {
    setTrafficOn(false);
    try {
      if (autopilot) await api.setAutopilot(false);
      const next = await api.resetLoop();
      await mutateLoop(next, { revalidate: false });
      void globalMutate((key) => Array.isArray(key) && key[0] === api.mode && key[1] !== "loop");
      notify("Started over from the original store", "info");
    } catch (e) {
      notify(`Reset failed: ${(e as Error).message}`);
    }
  }, [api, autopilot, globalMutate, mutateLoop, notify, setTrafficOn]);

  const value: DarwinApp = { api, mock, loop, loopError, step, stepping, autopilot, setAutopilot, trafficOn, setTrafficOn, reset, notify };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-6 z-50 grid max-sm:right-4 max-sm:bottom-[calc(var(--dw-tabbar-h,calc(64px+env(safe-area-inset-bottom)))+104px)] max-sm:left-4 sm:max-w-[34rem]">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              role="status"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              className={
                t.tone === "bad"
                  ? "col-start-1 row-start-1 rounded-[18px] border border-dw-warn/25 bg-dw-warn-bg px-4 py-3 text-[14px] text-dw-warn"
                  : "col-start-1 row-start-1 rounded-[18px] bg-dw-ink px-4 py-3 text-[14px] text-white"
              }
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
