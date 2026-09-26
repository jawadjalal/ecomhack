"use client";

/**
 * The Darwin team mascots, animated (public/mascots/{kind}-{state}.svg, from the design handoff).
 *
 *   leader        red crowned squircle   Darwin, the team lead (also the logo)
 *   observer      blue clover            Iris
 *   designer      orange cog             Pixel
 *   experimenter  pink drop              Fizz
 *   shipper       green diamond          Dash
 *   analyst       purple side-eye disc   (the original Darwin mark, kept for old screens)
 *
 * Resting is deliberately quiet (slow breathing, blinks, the odd glance: see scripts/mascots/calm-idle.mjs).
 * The big moves only play when something happens:
 *   - `state` is what the agent is doing now: thinking (after you send a message), working, success, error, sleeping.
 *   - tapping an `interactive` mascot plays its one-shot "tapped" reaction, then it settles back.
 *   - `flash` plays a state once (e.g. success after a step), then it settles back to `state`.
 *
 * The SVG is inlined (fetched once per file, cached) with its class/id/keyframe prefix made unique per
 * instance, so every copy animates on its own clock and one-shots restart on each play. Until the text
 * arrives (first paint, SSR) a plain <img> of the same file shows, so there is never a blank frame.
 * prefers-reduced-motion stops every animation (the SVGs carry the rule, scoped here to the mascot).
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { MascotKind, MascotState } from "@/lib/contracts/team";
import { TEAM } from "@/lib/team/roster";
import { cn } from "@/components/ui/cn";

export type { MascotKind, MascotState };

/** How long a one-shot plays before settling back (ms). */
const ONE_SHOT_MS: Partial<Record<MascotState, number>> = { tapped: 1400, success: 2600, error: 2600 };

/** Default accessible names: the team member who wears each mascot (the analyst disc isn't on the team). */
const NAMES: Record<MascotKind, string> = {
  analyst: "Analyst",
  ...(Object.fromEntries(TEAM.map((a) => [a.mascot, `${a.name}, ${a.role.toLowerCase()}`])) as Partial<Record<MascotKind, string>>),
} as Record<MascotKind, string>;

export const mascotName = (kind: MascotKind) => NAMES[kind];

const STATES: MascotState[] = ["idle", "thinking", "working", "success", "error", "sleeping", "tapped"];

export const mascotSrc = (kind: MascotKind, state: MascotState) => `/mascots/${kind}-${state}.svg`;

/* ------------------------------------------------------------------ svg cache */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function load(src: string): Promise<string> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(src);
  if (!p) {
    p = fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${src} → ${r.status}`))))
      .then((text) => {
        cache.set(src, text);
        return text;
      })
      .finally(() => inflight.delete(src));
    inflight.set(src, p);
  }
  return p;
}

/** Warm every state of these kinds, so state changes swap instantly. */
export function preloadMascots(kinds: MascotKind[]) {
  if (typeof window === "undefined") return;
  for (const k of kinds) for (const s of STATES) void load(mascotSrc(k, s)).catch(() => {});
}

let seq = 0;

/** Make every class, id and keyframe unique to this copy; size it to its box; scope reduced-motion to it. */
function prepare(svg: string, scope: string): string {
  const n = (++seq).toString(36);
  return svg
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/\b(dm[a-z]-[a-z]{2}-)/g, `$1${n}-`)
    .replace(/<svg ([^>]*?)width="\d+" height="\d+" role="img" aria-label="[^"]*"/, `<svg $1width="100%" height="100%" aria-hidden="true" focusable="false"`)
    .replace(/@media \(prefers-reduced-motion:\s?reduce\)\{\*\{/g, `@media (prefers-reduced-motion:reduce){.${scope} *{`);
}

/* ------------------------------------------------------------------ component */

export interface AnimatedMascotProps {
  kind: MascotKind;
  /** What the agent is doing now. Default idle (calm). */
  state?: MascotState;
  /** Box size in px. The body fills ~75% of it (room for hops, crowns and particles). */
  size?: number;
  /** Tap (click / Enter / Space) plays the one-shot reaction. Renders a button. */
  interactive?: boolean;
  /** Not a button, but a click still plays the reaction (for mascots inside links, cards and buttons). */
  tapOnClick?: boolean;
  /** Hold the resting pose with no motion (a click still plays the reaction). */
  still?: boolean;
  onTap?: () => void;
  /** Change `key` to play `state` once (tapped / success / error), then settle back. */
  flash?: { state: MascotState; key: string | number };
  /** Accessible name (default: the kind's name). */
  title?: string;
  /** Hide from assistive tech (when a visible name sits next to it). */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function AnimatedMascot({ kind, state = "idle", size = 64, interactive, tapOnClick, still, onTap, flash, title, decorative, className, style }: AnimatedMascotProps) {
  const scope = `dmm-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // A one-shot playing over `state`: which state, and a counter so replays restart the animation.
  const [shot, setShot] = useState<{ state: MascotState; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const play = (s: MascotState) => {
    clearTimeout(timer.current);
    setShot((prev) => ({ state: s, n: (prev?.n ?? 0) + 1 }));
    timer.current = setTimeout(() => setShot(null), ONE_SHOT_MS[s] ?? 2400);
  };

  const flashKey = flash?.key;
  const flashState = flash?.state;
  useEffect(() => {
    if (flashKey === undefined || !flashState) return;
    // Deferred a tick: a flash is an event, not render state.
    const t = setTimeout(() => play(flashState), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const shown = shot?.state ?? state;
  const src = mascotSrc(kind, shown);

  // The inlined SVG for `src` (one-shots re-prepared on each play so they restart).
  const [svg, setSvg] = useState<{ src: string; n: number; html: string } | null>(null);
  const n = shot?.n ?? 0;
  useEffect(() => {
    let live = true;
    load(src).then(
      (text) => live && setSvg({ src, n, html: prepare(text, scope) }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [src, n, scope]);

  useEffect(() => preloadMascots([kind]), [kind]);

  // `svg` only changes once the next file is ready, so a state change never flashes an empty box.
  // Before the first file arrives (SSR, first paint) the plain <img> shows instead.
  const body = svg ? (
    <span className="block size-full" dangerouslySetInnerHTML={{ __html: svg.html }} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} draggable={false} className="block size-full select-none" />
  );

  const name = title ?? NAMES[kind];
  const box: CSSProperties = { width: size, height: size, ...style };
  const cls = cn(scope, "relative inline-block shrink-0 leading-none", still && !shot && "[&_*]:animate-none!", className);

  if (!interactive) {
    return (
      <span
        className={cls}
        style={box}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : name}
        aria-hidden={decorative || undefined}
        onClick={
          tapOnClick
            ? () => {
                play("tapped");
                onTap?.();
              }
            : undefined
        }
      >
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={decorative ? undefined : `${name}: tap to say hi`}
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      onClick={() => {
        play("tapped");
        onTap?.();
      }}
      className={cn(
        cls,
        "cursor-pointer rounded-[32%] transition-transform duration-200 ease-out [-webkit-tap-highlight-color:transparent] hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:scale-100",
      )}
      style={box}
    >
      {body}
    </button>
  );
}
