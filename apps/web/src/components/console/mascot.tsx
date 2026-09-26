"use client";

/**
 * The Darwin crew as animated SVGs (public/mascots/{kind}-{state}.svg, from the mascot pack).
 *
 * - One file per kind × state; `idle` renders a still pose ({kind}-still.svg) so resting mascots stay calm.
 *   Pass `lively` to use the gently breathing idle instead.
 * - Tap / click plays the one-shot `tapped` reaction (1.4s) and returns to `state`.
 * - Each SVG stops its own animation under prefers-reduced-motion.
 * - Plain <img>: next/image would rasterise the SVG and drop its CSS animation.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type MascotKind = "observer" | "designer" | "analyst" | "experimenter" | "shipper";
export type MascotState = "idle" | "working" | "thinking" | "success" | "error" | "sleeping";

export const MASCOT_KINDS: readonly MascotKind[] = ["observer", "designer", "analyst", "experimenter", "shipper"];

const LABELS: Record<MascotKind, string> = {
  observer: "Observer",
  designer: "Designer",
  analyst: "Darwin",
  experimenter: "Experimenter",
  shipper: "Shipper",
};

/** The body colour of each mascot, for accents (progress bars, dots, tab underlines). */
export const MASCOT_COLOR: Record<MascotKind, string> = {
  observer: "#2F7BF0",
  designer: "#F07A1E",
  analyst: "#7B55E8",
  experimenter: "#E0529A",
  shipper: "#1FB57A",
};

/** Soft tint of each mascot's colour, for bubbles and chips. */
export const MASCOT_TINT: Record<MascotKind, string> = {
  observer: "#E3ECFB",
  designer: "#FCE9D8",
  analyst: "#ECE6FB",
  experimenter: "#FBE3EF",
  shipper: "#DDF3E8",
};

const TAP_MS = 1400;

export function isMascotKind(v: unknown): v is MascotKind {
  return typeof v === "string" && (MASCOT_KINDS as readonly string[]).includes(v);
}

export interface MascotProps {
  kind: MascotKind;
  state?: MascotState;
  /** Square size in px. The art fills ~75% of the box, leaving room for hops and particles. */
  size?: number;
  /** Tap plays the reaction. Default true. When false the mascot is decorative. */
  interactive?: boolean;
  /** Idle breathes gently instead of holding still. */
  lively?: boolean;
  onClick?: () => void;
  className?: string;
  /** Accessible name. Defaults to the role name; decorative mascots (interactive=false) are hidden from screen readers. */
  label?: string;
}

export function Mascot({ kind, state = "idle", size = 40, interactive = true, lively = false, onClick, className, label }: MascotProps) {
  const [tap, setTap] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const handleTap = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setTap(Date.now());
    timer.current = setTimeout(() => setTap(0), TAP_MS);
    onClick?.();
  }, [onClick]);

  const file = tap ? `tapped.svg?t=${tap}` : state === "idle" && !lively ? "still.svg" : `${state}.svg`;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay a plain <img>
    <img
      key={tap ? `t${tap}` : state}
      src={`/mascots/${kind}-${file}`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={{ display: "block", width: size, height: size, userSelect: "none", pointerEvents: "none" }}
    />
  );

  if (!interactive) {
    return (
      <span className={className} style={{ display: "inline-block", lineHeight: 0, flexShrink: 0 }} aria-hidden>
        {img}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label={label ?? `${LABELS[kind]}: say hi`}
      className={`inline-block shrink-0 cursor-pointer rounded-[30%] border-0 bg-transparent p-0 leading-[0] [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413] ${className ?? ""}`}
    >
      {img}
    </button>
  );
}
