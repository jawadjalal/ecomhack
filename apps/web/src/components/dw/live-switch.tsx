"use client";

import { Pause, Radio } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { setLive, useLive } from "@/lib/console/live";

/** Header switch: live updates on, or hold the screen still while you read it. */
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
        "flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors",
        live ? "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]" : "bg-dw-ink text-dw-bg hover:bg-dw-ink/90",
      )}
    >
      {live ? <Radio className="size-4" /> : <Pause className="size-4" />}
      <span className="max-sm:hidden">{live ? "Live" : "Held"}</span>
    </button>
  );
}
