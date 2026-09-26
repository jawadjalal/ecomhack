"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { MessagesSquare } from "lucide-react";
import type { LoopLogEntry } from "@/lib/contracts";
import { timeAgo } from "@/lib/console/format";
import { useNow } from "@/lib/console/hooks";
import { activityMascotState, mascotForActor } from "@/lib/mascot/state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/components/ui/cn";
import { Mascot } from "./mascot";

export const ACTORS: Record<LoopLogEntry["actor"], { name: string }> = {
  observer: { name: "Observer" },
  analyst: { name: "Analyst" },
  designer: { name: "Designer" },
  experimenter: { name: "Experimenter" },
  shipper: { name: "Shipper" },
  system: { name: "Darwin" },
};

/** Highlight numbers and percentages in a log message. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\b\d[\d,.]*%?|[+−-]\d[\d.]*%|P\(beat\)[^,.]*|SHIP|REJECT|INCONCLUSIVE|Wildcard)/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className={cn(
              "font-semibold",
              p === "SHIP"
                ? "text-brand"
                : p === "REJECT"
                  ? "text-[#ff9b9b]"
                  : p === "INCONCLUSIVE" || p === "Wildcard"
                    ? "text-[#ffd27a]"
                    : "text-white",
            )}
          >
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ActivityLog({ log, autopilot = true, stepping = false }: { log: LoopLogEntry[]; autopilot?: boolean; stepping?: boolean }) {
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const entries = log.slice(-40);
  const lastAt = entries.at(-1)?.at;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastAt, entries.length]);

  return (
    <Panel className="h-full">
      <PanelHeader icon={<MessagesSquare />} title="Activity" right={<span className="text-[0.72rem] text-white/35">{log.length} events</span>} />
      <div ref={scroller} className="fade-top min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
        {entries.length === 0 && (
          <div className="flex h-full items-center justify-center px-4 text-center text-[0.85rem] text-white/30">
            Darwin&apos;s agents narrate every decision here.
          </div>
        )}
        <ol className="flex flex-col gap-2.5 pt-6">
          {entries.map((e, i) => {
            const a = ACTORS[e.actor] ?? ACTORS.system;
            const prev = entries[i - 1];
            const grouped = prev && prev.actor === e.actor;
            const pose = activityMascotState(e, { isLatest: i === entries.length - 1, now, autopilot, stepping });
            return (
              <motion.li
                key={`${log.length - entries.length + i}-${e.at}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className={cn("flex gap-2.5", grouped && "-mt-1")}
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center", grouped && "opacity-0")}>
                  <Mascot kind={mascotForActor(e.actor)} size={32} state={pose} />
                </span>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[0.82rem] font-semibold text-white/85">{a.name}</span>
                      <span className="text-[0.68rem] tracking-wide text-white/30 uppercase">{e.phase}</span>
                      <span className="ml-auto text-[0.7rem] text-white/30 tabular">{now ? timeAgo(e.at, now) : ""}</span>
                    </div>
                  )}
                  <div className="rounded-lg rounded-tl-sm bg-white/[0.035] px-3 py-1.5 text-[0.84rem] leading-relaxed text-white/65">
                    <Rich text={e.message} />
                  </div>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}
