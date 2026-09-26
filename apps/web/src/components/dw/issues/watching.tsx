"use client";

import { motion } from "motion/react";
import { PHASE_META } from "@/lib/console/format";
import { useNow } from "@/lib/console/hooks";
import { crewMascotState, type CrewRole } from "@/lib/mascot/state";
import { useDarwin } from "../provider";
import { StartDemo, loopIsFresh, pageAgentFor } from "../first-run";
import { CrewFace } from "../crew-face";
import { Mascot, type MascotKind } from "../mascot";
import { PageHead, Typing } from "../ui";
import { Panel } from "./panel";

const CREW: { kind: CrewRole; label: string; phases: string[] }[] = [
  { kind: "observer", label: "Iris watches", phases: ["idle", "observe", "diagnose"] },
  { kind: "designer", label: "Pixel drafts", phases: ["propose"] },
  { kind: "experimenter", label: "Fizz tests", phases: ["experiment", "decide"] },
  { kind: "shipper", label: "Dash ships", phases: ["ship"] },
];

/** The loop as the crew, the current step lifted; each face's pose follows the live loop (lib/mascot/state). */
function Crew({ phase }: { phase?: string }) {
  const { autopilot, stepping, loop } = useDarwin();
  const now = useNow();
  const last = loop?.log.at(-1);
  return (
    <ol className="flex flex-wrap items-start justify-center gap-x-1 gap-y-3" aria-label="How Darwin works">
      {CREW.map((c, i) => {
        const on = phase ? c.phases.includes(phase) : i === 0;
        const pose = crewMascotState(c.kind, { phase, autopilot, stepping, lastEntry: last ? { actor: last.actor, message: last.message, at: last.at } : null, now });
        return (
          <motion.li
            key={c.kind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: on ? -4 : 0 }}
            transition={{ delay: 0.15 + i * 0.07, type: "spring", stiffness: 300, damping: 22 }}
            className="flex items-center gap-1"
            aria-current={on ? "step" : undefined}
          >
            <span className="flex w-[84px] flex-col items-center gap-1.5">
              <span className={on ? "" : "opacity-55 saturate-50"}>
                <Mascot kind={c.kind} size={40} frame state={pose} />
              </span>
              <span className={on ? "text-[12px] font-semibold" : "text-[12px] text-dw-ink/60"}>{c.label}</span>
            </span>
            {i < CREW.length - 1 && <span className="mb-5 h-px w-4 bg-dw-ink/20" aria-hidden />}
          </motion.li>
        );
      })}
    </ol>
  );
}

/**
 * Friendly empty state while the loop has nothing to show yet: a big framed mascot, one line, and
 * the one-click start (<StartDemo />: autopilot + simulated shoppers). With autopilot on, it shows Darwin at work.
 */
export function WatchingEmpty({
  mascot = "observer",
  title,
  lede,
  line,
  action,
}: {
  mascot?: MascotKind;
  title?: string;
  lede?: string;
  line?: string;
  /** Replaces the default start action ("Let Iris watch": the page agent's, from `mascot`). */
  action?: React.ReactNode;
}) {
  const { loop, autopilot } = useDarwin();
  const diagnosed = loop && loop.phase !== "idle" && loop.phase !== "observe";
  // Paused before the first shopper: don't claim Darwin is watching; offer the demo store instead.
  const fresh = !autopilot && loopIsFresh(loop);
  const t = title ?? (diagnosed ? "Nothing is stopping shoppers right now" : fresh ? "Iris hasn’t watched any shoppers yet" : "Iris is still watching shoppers");
  const l =
    lede ??
    (diagnosed
      ? "Iris read the latest visits and found nothing clear. Pixel will try a fresh idea next."
      : "Issues show up here once Iris has watched enough people and AI agents shop to see where they get stuck.");
  const tone = mascot === "designer" ? "yellow" : mascot === "shipper" ? "olive" : "blue";

  return (
    <>
      <PageHead mascot={<CrewFace kind={mascot} />} title={t} lede={l} />
      <Panel tone={tone} shape={mascot} corner="br" silhouette={320} className="mt-3 min-h-[360px] items-center justify-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="flex flex-col items-center gap-5"
        >
          <CrewFace kind={mascot} size={112} />
          <p className="max-w-[30rem] text-[18px] leading-snug">
            {autopilot
              ? `${PHASE_META[loop?.phase ?? "observe"].blurb}. This page fills in by itself.`
              : (line ?? (fresh ? "Start the demo store and each step shows up here as the crew takes it." : "The crew works in small steps, and each one shows up here."))}
          </p>
          <Crew phase={loop?.phase} />
          {autopilot ? (
            <span className="inline-flex h-10 items-center gap-3 rounded-full bg-white/70 px-5 text-[14px] font-medium">
              <Typing /> {PHASE_META[loop?.phase ?? "observe"].verb}
            </span>
          ) : (
            (action ?? <StartDemo agent={pageAgentFor(mascot)} />)
          )}
        </motion.div>
      </Panel>
    </>
  );
}
