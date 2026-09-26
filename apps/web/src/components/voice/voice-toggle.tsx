"use client";

import { AudioLines, Keyboard } from "lucide-react";
import { useId } from "react";
import type { VoiceApi, VoiceMode } from "./types";

const INK = "#141413";

export interface VoiceToggleProps {
  mode: VoiceMode;
  onModeChange: (mode: VoiceMode) => void;
  /** The useVoice() result: supplies availability, unlocks audio on switch, stops audio when leaving voice. */
  voice?: Pick<VoiceApi, "available" | "unavailableReason" | "prime" | "interrupt">;
  /** Override availability when not passing `voice`. */
  available?: boolean | null;
  unavailableReason?: string;
  /** Render nothing when voice isn't available (default: show it disabled with a tooltip). */
  hideWhenUnavailable?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** Type | Voice pill switch (like Claude's voice mode toggle). */
export function VoiceToggle({
  mode,
  onModeChange,
  voice,
  available = voice?.available ?? null,
  unavailableReason = voice?.unavailableReason,
  hideWhenUnavailable,
  size = "md",
  className = "",
}: VoiceToggleProps) {
  const tipId = useId();
  if (available === false && hideWhenUnavailable) return null;
  const voiceOff = available !== true;
  const reason = available === null ? "Checking voice…" : unavailableReason || "Voice isn't available right now.";
  const h = size === "sm" ? "h-8" : "h-9";
  const btn = size === "sm" ? "h-6 px-2.5 text-[12px]" : "h-7 px-3 text-[13px]";
  const icon = size === "sm" ? "size-3.5" : "size-4";

  const choose = (next: VoiceMode) => {
    if (next === mode) return;
    if (next === "voice") {
      if (voiceOff) return;
      voice?.prime();
    } else {
      voice?.interrupt();
    }
    onModeChange(next);
  };

  return (
    <div className={`group relative inline-flex shrink-0 ${className}`}>
      <div role="radiogroup" aria-label="Input mode" className={`relative inline-flex ${h} items-center gap-0.5 rounded-full bg-[#F3EDE0] p-1`}>
        {/* Sliding thumb */}
        <span
          aria-hidden
          className={`absolute top-1 bottom-1 left-1 rounded-full bg-white shadow-[0_1px_2px_rgba(20,20,19,0.12),0_0_0_1px_#E8DFCC] transition-transform duration-200 ease-out motion-reduce:transition-none`}
          style={{ width: "calc(50% - 5px)", transform: mode === "voice" ? "translateX(calc(100% + 2px))" : "translateX(0)" }}
        />
        <button
          type="button"
          role="radio"
          aria-checked={mode === "type"}
          onClick={() => choose("type")}
          className={`relative z-10 inline-flex ${btn} min-w-[68px] flex-1 items-center justify-center gap-1.5 rounded-full font-medium transition-colors motion-reduce:transition-none ${
            mode === "type" ? "" : "text-[#6E695D] hover:text-[#141413]"
          }`}
          style={mode === "type" ? { color: INK } : undefined}
        >
          <Keyboard className={icon} aria-hidden />
          Type
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "voice"}
          aria-disabled={voiceOff || undefined}
          aria-describedby={voiceOff ? tipId : undefined}
          title={voiceOff ? reason : undefined}
          onClick={() => choose("voice")}
          className={`relative z-10 inline-flex ${btn} min-w-[68px] flex-1 items-center justify-center gap-1.5 rounded-full font-medium transition-colors motion-reduce:transition-none ${
            voiceOff ? "cursor-not-allowed text-[#A9A392]" : mode === "voice" ? "" : "text-[#6E695D] hover:text-[#141413]"
          }`}
          style={mode === "voice" && !voiceOff ? { color: INK } : undefined}
        >
          <AudioLines className={icon} aria-hidden />
          Voice
        </button>
      </div>
      {voiceOff && (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[240px] -translate-x-1/2 rounded-xl bg-[#141413] px-3 py-2 text-center text-[12px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
        >
          {reason}
        </span>
      )}
    </div>
  );
}
