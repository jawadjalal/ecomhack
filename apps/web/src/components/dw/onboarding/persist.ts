/**
 * Onboarding progress survives a reload, a closed tab and a revisit: the stage, what was typed and
 * answered, the connection and the install result live in localStorage (versioned key). The plan itself is
 * kept by lib/tracking/remember.ts (rememberPlan / recallPlan), so a revisit never regenerates it.
 * v1 lived in sessionStorage (this tab only); it's read once as a fallback. Every access is wrapped:
 * storage can be blocked or full.
 */
import type { PullRequestResult } from "@/lib/github";
import type { WhopConnection } from "@/lib/whop";
import type { Answers } from "./ask";

export const PROGRESS_KEY = "darwin-onboarding-progress:v2";
const LEGACY_KEY = "darwin-onboarding-progress:v1";

export type SavedStage = "connect" | "ask" | "plan" | "install" | "live";

export interface SavedMessage {
  from: "you" | "darwin";
  text: string;
  chips?: string[];
}

export interface SavedProgress {
  v: 2;
  stage: SavedStage;
  prompt: string;
  answers?: Answers;
  repo: string | null;
  website: string | null;
  /** A summary only (no products): what the chip and the plan need. */
  whop: Pick<WhopConnection, "mode" | "title" | "accountId" | "connectedAt"> | null;
  /** The plan's darwin.js site id: recallPlan(site), else GET /api/onboarding/plan?site=… */
  site: string | null;
  snippet: string | null;
  pr: PullRequestResult | null;
  chat: SavedMessage[];
  /** The furthest stage reached (going back to edit answers doesn't lose it). */
  furthest?: SavedStage;
  savedAt?: string;
}

export const STAGES: SavedStage[] = ["connect", "ask", "plan", "install", "live"];

export const stageIndex = (s: SavedStage) => STAGES.indexOf(s);

function local(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function session(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function parse(raw: string | null | undefined): SavedProgress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Omit<SavedProgress, "v">> & { v?: number };
    if ((p?.v !== 1 && p?.v !== 2) || !STAGES.includes(p.stage as SavedStage)) return null;
    const stage = p.stage as SavedStage;
    const furthest = STAGES.includes(p.furthest as SavedStage) && stageIndex(p.furthest as SavedStage) > stageIndex(stage) ? (p.furthest as SavedStage) : stage;
    return {
      v: 2,
      stage,
      furthest,
      prompt: typeof p.prompt === "string" ? p.prompt : "",
      answers:
        p.answers && Array.isArray(p.answers.track) && Array.isArray(p.answers.where)
          ? {
              track: p.answers.track,
              where: p.answers.where,
              note: String(p.answers.note ?? ""),
            }
          : undefined,
      repo: typeof p.repo === "string" ? p.repo : null,
      website: typeof p.website === "string" ? p.website : null,
      whop: p.whop && typeof p.whop.title === "string" ? p.whop : null,
      site: typeof p.site === "string" ? p.site : null,
      snippet: typeof p.snippet === "string" ? p.snippet : null,
      pr: p.pr && typeof p.pr === "object" ? p.pr : null,
      chat: Array.isArray(p.chat) ? p.chat.filter((m) => m && (m.from === "you" || m.from === "darwin") && typeof m.text === "string").slice(-30) : [],
      savedAt: typeof p.savedAt === "string" ? p.savedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function loadProgress(): SavedProgress | null {
  try {
    return parse(local()?.getItem(PROGRESS_KEY)) ?? parse(session()?.getItem(LEGACY_KEY));
  } catch {
    return null;
  }
}

export function saveProgress(p: SavedProgress) {
  try {
    local()?.setItem(PROGRESS_KEY, JSON.stringify({ ...p, savedAt: new Date().toISOString() }));
  } catch {
    /* storage blocked or full: progress just won't survive a reload */
  }
}

/** Wipes onboarding progress (not the remembered plans: the console still opens earlier stores). */
export function clearProgress(...extraKeys: string[]) {
  try {
    local()?.removeItem(PROGRESS_KEY);
    session()?.removeItem(LEGACY_KEY);
    for (const k of extraKeys) session()?.removeItem(k);
  } catch {
    /* nothing to clear */
  }
}
