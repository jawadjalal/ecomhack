/**
 * Which animated mascot stands for each crew role, and which pose matches what the app is doing.
 *
 * Assets: public/mascots/{kind}-{state}.svg (served, not inlined).
 * leader is Darwin (red crowned squircle). The other five are the crew.
 */

export const CREW_ROLES = ["observer", "analyst", "designer", "experimenter", "shipper"] as const;

export type CrewRole = (typeof CREW_ROLES)[number];

/** Animated character. `leader` is Darwin itself. */
export type MascotKind = CrewRole | "leader";

export type MascotState = "idle" | "working" | "thinking" | "success" | "error" | "sleeping";

export const MASCOT_KINDS: MascotKind[] = ["leader", ...CREW_ROLES];

export const MASCOT_STATES: MascotState[] = ["idle", "working", "thinking", "success", "error", "sleeping"];

/** Loop actors and other speakers → a mascot. Unknown names fall back to Darwin. */
const ACTOR_MASCOT: Record<string, MascotKind> = {
  observer: "observer",
  analyst: "analyst",
  designer: "designer",
  experimenter: "experimenter",
  shipper: "shipper",
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
      return "observer";
    case "diagnose":
      return "analyst";
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

/**
 * Pose for one crew member.
 * Running phase → working. LLM / judgement phases → thinking.
 * A fresh ship or failure on that actor → success or error, briefly.
 * Autopilot off (and not mid-step) → sleeping. Otherwise idle.
 */
export function crewMascotState(role: CrewRole, input: CrewStateInput = {}): MascotState {
  const now = input.now ?? 0;
  const last = input.lastEntry;
  if (last && last.actor === role && now > 0) {
    const at = Date.parse(last.at);
    const age = now - at;
    if (Number.isFinite(age) && age >= 0 && age < FLASH_MS) {
      const outcome = outcomeFromMessage(last.message);
      if (outcome) return outcome;
    }
  }
  if (role === "experimenter" && input.experimentRunning) return "working";
  const paused = input.autopilot === false && !input.stepping;
  if (paused) return "sleeping";
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
  const now = input.now ?? 0;
  if (now > 0) {
    const age = now - Date.parse(entry.at);
    if (Number.isFinite(age) && age >= 0 && age < FLASH_MS) {
      const outcome = outcomeFromMessage(entry.message);
      if (outcome) return outcome;
    }
  }
  if (input.autopilot === false && !input.stepping) return "sleeping";
  return moodForPhase(entry.phase);
}
