"use client";

/**
 * The command runtime: plans (POST /api/command, heuristic fallback), runs steps in order with live
 * status, asks the merchant before confirm-risk steps, and exposes the same commands to
 * - the ⌘K sheet (./command-bar.tsx),
 * - browser agents over WebMCP (navigator.modelContext, lib/commands/webmcp.ts),
 * - automation: window.darwin = { commands, manifest(), run(name, input), plan(text), do(text), open() }.
 *
 * Confirm-risk commands always stop for a human, whoever asked: the sheet opens on the prompt.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import {
  COMMAND_NAMES,
  manifest,
  parseCommand,
  validateStep,
  viewStep,
  type CommandPlanResponse,
  type CommandResult,
  type CommandSites,
  type PlanStep,
} from "@/lib/commands";
import { confirmText, runCommand, type CommandContext } from "@/lib/commands/run";
import { hasWebMcp, registerWebMcp } from "@/lib/commands/webmcp";
import { useDarwin } from "../provider";
import { withMock } from "./run-view";
import { CommandStore, isLive, runId, type CommandState, type Run, type RunOrigin } from "./store";

const RECENT_KEY = "darwin.cmdk.recent.v1";

export interface CommandRuntime {
  store: CommandStore;
  open(opts?: { runId?: string }): void;
  close(): void;
  toggle(): void;
  /** Plan natural language and run it. */
  submit(text: string, origin?: RunOrigin): Promise<CommandResult[]>;
  /** Run already-known steps (a suggestion). */
  runSteps(steps: PlanStep[], text: string, origin?: RunOrigin): Promise<CommandResult[]>;
  /** One command by name or alias (WebMCP, window.darwin). */
  runOne(name: string, input: unknown, origin: RunOrigin, interact?: <T>(fn: () => Promise<T>) => Promise<T>): Promise<CommandResult>;
  approve(runId: string, index: number, ok: boolean): void;
  dismissToast(): void;
  sites(): Promise<CommandSites>;
  recent(): string[];
}

const Ctx = createContext<CommandRuntime | null>(null);

/** The runtime, or null outside <CommandRuntimeProvider> (callers render nothing then). */
export function useCommandRuntime(): CommandRuntime | null {
  return useContext(Ctx);
}

export function useCommandState(): CommandState | undefined {
  const rt = useContext(Ctx);
  const noop = useCallback(() => () => {}, []);
  return useSyncExternalStore(rt?.store.subscribe ?? noop, () => rt?.store.get(), () => rt?.store.get());
}

const noopSub = () => () => {};
/** Whether this browser exposes WebMCP (navigator.modelContext). */
export function useWebMcpAvailable(): boolean {
  return useSyncExternalStore(noopSub, hasWebMcp, () => false);
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function remember(text: string) {
  try {
    const next = [text, ...readRecent().filter((t) => t.toLowerCase() !== text.toLowerCase())].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}

/** Wait for an element, bring it into view and pulse an ink ring around it. */
function highlight(selector: string, { timeoutMs = 8000 }: { timeoutMs?: number } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      let el: HTMLElement | null = null;
      try {
        el = document.querySelector<HTMLElement>(selector);
      } catch {
        return resolve(false);
      }
      if (el) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        if (!reduce && typeof el.animate === "function") {
          el.animate(
            [
              { boxShadow: "0 0 0 0 rgba(20,20,19,0)" },
              { boxShadow: "0 0 0 4px #141413", offset: 0.12 },
              { boxShadow: "0 0 0 4px #141413", offset: 0.7 },
              { boxShadow: "0 0 0 16px rgba(20,20,19,0)" },
            ],
            { duration: 2400, easing: "cubic-bezier(0.2,0.8,0.2,1)" },
          );
        }
        return resolve(true);
      }
      if (Date.now() - started > timeoutMs) return resolve(false);
      setTimeout(tick, 120);
    };
    tick();
  });
}

