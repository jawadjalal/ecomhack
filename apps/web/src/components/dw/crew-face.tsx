"use client";

import { useExperiments, useNow } from "@/lib/console/hooks";
import { crewMascotState, type CrewRole } from "@/lib/mascot/state";
import { Mascot } from "./mascot";
import { useDarwin } from "./provider";

/** A crew member whose pose follows the live loop (phase, autopilot, the latest activity line). */
export function CrewFace({ kind, size = 52, frame = true, className }: { kind: CrewRole; size?: number; frame?: boolean; className?: string }) {
  const { loop, autopilot, stepping } = useDarwin();
  const now = useNow();
  const experiments = useExperiments();
  const experimentRunning = kind === "experimenter" && !!experiments?.some((e) => e.status === "running");
  const last = loop?.log.at(-1);
  const state = crewMascotState(kind, {
    phase: loop?.phase,
    autopilot,
    stepping,
    experimentRunning,
    lastEntry: last ? { actor: last.actor, message: last.message, at: last.at } : null,
    now,
  });
  return <Mascot kind={kind} size={size} frame={frame} state={state} className={className} />;
}
