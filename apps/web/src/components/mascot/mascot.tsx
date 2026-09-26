"use client";

/**
 * Animated crew mascot. Each pose is its own SVG under /mascots so the 42 files stay out of the JS bundle.
 * Tap plays the 1.4s one-shot, then returns to `state`. prefers-reduced-motion is handled inside each SVG.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { cn } from "@/components/ui/cn";
import { chatMascotState, type MascotKind, type MascotState } from "@/lib/mascot/state";

export type { MascotKind, MascotState };

const LABELS: Record<MascotKind, string> = {
  leader: "Darwin",
  observer: "Observer",
  designer: "Designer",
  analyst: "Analyst",
  experimenter: "Experimenter",
  shipper: "Shipper",
};

/** Length of the one-shot inside {kind}-tapped.svg */
const TAP_MS = 1400;
const SUCCESS_MS = 1600;
const ERROR_MS = 2200;

export interface MascotProps {
  kind?: MascotKind;
  /** What the character is doing. Defaults to idle (the SVG still breathes). */
  state?: MascotState;
  /** Square size in px. The art fills ~75% so hops and particles are not clipped. */
  size?: number;
  /** Folder of flat `{kind}-{state}.svg` files. */
  basePath?: string;
  /** Tap plays the reaction. Turn off inside another button or link whose click should win. */
  interactive?: boolean;
  onTap?: () => void;
  className?: string;
  alt?: string;
  title?: string;
  /** Glass squircle, matching the cream console's framed crew. */
  frame?: boolean;
  /**
   * Kept so existing call sites still typecheck. The idle SVG animates on its own;
   * pass `state` for working / thinking / success / error / sleeping.
   */
  active?: boolean;
}

export function Mascot({
  kind = "analyst",
  state = "idle",
  size = 64,
  basePath = "/mascots",
  interactive = true,
  onTap,
  className,
  alt,
  title,
  frame = false,
}: MascotProps) {
  const [tap, setTap] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleTap = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!interactive) return;
      if (timer.current) clearTimeout(timer.current);
      const nonce = Date.now();
      setTap(nonce);
      timer.current = setTimeout(() => setTap(0), TAP_MS);
      onTap?.();
    },
    [interactive, onTap],
  );

  const stop = (event: PointerEvent) => {
    event.stopPropagation();
  };

  const tapping = tap > 0;
  const shown: MascotState | "tapped" = tapping ? "tapped" : state;
  const src = tapping ? `${basePath}/${kind}-tapped.svg?t=${tap}` : `${basePath}/${kind}-${state}.svg`;
  const label = alt ?? title ?? `${LABELS[kind]}, ${shown}`;
  const art = frame ? Math.round(size * 0.78) : size;

  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay a plain img; next/image would rasterise it
    <img
      key={tapping ? `tap-${tap}` : `state-${state}`}
      src={src}
      width={art}
      height={art}
      alt={label}
      draggable={false}
      style={{ display: "block", width: art, height: art, userSelect: "none" }}
    />
  );

  const frameStyle = frame
    ? {
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: Math.round(size * 0.36),
        background: "linear-gradient(150deg, rgba(255,255,255,0.78), rgba(255,255,255,0.28) 55%, rgba(255,255,255,0.5))",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.95), inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 0.5px rgba(20,20,19,0.08), 0 8px 18px rgba(20,20,19,0.12)",
      }
    : { display: "inline-block", lineHeight: 0, width: size, height: size };

  if (!interactive) {
    return (
      <span className={cn("relative inline-block shrink-0", className)} style={frameStyle} data-mascot={kind} data-state={shown} title={title}>
        {img}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleTap}
      onPointerDown={stop}
      aria-label={`${LABELS[kind]}: tap to say hi`}
      title={title ?? LABELS[kind]}
      data-mascot={kind}
      data-state={shown}
      className={cn("relative inline-block shrink-0 cursor-pointer border-0 bg-transparent p-0", className)}
      style={{ ...frameStyle, WebkitTapHighlightColor: "transparent" }}
    >
      {img}
    </button>
  );
}

/**
 * Header avatar for Ask Darwin. Thinking while `busy`, then a short success or error, then idle.
 * Rapid send/receive cycles restart the timer.
 */
export function useChatMascot(busy: boolean, failed: boolean): MascotState {
  const [settled, setSettled] = useState<MascotState>("idle");
  const wasBusy = useRef(false);

  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const next = chatMascotState({ failed, justReplied: !failed });
    setSettled(next);
    if (next === "idle") return;
    const timer = setTimeout(() => setSettled("idle"), next === "error" ? ERROR_MS : SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [busy, failed]);

  if (busy) return "thinking";
  return settled;
}

export default Mascot;
