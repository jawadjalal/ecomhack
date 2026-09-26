import { describe, expect, it } from "vitest";
import {
  activityMascotState,
  chatMascotState,
  crewMascotState,
  mascotForActor,
  moodForPhase,
  outcomeFromMessage,
  phaseRole,
} from "./state";

describe("mascotForActor", () => {
  it("maps each crew role onto its own character and Darwin onto the leader", () => {
    expect(mascotForActor("observer")).toBe("observer");
    // The loop log's "analyst" (the diagnose step) is Iris, the observer.
    expect(mascotForActor("analyst")).toBe("observer");
    expect(mascotForActor("Pixel")).toBe("designer");
    expect(mascotForActor("designer")).toBe("designer");
    expect(mascotForActor("experimenter")).toBe("experimenter");
    expect(mascotForActor("shipper")).toBe("shipper");
    expect(mascotForActor("system")).toBe("leader");
    expect(mascotForActor("Darwin")).toBe("leader");
    expect(mascotForActor("assistant")).toBe("leader");
  });

  it("falls back to Darwin for an unknown speaker", () => {
    expect(mascotForActor("")).toBe("leader");
    expect(mascotForActor(null)).toBe("leader");
    expect(mascotForActor("chatgpt")).toBe("leader");
  });
});

describe("crewMascotState", () => {
  const base = { autopilot: true, now: 0 };

  it("works, thinks, or idles with the loop phase", () => {
    expect(moodForPhase("observe")).toBe("working");
    expect(moodForPhase("diagnose")).toBe("thinking");
    expect(phaseRole("decide")).toBe("experimenter");
    expect(crewMascotState("observer", { ...base, phase: "observe" })).toBe("working");
    expect(phaseRole("diagnose")).toBe("observer");
    expect(crewMascotState("observer", { ...base, phase: "diagnose" })).toBe("thinking");
    expect(crewMascotState("designer", { ...base, phase: "propose" })).toBe("thinking");
    expect(crewMascotState("experimenter", { ...base, phase: "experiment" })).toBe("working");
    expect(crewMascotState("experimenter", { ...base, phase: "decide" })).toBe("thinking");
    expect(crewMascotState("shipper", { ...base, phase: "ship" })).toBe("working");
    expect(crewMascotState("designer", { ...base, phase: "observe" })).toBe("idle");
    expect(crewMascotState("observer", { ...base, phase: "idle" })).toBe("idle");
  });

  it("sleeps when autopilot is off, unless a step or a live test is in flight", () => {
    expect(crewMascotState("observer", { phase: "observe", autopilot: false })).toBe("sleeping");
    expect(crewMascotState("designer", { phase: "propose", autopilot: false, stepping: true })).toBe("thinking");
    expect(crewMascotState("experimenter", { phase: "idle", autopilot: false, experimentRunning: true })).toBe("working");
  });

  it("flashes success or error from the latest line, then rests", () => {
    const at = "2026-09-26T15:00:00.000Z";
    const now = Date.parse(at) + 500;
    const later = Date.parse(at) + 5000;
    const shipped = { actor: "shipper", message: 'Promoted "clearer delivery" to live as spec v2 and opened PR #4.', at };
    expect(outcomeFromMessage(shipped.message)).toBe("success");
    expect(crewMascotState("shipper", { ...base, phase: "observe", lastEntry: shipped, now })).toBe("success");
    expect(crewMascotState("shipper", { ...base, phase: "observe", lastEntry: shipped, now: later })).toBe("idle");
    expect(crewMascotState("designer", { ...base, phase: "observe", lastEntry: shipped, now })).toBe("idle");

    const rejected = { actor: "experimenter", message: "Decision: REJECT. Not shipping a loser.", at };
    expect(outcomeFromMessage(rejected.message)).toBe("error");
    expect(crewMascotState("experimenter", { ...base, phase: "experiment", lastEntry: rejected, now })).toBe("error");
  });
});

describe("chat and activity poses", () => {
  it("follows a Darwin reply", () => {
    expect(chatMascotState({ pending: true })).toBe("thinking");
    expect(chatMascotState({ justReplied: true })).toBe("success");
    expect(chatMascotState({ failed: true, justReplied: true })).toBe("error");
    expect(chatMascotState({})).toBe("idle");
  });

  it("only the latest activity line is live", () => {
    const entry = { phase: "diagnose", message: "Found 2 leaks.", at: "2026-09-26T15:00:00.000Z" };
    expect(activityMascotState(entry, { isLatest: false, autopilot: true })).toBe("idle");
    expect(activityMascotState(entry, { isLatest: true, autopilot: true, now: 0 })).toBe("thinking");
    expect(activityMascotState(entry, { isLatest: true, autopilot: false })).toBe("sleeping");
  });
});
