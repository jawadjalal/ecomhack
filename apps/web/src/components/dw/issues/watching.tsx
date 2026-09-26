"use client";

import { motion } from "motion/react";
import { Play } from "lucide-react";
import { PHASE_META } from "@/lib/console/format";
import { useDarwin } from "../provider";
import { getAgent } from "@/lib/team/roster";
import { Mascot, type MascotKind } from "../mascot";
import { PageHead, PillButton, Typing } from "../ui";
import { Panel } from "./panel";

/** The loop's five steps, each done by a member of Darwin's team (names from lib/team/roster). */
const CREW: { kind: MascotKind; who: string; label: string; phases: string[] }[] = [
  { kind: "observer", who: getAgent("iris").name, label: "Watch", phases: ["idle", "observe"] },
  { kind: "leader", who: getAgent("darwin").name, label: "Find leaks", phases: ["diagnose"] },
  { kind: "designer", who: getAgent("pixel").name, label: "Draft a fix", phases: ["propose"] },
  { kind: "experimenter", who: getAgent("fizz").name, label: "Test it", phases: ["experiment", "decide"] },
  { kind: "shipper", who: getAgent("dash").name, label: "Ship it", phases: ["ship"] },
];

/** The five-step loop as the team, the current step lifted and breathing, the rest holding still. */
function Crew({ phase }: { phase?: string }) {
  return (
    <ol className="flex flex-wrap items-start justify-center gap-x-1 gap-y-3" aria-label="How Darwin works">
      {CREW.map((c, i) => {
        const on = phase ? c.phases.includes(phase) : i === 0;
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
                <Mascot kind={c.kind} size={40} frame active={on} title={c.who} />
              </span>
              <span className="flex flex-col items-center leading-tight">
                <span className={on ? "text-[12px] font-semibold" : "text-[12px] font-medium text-dw-ink/70"}>{c.who}</span>
                <span className={on ? "text-[11.5px] text-dw-ink/75" : "text-[11.5px] text-dw-ink/50"}>{c.label}</span>
              </span>
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
  mascot?: MascotKind;
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
      <PageHead mascot={<Mascot kind={mascot} size={52} frame active />} title={t} lede={l} />
      <Panel tone={tone} shape={mascot} corner="br" silhouette={320} className="mt-3 min-h-[360px] items-center justify-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="flex flex-col items-center gap-5"
        >
          <Mascot kind={mascot} size={112} frame active />
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
