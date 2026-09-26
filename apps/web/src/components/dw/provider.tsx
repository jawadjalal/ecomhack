/**
 * One provider for every Darwin app page (/console, /console/issues, …): the console API (live, or the
 * in-browser mock with ?mock=1), plus the drivers that must run once per tab — simulated traffic and
 * the autopilot stepping — so they keep going while you move between pages.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSWRConfig } from "swr";
import type { LoopState } from "@/lib/contracts";
import { createConsoleApi, type ConsoleApi } from "@/lib/console/api";
import { ApiContext, useAutopilotDriver, useLoop, useTrafficDriver } from "@/lib/console/hooks";

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

export function DarwinProvider({ children }: { children: ReactNode }) {
  const [mock] = useState(() => typeof window !== "undefined" && /[?&]mock=(1|true)\b/.test(window.location.search));
  const [api] = useState(() => createConsoleApi(mock ? "mock" : "auto"));
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

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const notify = useCallback((text: string, tone: Toast["tone"] = "bad") => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
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
      <div className="pointer-events-none fixed bottom-6 left-6 z-50 flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className={
                t.tone === "bad"
                  ? "rounded-2xl bg-dw-warn-bg px-4 py-3 text-[14px] text-dw-warn shadow-[0_10px_30px_-12px_rgba(20,20,19,0.3)]"
                  : "rounded-2xl bg-dw-ink px-4 py-3 text-[14px] text-white shadow-[0_10px_30px_-12px_rgba(20,20,19,0.3)]"
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
