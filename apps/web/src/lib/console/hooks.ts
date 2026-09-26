"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import useSWR, { type KeyedMutator } from "swr";
import type { AnalyticsSummary, Experiment, LoopState } from "@/lib/contracts";
import type { ApiGroup, ConsoleApi } from "./api";
import { describeEvent, type FeedRow } from "./format";

/* ------------------------------------------------------------------ api context */

export const ApiContext = createContext<ConsoleApi | null>(null);

export function useApi(): ConsoleApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiContext missing");
  return api;
}

const NO_GROUPS: ApiGroup[] = [];

export function useMockedGroups(): ApiGroup[] {
  const api = useApi();
  return useSyncExternalStore(api.subscribe, api.mockedGroups, () => NO_GROUPS);
}

/* ------------------------------------------------------------------ clock */

let clockNow = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/** Current time, ticking once a second (0 during SSR). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow,
    () => 0,
  );
}

/* ------------------------------------------------------------------ polling */

const SWR_OPTS = { keepPreviousData: true, revalidateOnFocus: false, dedupingInterval: 250, errorRetryInterval: 3000 } as const;

export function useLoop(): { loop?: LoopState; error?: Error; mutate: KeyedMutator<LoopState> } {
  const api = useApi();
  const { data, error, mutate } = useSWR<LoopState>([api.mode, "loop"], () => api.getLoop(), {
    ...SWR_OPTS,
    refreshInterval: 1000,
  });
  return { loop: data, error, mutate };
}

export function useExperiments(): Experiment[] | undefined {
  const api = useApi();
  const { data } = useSWR([api.mode, "experiments"], () => api.getExperiments(), { ...SWR_OPTS, refreshInterval: 1500 });
  return data?.experiments;
}

export function useSummary(
  filter: { specVersion?: number } | null,
  refreshInterval = 2000,
): { summary?: AnalyticsSummary; error?: Error } {
  const api = useApi();
  const { data, error } = useSWR(
    filter ? [api.mode, "summary", filter.specVersion ?? "all"] : null,
    () => api.getSummary(filter ?? {}),
    { ...SWR_OPTS, refreshInterval },
  );
  return { summary: data, error };
}

export function useSessions(limit = 12) {
  const api = useApi();
  const { data } = useSWR([api.mode, "sessions", limit], () => api.getSessions(limit), { ...SWR_OPTS, refreshInterval: 3000 });
  return data?.sessions;
}

export function useGithubStatus() {
  const api = useApi();
  const { data, mutate, error } = useSWR([api.mode, "github"], () => api.getGithubStatus(), {
    ...SWR_OPTS,
    refreshInterval: 15000,
  });
  return { status: data, mutate, error };
}

/* ------------------------------------------------------------------ live feed */

const FEED_MAX = 60;
const QUEUE_MAX = 24;

/**
 * Polls /api/analytics/events with a cursor and reveals rows at a steady, readable pace.
 * When traffic outruns the display, low-signal rows (page views, OK tool calls) are dropped first.
 */
