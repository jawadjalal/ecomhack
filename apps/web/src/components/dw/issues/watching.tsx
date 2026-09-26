"use client";

import { motion } from "motion/react";
import { Play } from "lucide-react";
import { PHASE_META } from "@/lib/console/format";
import { useDarwin } from "../provider";
import { Mascot, type MascotKind } from "../mascot";
import { PageHead, PillButton, Typing } from "../ui";
import { Panel } from "./panel";

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
            {autopilot
              ? `${PHASE_META[loop?.phase ?? "observe"].blurb}. This page fills in by itself.`
              : (line ?? "Darwin works in small steps: watch, find the leak, draft a fix, test it, ship the winner.")}
          </p>
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