export function CommandRuntimeProvider({ children }: { children: ReactNode }) {
  const { api, mock, setAutopilot } = useDarwin();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const store = useMemo(() => new CommandStore(), []);
  const approvals = useRef(new Map<string, (ok: boolean) => void>());
  /** The run whose step is executing (a navigate step tucks the sheet away and shows its toast). */
  const active = useRef<string | undefined>(undefined);
  const sitesCache = useRef<{ at: number; value: Promise<CommandSites> } | undefined>(undefined);
  /** Where focus was before the sheet opened. */
  const lastFocus = useRef<HTMLElement | null>(null);

  const sites = useCallback((): Promise<CommandSites> => {
    const c = sitesCache.current;
    if (c && Date.now() - c.at < 20_000) return c.value;
    const value = fetch("/api/command", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { context?: { sites?: CommandSites } }) => j.context?.sites ?? { tracking: [], web: [] })
      .catch(() => ({ tracking: [], web: [] }) as CommandSites);
    sitesCache.current = { at: Date.now(), value };
    return value;
  }, []);

  const ctx = useMemo<CommandContext>(
    () => ({
      api,
      mock,
      location: () => ({ pathname: window.location.pathname, search: window.location.search }),
      navigate: (href) => {
        const s = store.get();
        const id = active.current;
        // The sheet tucks away (shrinks into the toast) while the page changes underneath.
        if (s.open && id && s.runId === id) store.set({ open: false, exit: "shrink", toastId: id });
        else if (id && store.run(id)?.origin !== "bar") store.set({ toastId: id });
        router.push(withMock(href, mock));
      },
      highlight,
      setAutopilot,
      refresh: () => {
        void mutate((key) => Array.isArray(key) && key[0] === api.mode);
      },
      sites,
    }),
    [api, mock, router, setAutopilot, mutate, sites, store],
  );
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  const open = useCallback(
    (opts: { runId?: string } = {}) => {
      if (!store.get().open && typeof document !== "undefined") lastFocus.current = document.activeElement as HTMLElement | null;
      store.set((s) => ({ open: true, exit: "fade", runId: opts.runId ?? s.runId, toastId: opts.runId && s.toastId === opts.runId ? undefined : s.toastId }));
    },
    [store],
  );

  const close = useCallback(() => {
    const s = store.get();
    if (!s.open) return;
    // A run still going (or waiting) keeps reporting in the toast.
    const r = s.runId ? store.run(s.runId) : undefined;
    const toastId = r && isLive(r) && r.status !== "waiting" ? r.id : s.toastId;
    // Closing on a confirm prompt means "no".
    if (r?.status === "waiting") {
      r.steps.forEach((st, i) => st.status === "confirm" && approvals.current.get(`${r.id}:${i}`)?.(false));
    }
    store.set({ open: false, exit: "fade", toastId });
    const back = lastFocus.current;
    lastFocus.current = null;
    if (back && typeof back.focus === "function" && document.contains(back)) requestAnimationFrame(() => back.focus({ preventScroll: true }));
  }, [store]);

  const toggle = useCallback(() => (store.get().open ? close() : open()), [store, open, close]);

  const approve = useCallback((id: string, index: number, ok: boolean) => {
    const key = `${id}:${index}`;
    const resolve = approvals.current.get(key);
    approvals.current.delete(key);
    resolve?.(ok);
  }, []);

  const execute = useCallback(
    async (id: string): Promise<CommandResult[]> => {
      const results: CommandResult[] = [];
      const first = store.run(id);
      if (!first) return results;
      store.patchRun(id, { status: "running" });
      const finish = (status: Run["status"], from: number) => {
        const r = store.run(id);
        if (r) {
          const steps = r.steps.map((s, i) => (i >= from && (s.status === "queued" || s.status === "confirm") ? { ...s, status: "skipped" as const } : s));
          store.patchRun(id, { status, steps, endedAt: Date.now() });
        }
        if (active.current === id) active.current = undefined;
      };
      for (let i = 0; i < first.steps.length; i++) {
        const step = store.run(id)?.steps[i];
        if (!step) break;
        active.current = id;
        if (step.risk === "confirm") {
          store.patchStep(id, i, { status: "confirm", confirmText: `${step.label}?` });
          store.patchRun(id, { status: "waiting" });
          // A human must see the prompt, whoever asked: open the sheet on this run.
          const s = store.get();
          if (!s.open || s.runId !== id) {
            if (!s.open && typeof document !== "undefined") lastFocus.current = document.activeElement as HTMLElement | null;
            store.set({ open: true, exit: "fade", runId: id, toastId: s.toastId === id ? undefined : s.toastId });
          }
          void confirmText(step.command, step.input, ctxRef.current).then((t) => {
            if (store.run(id)?.steps[i]?.status === "confirm") store.patchStep(id, i, { confirmText: t });
          });
          const ok = await new Promise<boolean>((resolve) => approvals.current.set(`${id}:${i}`, resolve));
          if (!ok) {
            store.patchStep(id, i, { status: "skipped", result: { ok: false, text: "Cancelled. Nothing changed." } });
            finish("cancelled", i + 1);
            results.push({ ok: false, text: "The merchant cancelled it. Nothing changed." });
            return results;
          }
          store.patchRun(id, { status: "running" });
        }
        store.patchStep(id, i, { status: "running" });
        const result = await runCommand(step.command, step.input, ctxRef.current);
        results.push(result);
        store.patchStep(id, i, { status: result.ok ? "done" : "failed", result });
        if (!result.ok) {
          finish("failed", i + 1);
          return results;
        }
      }
      finish("done", first.steps.length);
      return results;
    },
    [store],
  );

  const start = useCallback(
    (origin: RunOrigin, text: string): string => {
      const id = runId();
      store.putRun({ id, origin, text, say: "", source: "heuristic", status: "planning", steps: [], startedAt: Date.now() });
      if (origin === "bar") store.set({ runId: id });
      else store.set({ toastId: id });
      return id;
    },
    [store],
  );

  const load = useCallback(
    (id: string, plan: Pick<CommandPlanResponse, "say" | "source" | "rejected"> & { steps: PlanStep[] }) => {
      // Validate again here and take risk from the local registry: the server's word isn't enough to skip a confirm.
      const steps = plan.steps.flatMap((s) => {
        const v = validateStep(s.command, s.input);
        return v.ok ? [{ ...viewStep(v.step), status: "queued" as const }] : [];
      });
      store.patchRun(id, { say: plan.say, source: plan.source, rejected: plan.rejected, steps });
      return steps.length;
    },
    [store],
  );

  const submit = useCallback(
    async (text: string, origin: RunOrigin = "bar"): Promise<CommandResult[]> => {
      const words = text.trim().slice(0, 500);
      if (!words) return [];
      if (origin === "bar") remember(words);
      const id = start(origin, words);
      const page = `${window.location.pathname}${window.location.search}`;
      let plan: CommandPlanResponse;
      try {
        const res = await fetch("/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: words, page }), cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        plan = (await res.json()) as CommandPlanResponse;
      } catch {
        // Offline / gated: the same deterministic parser, in the browser.
        const local = parseCommand(words, { page, sites: await sites() });
        plan = { steps: local.steps.map(viewStep), say: local.say, source: "heuristic" };
      }
      if (!load(id, plan)) {
        store.patchRun(id, { status: "failed", endedAt: Date.now(), say: "I couldn't turn that into a command. Try “send 200 shoppers”, “go to issues” or ask a question." });
        return [];
      }
      return execute(id);
    },
    [start, load, execute, sites, store],
  );

  const runSteps = useCallback(
    async (steps: PlanStep[], text: string, origin: RunOrigin = "bar"): Promise<CommandResult[]> => {
      const id = start(origin, text);
      const views = steps.flatMap((s) => {
        const v = validateStep(s.command, s.input);
        return v.ok ? [v.step] : [];
      });
      if (!load(id, { steps: views, say: "", source: "direct" })) {
        store.patchRun(id, { status: "failed", endedAt: Date.now(), say: "That command isn't valid." });
        return [];
      }
      store.patchRun(id, { say: store.run(id)!.steps.map((s) => s.label).join(", then ") + "." });
      return execute(id);
    },
    [start, load, execute, store],
  );

  const runOne = useCallback(
    async (name: string, input: unknown, origin: RunOrigin, interact?: <T>(fn: () => Promise<T>) => Promise<T>): Promise<CommandResult> => {
      const v = validateStep(name, input);
      if (!v.ok) return { ok: false, text: v.reason };
      const view = viewStep(v.step);
      const go = () => runSteps([v.step], view.label, origin).then((r) => r.at(-1) ?? { ok: false, text: "Nothing ran." });
      return view.risk === "confirm" && interact ? interact(go) : go();
    },
    [runSteps],
  );

  const dismissToast = useCallback(() => store.set({ toastId: undefined }), [store]);

  const runtime = useMemo<CommandRuntime>(
    () => ({ store, open, close, toggle, submit, runSteps, runOne, approve, dismissToast, sites, recent: readRecent }),
    [store, open, close, toggle, submit, runSteps, runOne, approve, dismissToast, sites],
  );

  // ⌘K / Ctrl+K anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // WebMCP: the same commands as tools for an agent in this browser.
  useEffect(() => {
    const { cleanup } = registerWebMcp((name, input, { interact }) => runOne(name, input, "webmcp", interact));
    return cleanup;
  }, [runOne]);

  // window.darwin, for automation and devtools.
  useEffect(() => {
    const w = window as Window & { darwin?: Record<string, unknown> };
    const surface = {
      version: 1,
      commands: [...COMMAND_NAMES],
      manifest,
      run: (name: string, input?: unknown) => runOne(name, input ?? {}, "api"),
      plan: async (text: string) => {
        const res = await fetch("/api/command", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, page: `${window.location.pathname}${window.location.search}` }),
        });
        return res.json();
      },
      do: (text: string) => submit(text, "api"),
      open: () => open(),
      webmcp: hasWebMcp(),
    };
    const target = w.darwin && typeof w.darwin === "object" ? w.darwin : {};
    w.darwin = Object.assign(target, surface);
    return () => {
      if (w.darwin) for (const k of Object.keys(surface)) delete w.darwin[k];
    };
  }, [runOne, submit, open]);

  return <Ctx.Provider value={runtime}>{children}</Ctx.Provider>;
}
