/**
 * Typed client for every HTTP route the console calls (see src/lib/contracts/api.ts).
 *
 * Modes:
 *   - "live": real endpoints only.
 *   - "mock": everything served by the in-browser MockEngine (`/console?mock=1`).
 *   - "auto" (default): real endpoints, but if an API *group* answers 404/405/501 (not built yet),
 *     that group falls back to the mock engine and the console labels it. Missing groups are
 *     re-probed every 20s, so the console switches to real data as soon as a route lands.
 */
import type {
  AgentSessionSummary,
  AgentSessionsResponse,
  AnalyticsEventsResponse,
  AnalyticsFilter,
  AnalyticsSummaryResponse,
  ExperimentsResponse,
  GithubStatusResponse,
  LoopResponse,
} from "@/lib/contracts";
import type { SimulationOptions, SimulationResult } from "@/lib/simulator";
import type { PullRequestResult } from "@/lib/github";
import { mockEngine, type MockEngine } from "./mock";

export type ApiMode = "live" | "mock" | "auto";

/** Routes grouped by owning PR, so a group is either all-real or all-mock (consistent ids). */
export type ApiGroup = "optimizer" | "analytics" | "agents" | "simulator" | "github";

export const API_GROUP_ROUTES: Record<ApiGroup, string[]> = {
  optimizer: ["GET /api/loop", "POST /api/loop/step", "POST /api/loop/autopilot", "POST /api/loop/reset", "GET /api/experiments"],
  analytics: ["GET /api/analytics/summary", "GET /api/analytics/events"],
  agents: ["GET /api/agent/sessions", "POST /api/agent/shop"],
  simulator: ["POST /api/simulate"],
  github: ["GET /api/github/status", "POST /api/github/connect"],
};

/** POST /api/agent/shop → one in-process buyer agent (agent-commerce PR; mirrors its AgentShopResponse). */
export interface AgentShopResponse {
  session: AgentSessionSummary;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const MISSING_STATUSES = new Set([404, 405, 501]);
const REPROBE_MS = 20_000;

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let message = `${method} ${path} → ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      message = j.error ?? j.message ?? message;
    } catch {
      /* not json */
    }
    throw new ApiError(message, res.status, path);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
}

export interface ConsoleApi {
  readonly mode: ApiMode;
  /** Groups currently served by the mock engine. */
  mockedGroups(): ApiGroup[];
  subscribe(listener: () => void): () => void;

  getLoop(): Promise<LoopResponse>;
  stepLoop(): Promise<LoopResponse>;
  setAutopilot(on: boolean): Promise<LoopResponse>;
  resetLoop(): Promise<LoopResponse>;
  getExperiments(): Promise<ExperimentsResponse>;
  getSummary(filter?: Pick<AnalyticsFilter, "experimentId" | "variant" | "visitorKind" | "specVersion">): Promise<AnalyticsSummaryResponse>;
  getEvents(after?: string, limit?: number, opts?: { realOnly?: boolean }): Promise<AnalyticsEventsResponse>;
  getSessions(limit?: number): Promise<AgentSessionsResponse>;
  /** Send one buyer agent shopping with a natural-language brief. */
  sendShopper(brief: string, useLlm?: boolean, via?: "tools" | "a2a"): Promise<AgentShopResponse>;
  simulate(opts: SimulationOptions): Promise<SimulationResult>;
  getGithubStatus(): Promise<GithubStatusResponse>;
  connectRepo(repoUrl: string): Promise<PullRequestResult>;
}

export function createConsoleApi(mode: ApiMode = "auto", engineOrFactory: MockEngine | (() => MockEngine) = mockEngine): ConsoleApi {
  // Lazy so that server-side rendering never instantiates the simulation.
  const eng = () => (typeof engineOrFactory === "function" ? engineOrFactory() : engineOrFactory);
  /** group → time it was found missing. */
  const missing = new Map<ApiGroup, number>();
  const listeners = new Set<() => void>();
  let snapshot: ApiGroup[] = mode === "mock" ? (Object.keys(API_GROUP_ROUTES) as ApiGroup[]) : [];
  const emit = () => {
    snapshot = mode === "mock" ? snapshot : [...missing.keys()].sort();
    listeners.forEach((l) => l());
  };

  async function call<T>(group: ApiGroup, real: () => Promise<T>, mock: () => Promise<T>): Promise<T> {
    if (mode === "mock") return mock();
    const since = missing.get(group);
    if (mode === "auto" && since !== undefined && Date.now() - since < REPROBE_MS) return mock();
    try {
      const out = await real();
      if (since !== undefined) {
        missing.delete(group);
        emit();
      }
      return out;
    } catch (err) {
      if (mode === "auto" && err instanceof ApiError && MISSING_STATUSES.has(err.status)) {
        const first = since === undefined;
        missing.set(group, Date.now());
        if (first) emit();
        return mock();
      }
      throw err;
    }
  }

  return {
    mode,
    mockedGroups: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getLoop: () => call("optimizer", () => request<LoopResponse>("GET", "/api/loop"), () => eng().getLoop()),
    stepLoop: () => call("optimizer", () => request<LoopResponse>("POST", "/api/loop/step", {}), () => eng().stepLoop()),
    setAutopilot: (on) =>
      call("optimizer", () => request<LoopResponse>("POST", "/api/loop/autopilot", { on }), () => eng().setAutopilot(on)),
    resetLoop: () => call("optimizer", () => request<LoopResponse>("POST", "/api/loop/reset", {}), () => eng().resetLoop()),
    getExperiments: () =>
      call("optimizer", () => request<ExperimentsResponse>("GET", "/api/experiments"), () => eng().getExperiments()),

    getSummary: (filter = {}) =>
      call(
        "analytics",
        () =>
          request<AnalyticsSummaryResponse>(
            "GET",
            `/api/analytics/summary${qs({
              experimentId: filter.experimentId,
              variant: filter.variant,
              visitorKind: filter.visitorKind,
              specVersion: filter.specVersion,
            })}`,
          ),
        () => eng().getSummary(filter),
      ),
    getEvents: (after, limit = 100, opts) =>
      call(
        "analytics",
        () =>
          request<AnalyticsEventsResponse>(
            "GET",
            `/api/analytics/events${qs({ after, limit, ...(opts?.realOnly ? { synthetic: "0" } : {}) })}`,
          ),
        () => (opts?.realOnly ? Promise.resolve({ events: [] }) : eng().getEvents(after, limit)),
      ),

    getSessions: (limit = 20) =>
      call("agents", () => request<AgentSessionsResponse>("GET", `/api/agent/sessions${qs({ limit })}`), () => eng().getSessions(limit)),

    sendShopper: (brief, useLlm = true, via = "tools") =>
      call(
        "agents",
        () => request<AgentShopResponse>("POST", "/api/agent/shop", { brief, useLlm, via }),
        () => eng().sendShopper(brief, via),
      ),

    simulate: (opts) => call("simulator", () => request<SimulationResult>("POST", "/api/simulate", opts), () => eng().simulate(opts)),

    getGithubStatus: () =>
      call("github", () => request<GithubStatusResponse>("GET", "/api/github/status"), () => eng().getGithubStatus()),
    connectRepo: (repoUrl) =>
      call("github", () => request<PullRequestResult>("POST", "/api/github/connect", { repoUrl }), () => eng().connectRepo(repoUrl)),
  };
}
