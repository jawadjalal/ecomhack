"use client";

import { Pause, Radio } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { setLive, useLive } from "@/lib/console/live";

/** Header switch: live updates on, or hold the screen still while you read it. Icon-only below 1536px. */
export function LiveSwitch() {
  const live = useLive();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={live}
      aria-label="Live updates"
      title={live ? "Live: the numbers refresh every few seconds. Click to hold the screen still." : "Held still. Click to turn live updates back on."}
      onClick={() => setLive(!live)}
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors max-2xl:w-11 max-2xl:justify-center max-2xl:px-0 max-sm:hidden",
        live ? "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]" : "bg-dw-ink text-dw-bg hover:bg-dw-ink/90",
      )}
    >
      {live ? <Radio className="size-4" /> : <Pause className="size-4" />}
      <span className="max-2xl:hidden">{live ? "Live" : "Held"}</span>
    </button>
  );
}
