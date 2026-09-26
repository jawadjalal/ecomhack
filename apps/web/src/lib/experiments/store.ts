/**
 * Experiment persistence. The optimizer owns experiment *logic* (stats, decisions);
 * this file only stores and retrieves experiments.
 */
import type { Experiment } from "@/lib/contracts";
import { kvGet, kvSet } from "@/lib/db/json-store";

const KEY = "experiments";
const initial = (): Experiment[] => [];

export function listExperiments(): Experiment[] {
  return kvGet(KEY, initial);
}

export function getExperiment(id: string): Experiment | undefined {
  return listExperiments().find((e) => e.id === id);
}

export function getRunningExperiment(): Experiment | undefined {
  return listExperiments().find((e) => e.status === "running");
}

export function saveExperiment(exp: Experiment): Experiment {
  const all = listExperiments();
  const idx = all.findIndex((e) => e.id === exp.id);
  kvSet(KEY, idx === -1 ? [...all, exp] : all.map((e, i) => (i === idx ? exp : e)));
  return exp;
}

export function resetExperiments() {
  kvSet(KEY, initial());
}
