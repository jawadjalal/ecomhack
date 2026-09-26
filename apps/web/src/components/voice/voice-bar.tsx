"use client";

import { Keyboard, LoaderCircle, Mic, Square } from "lucide-react";
import type { VoiceAgentId, VoiceApi } from "./types";

const INK = "#141413";

/** Default speaker colours (match the team roster; override with `agentColor`). */
const COLORS: Record<string, string> = {
  darwin: "#141413",
  iris: "#4c94f0",
  pixel: "#e0609a",
  fizz: "#f5b429",
  dash: "#3ccf73",
};

export interface VoiceBarProps {
  voice: VoiceApi;
  /** "Back to typing": the panel should switch mode to "type" (the bar stops audio first). */
  onClose?: () => void;
  /** Display name for an agent id (default: capitalised id). */
  agentLabel?: (id: VoiceAgentId) => string;
  /** Ring colour while an agent speaks (default: roster-like colours). */
  agentColor?: (id: VoiceAgentId) => string;
  className?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Voice-mode composer: big mic with a live level ring, state line, and a way back to typing. */
export function VoiceBar({ voice, onClose, agentLabel, agentColor, className = "" }: VoiceBarProps) {
  const { state, level, message, speakingAgent, available } = voice;
  const name = (id?: VoiceAgentId) => (id ? (agentLabel?.(id) ?? cap(String(id))) : "Darwin");
  const accent = state === "speaking" && speakingAgent ? (agentColor?.(speakingAgent) ?? COLORS[String(speakingAgent)] ?? INK) : INK;

  const status =
    available === false
      ? voice.unavailableReason || "Voice isn't available right now."
      : state === "listening"
        ? "Listening…"
        : state === "transcribing"
          ? "Got it, one sec…"
          : state === "thinking"
            ? `${name("darwin")} is thinking…`
            : state === "speaking"
              ? `${name(speakingAgent)} is speaking`
              : state === "error"
                ? message || "Something went wrong. Tap to try again."
                : "Tap the mic and start talking";
  const hint = state === "listening" ? "Tap to send, or just pause" : state === "speaking" ? "Tap to interrupt" : "";
  const label =
    state === "listening"
      ? "Stop and send"
      : state === "speaking"
        ? "Stop the reply and talk"
        : state === "transcribing"
          ? "Working on what you said"
          : state === "thinking"
            ? "Talk over the reply"
            : "Start talking";

  const live = state === "listening" || state === "speaking";
  const lvl = live ? level : 0;
  const busy = state === "transcribing";
  const disabled = available !== true || busy;

  return (
    <div
      className={`relative flex w-full flex-col items-center gap-2 rounded-[28px] bg-white px-4 pt-4 pb-[max(14px,env(safe-area-inset-bottom))] shadow-[0_0_0_1px_#E8DFCC,0_16px_40px_rgba(20,20,19,0.10)] sm:px-6 ${className}`}
    >
      {onClose && (
        <button
          type="button"
          onClick={() => {
            voice.interrupt();
            onClose();
          }}
          className="absolute top-3 left-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F3EDE0] px-3 text-[13px] font-medium text-[#4A463D] transition-colors hover:bg-[#EAE2D0] motion-reduce:transition-none"
          aria-label="Back to typing"
        >
          <Keyboard className="size-4" aria-hidden />
          <span className="hidden sm:inline">Type</span>
        </button>
      )}
      {(state === "speaking" || state === "listening") && (
        <button
          type="button"
          onClick={voice.interrupt}
          className="absolute top-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F3EDE0] px-3 text-[13px] font-medium text-[#4A463D] transition-colors hover:bg-[#EAE2D0] motion-reduce:transition-none"
          aria-label={state === "speaking" ? "Stop speaking" : "Cancel"}
        >
          <Square className="size-3.5 fill-current" aria-hidden />
          <span className="hidden sm:inline">{state === "speaking" ? "Stop" : "Cancel"}</span>
        </button>
      )}

      {/* Mic + level ring */}
      <div className="relative mt-1 grid size-[112px] place-items-center">
        {/* soft halo that breathes with the level */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full transition-transform duration-75 ease-out motion-reduce:transition-none"
          style={{ background: accent, opacity: live ? 0.08 + lvl * 0.14 : 0.05, transform: `scale(${0.72 + lvl * 0.28})` }}
        />
        <span
          aria-hidden
          className="absolute inset-[12px] rounded-full transition-transform duration-75 ease-out motion-reduce:transition-none"
          style={{ background: accent, opacity: live ? 0.12 + lvl * 0.18 : 0.07, transform: `scale(${0.86 + lvl * 0.2})` }}
        />
        {/* thinking: slow pulse; transcribing: spinning arc */}
        {state === "thinking" && (
          <span aria-hidden className="absolute inset-[14px] animate-ping rounded-full opacity-20 motion-reduce:animate-none" style={{ background: INK, animationDuration: "1.8s" }} />
        )}
        {busy && (
          <span
            aria-hidden
            className="absolute inset-[16px] animate-spin rounded-full border-[3px] border-transparent motion-reduce:animate-none"
            style={{ borderTopColor: INK, animationDuration: "0.9s" }}
          />
        )}
        <button
          type="button"
          onClick={voice.tap}
          disabled={disabled}
          aria-label={label}
          className="relative grid size-[72px] place-items-center rounded-full text-white shadow-[0_6px_20px_rgba(20,20,19,0.25)] transition-transform hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100"
          style={{ background: accent }}
        >
          {state === "listening" ? (
            <Bars level={lvl} />
          ) : state === "speaking" ? (
            <Square className="size-6 fill-current" aria-hidden />
          ) : busy ? (
            <LoaderCircle className="size-7 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Mic className="size-7" aria-hidden />
          )}
        </button>
      </div>

      <div className="flex min-h-[44px] max-w-[440px] flex-col items-center text-center" aria-live="polite">
        <p className={`text-[15px] leading-snug font-medium ${state === "error" ? "text-[#9A4A12]" : ""}`} style={state === "error" ? undefined : { color: INK }}>
          {status}
        </p>
        {hint && <p className="text-[12px] text-[#8C8676]">{hint}</p>}
        {state !== "error" && message && <p className="text-[12px] text-[#8C8676]">{message}</p>}
      </div>
    </div>
  );
}

/** Five bars that follow the mic level (static heights under reduced motion are fine: they only move with input). */
function Bars({ level }: { level: number }) {
  const shape = [0.45, 0.75, 1, 0.75, 0.45];
  return (
    <span aria-hidden className="flex h-7 items-center gap-[3px]">
      {shape.map((k, i) => (
        <span
          key={i}
          className="w-[4px] rounded-full bg-white transition-[height] duration-75 ease-out motion-reduce:transition-none"
          style={{ height: `${Math.round(6 + Math.min(1, level * 1.3) * k * 22)}px` }}
        />
      ))}
    </span>
  );
}
