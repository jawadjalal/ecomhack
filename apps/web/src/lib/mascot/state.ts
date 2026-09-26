/**
 * Which pose a crew mascot should hold, from what the app is actually doing (loop phase, autopilot, the latest
 * activity line, a chat reply in flight). Pure functions, client-safe; the art is components/mascots.
 *
 * One crew naming (lib/crew, lib/team/roster): Darwin is the red crowned leader, Iris (observer) watches shoppers
 * and finds where they get stuck, Pixel (designer) drafts the fix, Fizz (experimenter) runs and judges the A/B
 * test, Dash (shipper) ships the winner. The loop log still says "analyst" for the diagnose step: that is Iris.
 */
import type { MascotKind, MascotState } from "@/lib/contracts/team";

export type { MascotKind, MascotState };

/** The crew members who own a loop phase. */
export const LOOP_CREW = ["observer", "designer", "experimenter", "shipper"] as const;

export type CrewRole = (typeof LOOP_CREW)[number];

/** Loop actors and other speakers → a mascot. Unknown names fall back to Darwin. */
const ACTOR_MASCOT: Record<string, MascotKind> = {
  observer: "observer",
  analyst: "observer",
  iris: "observer",
  designer: "designer",
  pixel: "designer",
  experimenter: "experimenter",
  fizz: "experimenter",
  shipper: "shipper",
  dash: "shipper",
  leader: "leader",
  darwin: "leader",
  system: "leader",
  assistant: "leader",
};

export function mascotForActor(actor: string | null | undefined): MascotKind {
  if (!actor) return "leader";
  return ACTOR_MASCOT[actor.trim().toLowerCase()] ?? "leader";
}

/** Which crew member owns a loop phase. Idle has no one at work. */
export function phaseRole(phase: string | null | undefined): CrewRole | null {
  switch (phase) {
    case "observe":
    case "diagnose":
      return "observer";
    case "propose":
      return "designer";
    case "experiment":
    case "decide":
      return "experimenter";
    case "ship":
      return "shipper";
    default:
      return null;
  }
}

/** Pose for the crew member who is actually in this phase. */
export function moodForPhase(phase: string | null | undefined): MascotState {
  switch (phase) {
    case "diagnose":
    case "propose":
    case "decide":
      return "thinking";
    case "observe":
    case "experiment":
    case "ship":
      return "working";
    default:
      return "idle";
  }
}

/** A just-finished step or a failure, read from the activity line. Null when the line is narration. */
export function outcomeFromMessage(message: string | null | undefined): "success" | "error" | null {
  if (!message) return null;
  const m = message.toLowerCase();
  if (/\b(fail(ed|ure)?|error|couldn'?t|could not|rolled back)\b/.test(m) || /\breject(ed)?\b/.test(m) || /decision:\s*reject/.test(m)) {
    return "error";
  }
  if (/\b(shipped|promoted)\b/.test(m) || /decision:\s*ship\b/.test(m) || /\bopened pr\b/.test(m)) return "success";
  return null;
}

export interface CrewStateInput {
  phase?: string | null;
  /** Autopilot (or the feature this mascot represents) is on. Omitted = not paused. */
  autopilot?: boolean;
  /** A manual step is in flight. */
  stepping?: boolean;
  /** A live A/B test keeps the experimenter working even when autopilot is paused. */
  experimentRunning?: boolean;
  lastEntry?: { actor: string; message: string; at: string } | null;
  /** Epoch ms. 0 or omitted skips the brief success/error flash (safe for SSR). */
  now?: number;
}

const FLASH_MS = 1800;

function freshOutcome(entry: { message: string; at: string }, now: number): "success" | "error" | null {
  if (now <= 0) return null;
  const age = now - Date.parse(entry.at);
  if (!Number.isFinite(age) || age < 0 || age >= FLASH_MS) return null;
  return outcomeFromMessage(entry.message);
}

/**
 * Pose for one crew member.
 * A fresh ship or failure on that member → success or error, briefly. A live test → the tester works.
 * Autopilot off (and not mid-step) → sleeping. Their phase running → working; judgement phases → thinking.
 * Otherwise idle. Darwin (leader) owns no phase: it rests, sleeps with autopilot off, and flashes on its own lines.
 */
export function crewMascotState(role: MascotKind, input: CrewStateInput = {}): MascotState {
  const last = input.lastEntry;
  if (last && mascotForActor(last.actor) === role) {
    const outcome = freshOutcome(last, input.now ?? 0);
    if (outcome) return outcome;
  }
  if (role === "experimenter" && input.experimentRunning) return "working";
  if (input.autopilot === false && !input.stepping) return "sleeping";
  const phase = input.phase ?? "idle";
  if (phaseRole(phase) !== role) return "idle";
  return moodForPhase(phase);
}

/** Ask Darwin: thinking while a reply is pending, a short success or error, otherwise idle. */
export function chatMascotState(input: { pending?: boolean; failed?: boolean; justReplied?: boolean }): MascotState {
  if (input.pending) return "thinking";
  if (input.failed) return "error";
  if (input.justReplied) return "success";
  return "idle";
}

/** Activity-feed row. Only the latest line takes a live pose; older lines rest. */
export function activityMascotState(
  entry: { phase: string; message: string; at: string },
  input: { isLatest: boolean; now?: number; autopilot?: boolean; stepping?: boolean },
): MascotState {
  if (!input.isLatest) return "idle";
  const outcome = freshOutcome(entry, input.now ?? 0);
  if (outcome) return outcome;
  if (input.autopilot === false && !input.stepping) return "sleeping";
  return moodForPhase(entry.phase);
}
