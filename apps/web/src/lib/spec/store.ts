/**
 * The live PageSpec and its history. One source of truth for "what the store looks like now".
 */
import type { PageSpec } from "@/lib/contracts";
import { kvGet, kvSet } from "@/lib/db/json-store";
import { DEFAULT_SPEC } from "./default-spec";

interface SpecState {
  live: PageSpec;
  /** Every spec ever promoted, oldest first (includes live). */
  history: PageSpec[];
}

const KEY = "spec";
const initial = (): SpecState => ({ live: DEFAULT_SPEC, history: [DEFAULT_SPEC] });

export function getLiveSpec(): PageSpec {
  return kvGet(KEY, initial).live;
}

export function getSpecHistory(): PageSpec[] {
  return kvGet(KEY, initial).history;
}

export function getSpecVersion(version: number): PageSpec | undefined {
  return getSpecHistory().find((s) => s.version === version);
}

/** Promote a spec to live. Assigns the next version number. */
export function promoteSpec(spec: PageSpec, label: string): PageSpec {
  const state = kvGet(KEY, initial);
  const next: PageSpec = { ...spec, version: state.live.version + 1, label };
  kvSet(KEY, { live: next, history: [...state.history, next] });
  return next;
}

/** Back to Gen 0. Used by the console "reset demo" button. */
export function resetSpec() {
  kvSet(KEY, initial());
}
