/**
 * Drives the in-browser demo engine (the same one `/console?mock=1` uses) for the landing page:
 * simulated shoppers arrive every couple of seconds and the loop steps on its own, so the miniature
 * dashboard shows real engine output, labelled "simulated". Nothing here touches the server.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentSessionSummary, AnalyticsSummary, Experiment, LoopPhase } from "@/lib/contracts";
import { createConsoleApi } from "@/lib/console/api";

export interface DemoSample {
  id: number;
  at: number;
  /** Visitors that arrived since the previous sample. */
  visitors: number;
  orders: number;
  /** Conversion over the last few samples (smoothed). */
  rate: number;
}

export interface LiveDemo {
  ready: boolean;
  phase: LoopPhase;
  generation: number;
  summary?: AnalyticsSummary;
  /** The running test, or the latest one. */
  experiment?: Experiment;
  sessions: AgentSessionSummary[];
  samples: DemoSample[];
}

const MAX_SAMPLES = 12;
const WINDOW = 3;

export function useLiveDemo({ slow = false }: { slow?: boolean } = {}): LiveDemo {
  const api = useMemo(() => createConsoleApi("mock"), []);
  const [demo, setDemo] = useState<LiveDemo>({ ready: false, phase: "idle", generation: 0, sessions: [], samples: [] });

  useEffect(() => {
    let alive = true;
    let busy = false;
    let tick = 0;
    // Seeded from the clock so sample keys stay unique if the effect re-runs (fast refresh) with samples already on screen.
    let seq = Date.now();
    let last: { visitors: number; orders: number } | undefined;
    const raw: { visitors: number; orders: number }[] = [];

    const read = async () => {
      const [loop, { experiments }, summary, { sessions }] = await Promise.all([api.getLoop(), api.getExperiments(), api.getSummary(), api.getSessions(12)]);
      if (!alive) return;
      const totals = { visitors: summary.overall.visitors, orders: summary.overall.orders };
      const sample = last && totals.visitors > last.visitors ? { visitors: totals.visitors - last.visitors, orders: totals.orders - last.orders } : undefined;
      last = totals;
      if (sample) {
        raw.push(sample);
        if (raw.length > MAX_SAMPLES + WINDOW) raw.shift();
      }
      const experiment = experiments.find((e) => e.status === "running") ?? experiments.at(-1);
      setDemo((d) => {
        let samples = d.samples;
        if (sample) {
          const w = raw.slice(-WINDOW);
          const v = w.reduce((n, s) => n + s.visitors, 0);
          const o = w.reduce((n, s) => n + s.orders, 0);
          seq += 1;
          samples = [...d.samples, { id: seq, at: Date.now(), visitors: sample.visitors, orders: sample.orders, rate: v ? o / v : 0 }].slice(-MAX_SAMPLES);
        }
        return { ready: true, phase: loop.phase, generation: loop.generation, summary, experiment, sessions, samples };
      });
    };

    const arrive = () => api.simulate({ humans: 36 + Math.floor(Math.random() * 30), agents: 8 + Math.floor(Math.random() * 8) });

    const step = async () => {
      if (busy || !alive || document.hidden) return;
      busy = true;
      try {
        await arrive();
        tick += 1;
        if (tick % 2 === 0) await api.stepLoop();
        await read();
      } catch {
        /* the demo engine never fails in practice; skip this beat if it does */
      } finally {
        busy = false;
      }
    };

    // Warm up: open the store (the first step brings a baseline of shoppers), then a few quick beats
    // so the chart starts with real points instead of an empty axis.
    const warm = async () => {
      busy = true;
      try {
        const loop = await api.getLoop();
        if (loop.phase === "idle") await api.stepLoop();
        await read();
        for (let i = 0; i < 6 && alive; i++) {
          await arrive();
          await read();
        }
      } finally {
        busy = false;
      }
    };
    void warm();
    const t = setInterval(step, slow ? 4000 : 1900);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api, slow]);

  return demo;
}
