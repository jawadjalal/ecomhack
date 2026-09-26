"use client";

import { Command } from "lucide-react";
import { useModKey } from "./keys";
import { useCommandRuntime } from "./runtime";

/** The "⌘K" pill in the top nav: opens the command bar. Renders nothing outside the command runtime. */
export function CommandPill() {
  const rt = useCommandRuntime();
  const mod = useModKey();
  if (!rt) return null;
  return (
    <button
      type="button"
      onClick={() => rt.open()}
      aria-label={`Open the command bar (${mod} K)`}
      title="Tell Darwin what to do"
      className="flex h-11 items-center gap-1.5 rounded-full bg-dw-sand px-3.5 text-[14px] font-medium whitespace-nowrap text-dw-ink/80 transition-colors hover:bg-[#e4dccb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink max-2xl:size-11 max-2xl:justify-center max-2xl:px-0 max-sm:size-9"
    >
      <Command className="size-4 2xl:hidden" />
      <span className="max-2xl:hidden">
        {mod}
        <span className="ml-0.5">K</span>
      </span>
    </button>
  );
}
