"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useExperiments } from "@/lib/console/hooks";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Card, DEPTH, PillButton } from "../ui";

/** Danger zone: put the store back to the original page (inline confirm, no modal). */
export function ResetCard({ className }: { className?: string }) {
  const { reset, loop, mock } = useDarwin();
  const experiments = useExperiments();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus({ preventScroll: true });
  }, [confirming]);

  const go = async () => {
    setBusy(true);
    try {
      await reset();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const gen = loop?.generation ?? 0;
  const tests = experiments?.length ?? 0;
  const facts = [
    gen > 0 ? `${gen} shipped version${gen === 1 ? "" : "s"}` : undefined,
    tests > 0 ? `${tests} test${tests === 1 ? "" : "s"}` : undefined,
    loop?.insights.length ? `${loop.insights.length} issue${loop.insights.length === 1 ? "" : "s"}` : undefined,
  ].filter(Boolean);

  return (
    <Card tone="sand" shape="analyst" corner="br" hover={false} className={cn("flex flex-col overflow-clip p-6 tabular-nums", DEPTH, className)} aria-label="Start over">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[36rem]">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Start over</h2>
          <p className="mt-1.5 text-[14.5px] leading-snug text-dw-ink/75">
            Puts {mock ? "this demo" : "the store"} back to the original page (version 0) and forgets every recorded visit, test and issue
            {facts.length ? <> (right now: {facts.join(", ")})</> : null}. Your GitHub and Whop connections stay.
          </p>
        </div>
        <div className="flex min-h-10 items-center" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {!confirming ? (
              <motion.div key="ask" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}>
                <PillButton tone="white" onClick={() => setConfirming(true)} className="text-dw-warn hover:bg-dw-warn-bg">
                  <RotateCcw /> Start over
                </PillButton>
              </motion.div>
            ) : (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18 }}
                className="flex flex-wrap items-center gap-2 rounded-full bg-dw-warn-bg py-1 pr-1 pl-4"
                role="group"
                aria-label="Confirm start over"
              >
                <span className="text-[13.5px] font-medium text-dw-warn">Wipe it all?</span>
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="h-9 rounded-full px-3.5 text-[13.5px] font-medium text-dw-ink/75 transition-colors hover:bg-white/70 hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={() => void go()}
                  disabled={busy}
                  className="h-9 rounded-full bg-dw-warn px-4 text-[13.5px] font-semibold text-white transition-[background-color,transform] hover:bg-[#9c5116] focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.97] disabled:opacity-60"
                >
                  {busy ? "Starting over…" : "Yes, start over"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}

/** Demo mode: the whole loop in the browser (?mock=1), no server needed. */
export function DemoCard({ className }: { className?: string }) {
  const { mock } = useDarwin();
  return (
    <Card tone="lilac" shape="experimenter" corner="br" className={cn("flex flex-col overflow-clip p-6 tabular-nums", DEPTH, className)} aria-label="Demo mode">
      <div className="flex items-start gap-4">
        <Mascot kind="experimenter" size={48} frame active title="Ada, the tester" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Demo mode</h2>
          <p className="mt-1.5 text-[14.5px] leading-snug text-[#3B3263]">
            {mock ? "You're in it: the whole loop is running in your browser, no server." : "Runs the whole loop in your browser, no server. Handy for showing Darwin off."}
          </p>
        </div>
      </div>
      <div className="mt-4 flex">
        {/* Full navigation both ways: the provider reads ?mock=1 once, when the app loads. */}
        <a
          href={mock ? "/console/settings" : "/console?mock=1"}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[background-color,transform] focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.97]",
            mock ? "bg-white text-dw-ink hover:bg-[#fffaf0]" : "bg-dw-ink text-white hover:bg-black",
          )}
        >
          {mock ? "Back to your store" : "Open the demo"} <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </Card>
  );
}
