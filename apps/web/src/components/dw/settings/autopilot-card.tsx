"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { PHASE_META } from "@/lib/console/format";
import { TRAFFIC_BATCH, useExperiments } from "@/lib/console/hooks";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Card, LiveDot, pct0 } from "../ui";
import { Switch } from "./switch";

/**
 * The bar a test must clear to ship (lib/optimizer loopConfigFromEnv: shipThreshold 0.975) and the most
 * settings one fix may change (lib/optimizer/proposals: "max 6"). Fixed rules, shown read-only.
 */
const SHIP_BAR = 0.975;
const MAX_SETTINGS = 6;

export function AutopilotCard({ className }: { className?: string }) {
  const { autopilot, setAutopilot, loop, trafficOn, setTrafficOn, mock } = useDarwin();
  const experiments = useExperiments();
  const [busy, setBusy] = useState(false);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await setAutopilot(on);
    } finally {
      setBusy(false);
    }
  };

  const running = experiments?.find((e) => e.status === "running");
  const chance = running?.result?.probabilityToBeat;
  const phase = loop ? PHASE_META[loop.phase] : undefined;

  return (
    <Card tone="yellow" shape="shipper" corner="tr" className={cn("flex flex-col overflow-clip p-6 sm:p-7", className)} aria-label="Autopilot">
      <div className="flex items-start gap-4">
        <Mascot kind="shipper" size={60} frame active={autopilot} title="Dash, Darwin's shipper" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">Autopilot</h2>
          <p className="mt-1 flex items-center gap-2 text-[14px] text-[#4F4417]" aria-live="polite">
            {autopilot ? <LiveDot /> : <span className="size-2 rounded-full bg-dw-ink/30" />}
            {!loop ? (
              "Checking…"
            ) : autopilot ? (
              <span>
                Running · {phase?.verb.toLowerCase()} on Gen {loop.generation}
              </span>
            ) : (
              <span>Paused on Gen {loop.generation}</span>
            )}
          </p>
        </div>
        <Switch size="lg" checked={autopilot} busy={busy} onChange={(on) => void toggle(on)} label="Autopilot" className="mt-1" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={autopilot ? "on" : "off"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="mt-5 max-w-[50rem] text-[16px] leading-snug text-balance"
        >
          {autopilot
            ? "Darwin runs the loop by itself: it watches shoppers, finds what's costing you sales, tests a fix and opens a pull request for every winner."
            : "Off. Darwin keeps everything it has learned and changes nothing until you switch it back on."}
        </motion.p>
      </AnimatePresence>

      <ShipBar chance={chance} name={running?.name} />

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Rule value={String(MAX_SETTINGS)} label="settings changed per fix, at most" />
        <Rule value="Never" label="merges without you" />
      </div>

      <div className="mt-2.5 flex items-center gap-4 rounded-[20px] bg-white/60 p-4 ring-1 ring-white/50">
        <Mascot kind="observer" size={40} active={trafficOn} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold">
            Simulated shoppers
            {trafficOn && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-dw-win">
                <LiveDot /> arriving now
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[13.5px] leading-snug text-[#4F4417]">
            About {TRAFFIC_BATCH.humans} people and {TRAFFIC_BATCH.agents} AI shoppers every couple of seconds, so Darwin has something to learn from
            {mock ? " in this demo" : ""}. Tagged simulated, never mixed into real numbers.
          </p>
        </div>
        <Switch checked={trafficOn} onChange={setTrafficOn} label="Simulated shoppers" />
      </div>
    </Card>
  );
}

function Rule({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col rounded-2xl bg-white/55 px-4 py-3">
      <span className="num text-[20px] leading-tight font-semibold">{value}</span>
      <span className="text-[13px] text-[#4F4417]">{label}</span>
    </div>
  );
}

/** The fixed shipping bar, with the running test's current chance sliding towards it. */
function ShipBar({ chance, name }: { chance?: number; name?: string }) {
  const at = chance === undefined ? 0 : Math.max(0, Math.min(1, chance));
  const past = chance !== undefined && chance >= SHIP_BAR;
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3 text-[14px]">
        <span>Ships a fix once its chance of winning passes</span>
        <span className="num font-semibold">{(SHIP_BAR * 100).toFixed(1)}%</span>
      </div>
      <div
        className="relative mt-2.5 h-2 rounded-full bg-dw-ink/[0.14]"
        role="meter"
        aria-label={name ? `Chance “${name}” wins` : "Chance the running test wins"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(at * 100)}
      >
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-dw-ink" initial={{ width: 0 }} animate={{ width: `${at * 100}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
        <span className="absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-dw-ink" style={{ left: `${SHIP_BAR * 100}%` }} aria-hidden />
        {chance !== undefined && (
          <motion.span
            aria-hidden
            className={cn("absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2px_#141413]", past && "bg-dw-live")}
            initial={{ left: 0 }}
            animate={{ left: `${at * 100}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 20 }}
          />
        )}
      </div>
      <p className="mt-2 text-[13px] text-[#4F4417]">
        {name && chance !== undefined ? (
          <>
            “{name}” is at <span className="num font-semibold text-dw-ink">{pct0(chance)}</span> right now
            {past ? ", past the bar." : "."}
          </>
        ) : name ? (
          <>“{name}” is still gathering shoppers.</>
        ) : (
          "No test running right now. The bar is fixed, so every change is held to the same standard."
        )}
      </p>
    </div>
  );
}
