/**
 * Onboarding progress survives a reload: the stage, what was typed and answered, the connection and the
 * install result live in sessionStorage (this tab only). The plan itself is re-fetched from the server by
 * its site id so it's never stale. Every access is wrapped: storage can be blocked or full.
 */
import type { PullRequestResult } from "@/lib/github";
import type { WhopConnection } from "@/lib/whop";
import type { Answers } from "./ask";

export const PROGRESS_KEY = "darwin-onboarding-progress:v1";

export type SavedStage = "connect" | "ask" | "plan" | "install" | "live";

export interface SavedMessage {
  from: "you" | "darwin";
  text: string;
  chips?: string[];
}

export interface SavedProgress {
  v: 1;
  stage: SavedStage;
  prompt: string;
  answers?: Answers;
  repo: string | null;
  website: string | null;
  /** A summary only (no products): what the chip and the plan need. */
  whop: Pick<WhopConnection, "mode" | "title" | "accountId" | "connectedAt"> | null;
  /** The plan's darwin.js site id: GET /api/onboarding/plan?site=… */
  site: string | null;
  snippet: string | null;
  pr: PullRequestResult | null;
  chat: SavedMessage[];
}

const STAGES: SavedStage[] = ["connect", "ask", "plan", "install", "live"];

export function loadProgress(): SavedProgress | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<SavedProgress>;
    if (p?.v !== 1 || !STAGES.includes(p.stage as SavedStage)) return null;
    return {
      v: 1,
      stage: p.stage as SavedStage,
      prompt: typeof p.prompt === "string" ? p.prompt : "",
      answers: p.answers && Array.isArray(p.answers.track) && Array.isArray(p.answers.where) ? { track: p.answers.track, where: p.answers.where, note: String(p.answers.note ?? "") } : undefined,
      repo: typeof p.repo === "string" ? p.repo : null,
      website: typeof p.website === "string" ? p.website : null,
      whop: p.whop && typeof p.whop.title === "string" ? p.whop : null,
      site: typeof p.site === "string" ? p.site : null,
      snippet: typeof p.snippet === "string" ? p.snippet : null,
      pr: p.pr && typeof p.pr === "object" ? p.pr : null,
      chat: Array.isArray(p.chat) ? p.chat.filter((m) => m && (m.from === "you" || m.from === "darwin") && typeof m.text === "string").slice(-30) : [],
    };
  } catch {
    return null;
  }
}

export function saveProgress(p: SavedProgress) {
  try {
    sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked or full: progress just won't survive a reload */
  }
}

export function clearProgress(...extraKeys: string[]) {
  try {
    sessionStorage.removeItem(PROGRESS_KEY);
    for (const k of extraKeys) sessionStorage.removeItem(k);
  } catch {
    /* nothing to clear */
  }
}
