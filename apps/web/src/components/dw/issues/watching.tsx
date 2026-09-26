"use client";

import { motion } from "motion/react";
import { Play } from "lucide-react";
import { PHASE_META } from "@/lib/console/format";
import { useNow } from "@/lib/console/hooks";
import { crewMascotState, type CrewRole } from "@/lib/mascot/state";
import { CrewFace } from "../crew-face";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { PageHead, PillButton, Typing } from "../ui";
import { Panel } from "./panel";

const CREW: { kind: CrewRole; label: string; phases: string[] }[] = [
  { kind: "observer", label: "Watch", phases: ["idle", "observe"] },
  { kind: "analyst", label: "Find leaks", phases: ["diagnose"] },
  { kind: "designer", label: "Draft a fix", phases: ["propose"] },
  { kind: "experimenter", label: "Test it", phases: ["experiment", "decide"] },
  { kind: "shipper", label: "Ship it", phases: ["ship"] },
];

/** The five-step loop as the crew, the current step lifted and bobbing. */
function Crew({ phase }: { phase?: string }) {
  const { autopilot, stepping, loop } = useDarwin();
  const now = useNow();
  const last = loop?.log.at(-1);
  return (
    <ol className="flex flex-wrap items-start justify-center gap-x-1 gap-y-3" aria-label="How Darwin works">
      {CREW.map((c, i) => {
        const on = phase ? c.phases.includes(phase) : i === 0;
        const state = crewMascotState(c.kind, {
          phase,
          autopilot,
          stepping,
          lastEntry: last ? { actor: last.actor, message: last.message, at: last.at } : null,
          now,
        });
        return (
          <motion.li
            key={c.kind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: on ? -4 : 0 }}
            transition={{ delay: 0.15 + i * 0.07, type: "spring", stiffness: 300, damping: 22 }}
            className="flex items-center gap-1"
            aria-current={on ? "step" : undefined}
          >
            <span className="flex w-[74px] flex-col items-center gap-1.5">
              <span className={on ? "" : "opacity-55 saturate-50"}>
                <Mascot kind={c.kind} size={40} frame state={state} />
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
 * "Let Darwin run" (turns autopilot on). With autopilot already on, it shows Darwin at work instead.
 */
export function WatchingEmpty({
  mascot = "observer",
  title,
  lede,
  line,
  action,
}: {
  mascot?: CrewRole;
  title?: string;
  lede?: string;
  line?: string;
  /** Replaces the default "Let Darwin run" action. */
  action?: React.ReactNode;
}) {
  const { loop, autopilot, setAutopilot, stepping } = useDarwin();
  const diagnosed = loop && loop.phase !== "idle" && loop.phase !== "observe";
  const t = title ?? (diagnosed ? "Nothing is stopping shoppers right now" : "Darwin is still watching shoppers");
  const l =
    lede ??
    (diagnosed
      ? "Darwin read the latest sessions and found no clear leak. It will try a creative idea next."
      : "Issues show up here once Darwin has watched enough people and AI agents shop to see where they drop off.");
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
            {autopilot ? `${PHASE_META[loop?.phase ?? "observe"].blurb}. This page fills in by itself.` : (line ?? "Darwin works in small steps, and each one shows up here.")}
          </p>
          <Crew phase={loop?.phase} />
          {autopilot ? (
            <span className="inline-flex h-10 items-center gap-3 rounded-full bg-white/70 px-5 text-[14px] font-medium">
              <Typing /> {PHASE_META[loop?.phase ?? "observe"].verb}
            </span>
          ) : (
            (action ?? (
              <PillButton size="lg" onClick={() => void setAutopilot(true)} disabled={stepping || !loop}>
                <Play /> Let Darwin run
              </PillButton>
            ))
          )}
        </motion.div>
      </Panel>
    </>
  );
}