export function useEventFeed() {
  const api = useApi();
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [synthetic, setSynthetic] = useState(false);
  const [rate, setRate] = useState(0);
  const cursor = useRef<string | undefined>(undefined);
  /** Real (non-simulated) visitors are polled on their own cursor so they never drown in synthetic traffic. */
  const realCursor = useRef<string | undefined>(undefined);
  const queue = useRef<FeedRow[]>([]);
  const primed = useRef(false);
  const generation = useRef(0);

  const reset = useCallback(() => {
    generation.current += 1;
    cursor.current = undefined;
    realCursor.current = undefined;
    queue.current = [];
    primed.current = false;
    setRows([]);
    setRate(0);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPoll = Date.now();

    const poll = async () => {
      const gen = generation.current;
      try {
        const res = await api.getEvents(cursor.current, 100);
        if (!alive || gen !== generation.current) return;
        const now = Date.now();
        const dt = Math.max(0.5, (now - lastPoll) / 1000);
        lastPoll = now;
        if (res.events.length) {
          cursor.current = res.cursor ?? res.events.at(-1)?.uuid ?? cursor.current;
          if (res.events.some((e) => e.properties.synthetic)) setSynthetic(true);
          // Real visitors arrive through the dedicated poll below.
          const described = res.events
            .filter((e) => e.properties.synthetic)
            .map(describeEvent)
            .filter((r) => r.priority > 0);
          if (!primed.current) {
            // first load: show the most recent interesting rows immediately, no animation backlog
            primed.current = true;
            setRows(described.filter((r) => r.priority >= 2).slice(-14).reverse());
          } else {
            queue.current.push(...described);
            // throttle: drop lowest-priority, oldest rows first
            while (queue.current.length > QUEUE_MAX) {
              let victim = 0;
              for (let i = 1; i < queue.current.length; i++) {
                if (queue.current[i].priority < queue.current[victim].priority) victim = i;
              }
              queue.current.splice(victim, 1);
            }
            setRate((r) => r * 0.6 + (res.events.length / dt) * 0.4);
          }
        } else {
          primed.current = true;
          setRate((r) => (r < 0.2 ? 0 : r * 0.6));
        }
      } catch {
        /* keep polling */
      }
      try {
        const real = await api.getEvents(realCursor.current, 50, { realOnly: true });
        if (alive && gen === generation.current && real.events.length) {
          realCursor.current = real.cursor ?? real.events.at(-1)?.uuid ?? realCursor.current;
          const rows = real.events
            .map(describeEvent)
            .filter((r) => r.priority > 0)
            .map((r) => ({ ...r, priority: 3 as const }));
          // Newest first, straight to the top: a judge buying on their phone should see it land.
          if (rows.length) setRows((r) => [...rows.reverse(), ...r].slice(0, FEED_MAX));
        } else if (alive && gen === generation.current && real.cursor) {
          realCursor.current = real.cursor;
        }
      } catch {
        /* keep polling */
      }
      if (alive) timer = setTimeout(poll, 1000);
    };
    void poll();

    const drain = setInterval(() => {
      const next = queue.current.shift();
      if (next) setRows((r) => [next, ...r].slice(0, FEED_MAX));
    }, 230);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(drain);
    };
  }, [api]);

  return { rows, synthetic, rate, reset };
}

/* ------------------------------------------------------------------ drivers */

export const TRAFFIC_BATCH = { humans: 12, agents: 3, spreadMinutes: 0 } as const;

/** While on, POST /api/simulate every ~1.5s (never overlapping). */
export function useTrafficDriver(on: boolean, onError: (msg: string) => void) {
  const api = useApi();
  const errRef = useRef(onError);
  useEffect(() => {
    errRef.current = onError;
  }, [onError]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const tick = async () => {
      const started = Date.now();
      try {
        await api.simulate({ ...TRAFFIC_BATCH });
        failures = 0;
      } catch (e) {
        failures += 1;
        if (failures === 1) errRef.current(`Traffic: ${(e as Error).message}`);
      }
      if (alive) timer = setTimeout(tick, Math.max(250, 1500 - (Date.now() - started)) + Math.min(failures, 5) * 1000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [on, api]);
}

/** While autopilot is on, POST /api/loop/step every ~2.5s, waiting for each step to finish. */
export function useAutopilotDriver(on: boolean, step: () => Promise<unknown>) {
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      await stepRef.current();
      if (alive) timer = setTimeout(run, 2500);
    };
    timer = setTimeout(run, 1200);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [on]);
}

/* ------------------------------------------------------------------ hotkeys */

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("[data-modal-open]")) return;
      const key = e.key === " " ? "space" : e.key.toLowerCase();
      const fn = mapRef.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/* ------------------------------------------------------------------ misc */

/** Callback ref + observed content size. */
export function useMeasure<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.width - width) < 0.5 && Math.abs(s.height - height) < 0.5 ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

/** Keep the last N samples of a value (for sparklines). Samples when `value` or `key` changes. */
export function useSamples(value: number | undefined, max = 40, resetKey?: unknown) {
  const [samples, setSamples] = useState<number[]>([]);
  const [prevKey, setPrevKey] = useState(resetKey);
  const [prevValue, setPrevValue] = useState<number | undefined>(undefined);
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setSamples([]);
  }
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== undefined && Number.isFinite(value)) setSamples((s) => [...s, value].slice(-max));
  }
  return samples;
}
