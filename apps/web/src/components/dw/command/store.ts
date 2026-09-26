/**
 * The command runtime's state: every run (a plan being executed) and what the ⌘K sheet and the toast
 * show. A tiny external store (useSyncExternalStore) so the sheet, the toast, WebMCP and window.darwin
 * share one source of truth, and a run keeps going when the sheet closes or the page changes.
 */
import type { CommandResult, PlanSource, PlanStepView, RejectedStep } from "@/lib/commands";

export type StepStatus = "queued" | "confirm" | "running" | "done" | "failed" | "skipped";

export interface RunStep extends PlanStepView {
  status: StepStatus;
  /** The concrete question shown while status === "confirm". */
  confirmText?: string;
  result?: CommandResult;
}

export type RunStatus = "planning" | "running" | "waiting" | "done" | "failed" | "cancelled";

/** Who started it: the ⌘K sheet, a browser agent over WebMCP, or window.darwin. */
export type RunOrigin = "bar" | "webmcp" | "api";

export interface Run {
  id: string;
  origin: RunOrigin;
  /** What the merchant typed (bar) or the command name (webmcp / api). */
  text: string;
  say: string;
  source: PlanSource;
  status: RunStatus;
  steps: RunStep[];
  rejected?: RejectedStep[];
  startedAt: number;
  endedAt?: number;
}

export interface CommandState {
  open: boolean;
  /** The run the sheet shows. */
  runId?: string;
  /** The run the toast shows (sheet closed, or it navigated away). */
  toastId?: string;
  /** How the sheet last closed: "shrink" when a step navigated (it tucks away as the page changes). */
  exit: "fade" | "shrink";
  runs: Record<string, Run>;
}

type Listener = () => void;

export class CommandStore {
  private state: CommandState = { open: false, exit: "fade", runs: {} };
  private listeners = new Set<Listener>();

  get = (): CommandState => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  set(patch: Partial<CommandState> | ((s: CommandState) => Partial<CommandState>)) {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  run(id: string): Run | undefined {
    return this.state.runs[id];
  }

  putRun(run: Run) {
    // Keep the last 20 runs.
    const ids = Object.keys(this.state.runs);
    const runs = { ...this.state.runs, [run.id]: run };
    if (ids.length >= 20) delete runs[ids[0]];
    this.set({ runs });
  }

  patchRun(id: string, patch: Partial<Run>) {
    const r = this.state.runs[id];
    if (r) this.set({ runs: { ...this.state.runs, [id]: { ...r, ...patch } } });
  }

  patchStep(id: string, index: number, patch: Partial<RunStep>) {
    const r = this.state.runs[id];
    if (!r) return;
    const steps = r.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    this.set({ runs: { ...this.state.runs, [id]: { ...r, steps } } });
  }
}

let seq = 0;
export const runId = () => `run_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const isLive = (r: Run | undefined) => !!r && (r.status === "planning" || r.status === "running" || r.status === "waiting");
