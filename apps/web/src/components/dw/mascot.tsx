/**
 * The Darwin team's mascots, in the cream Darwin design. `<Mascot>` renders the animated set
 * (components/mascots, public/mascots) and keeps this file's old API, so every screen uses the same characters:
 *
 *   leader        red crowned squircle   Darwin, the team lead (and the logo)
 *   observer      blue clover            Iris: watches shoppers, dashboards, research
 *   designer      orange cog             Pixel: edits pages and code
 *   experimenter  pink drop              Fizz: runs A/B tests
 *   shipper       green diamond          Dash: ships pull requests
 *   analyst       purple side-eye disc   the original Darwin mark, now a generic persona avatar
 *
 * `frame` draws a liquid-glass squircle around it. `Silhouette` / `mascotBody` are the static body outlines.
 */
import type { MascotKind, MascotState } from "@/lib/contracts/team";
import { AnimatedMascot, mascotName } from "@/components/mascots/animated-mascot";

export type { MascotKind, MascotState };

export const MASCOT_SHADE: Record<MascotKind, [string, string, string]> = {
  leader: ["#ff7a7a", "#e23b3b", "#b81f2e"],
  observer: ["#4aa2ff", "#2f86ff", "#1c66e0"],
  designer: ["#ff9a3d", "#ff7a1c", "#ec5f00"],
  experimenter: ["#ff8fc4", "#f0579e", "#d63a84"],
  shipper: ["#5ff0b4", "#22d18b", "#0fae6f"],
  analyst: ["#a77bff", "#8e5cff", "#7440f0"],
};

const n2 = (v: number) => Math.round(v * 100) / 100;
const rad = (d: number) => (d * Math.PI) / 180;
const circle = (cx: number, cy: number, r: number) => `M${n2(cx)} ${n2(cy - r)}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
function clover(a: number, r: number) {
  const k = Math.sqrt(r * r - a * a);
  const d = n2(50 - a - k);
  const e = n2(50 + a + k);
  const arc = `A${r} ${r} 0 ${a > k ? 1 : 0} 1`;
  return `M50 ${d}${arc} ${e} 50${arc} 50 ${e}${arc} ${d} 50${arc} 50 ${d}Z`;
}
function cog(n: number, root: number, tip: number, tipHalf: number, rootHalf: number) {
  const at = (r: number, deg: number) => `${n2(50 + r * Math.cos(rad(deg)))} ${n2(50 + r * Math.sin(rad(deg)))}`;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = -90 + (i * 360) / n;
    pts.push(at(root, t - rootHalf), at(tip, t - tipHalf), at(tip, t + tipHalf), at(root, t + rootHalf), at(root, t + 180 / n));
  }
  return `M${pts.join("L")}Z`;
}

/** Just the body outline of a kind (for big faint card silhouettes). */
export function mascotBody(kind: MascotKind): string {
  switch (kind) {
    case "observer":
      return clover(14, 31);
    case "designer":
      return cog(8, 36, 44.5, 10, 15);
    case "experimenter":
      return "M50 6C62 6 71 22 79 36C88 52 92 64 88 76C84 88 70 96 50 96C30 96 16 88 12 76C8 64 12 52 21 36C29 22 38 6 50 6Z";
    case "leader":
      return "M50 16C80 16 94 28 94 57C94 85 79 96 50 96C21 96 6 85 6 57C6 28 20 16 50 16Z";
    case "shipper":
      return "M50 4C56 4 60 7 64 11L89 36C93 40 96 44 96 50C96 56 93 60 89 64L64 89C60 93 56 96 50 96C44 96 40 93 36 89L11 64C7 60 4 56 4 50C4 44 7 40 11 36L36 11C40 7 44 4 50 4Z";
    default:
      return circle(50, 50, 45);
  }
}

/** Old art filled ~83% of its box; the animated SVGs leave room for hops, crowns and confetti (body ~61%). */
const SCALE = 1.3;
const FRAME_SCALE = 0.92;

/**
 * A team mascot at `size` px. Renders the animated SVGs (components/mascots) sized so the body matches the
 * old static art, so layouts don't move. `active` rests with slow breathing and blinks; `active={false}` holds
 * the pose still; `state` plays a real state (thinking while Darwin composes, working while a step runs…).
 * A click always plays the tap reaction, without taking over the click (links and buttons around it still work).
 */
export function Mascot({
  kind = "leader",
  size = 64,
  active = true,
  state,
  frame = false,
  className,
  title,
}: {
  kind?: MascotKind;
  size?: number;
  active?: boolean;
  /** What the agent is doing now; overrides `active`. */
  state?: MascotState;
  frame?: boolean;
  className?: string;
  title?: string;
}) {
  const shade = MASCOT_SHADE[kind];
  const box = Math.round(size * (frame ? FRAME_SCALE : SCALE));
  const art = (
    <AnimatedMascot
      kind={kind}
      state={state ?? "idle"}
      still={!state && !active}
      size={box}
      tapOnClick
      title={title ?? mascotName(kind)}
      style={{ position: "absolute", left: (size - box) / 2, top: (size - box) / 2 - (kind === "leader" ? 0 : Math.round(box * 0.04)) }}
    />
  );

  if (!frame) {
    return (
      <div className={className} style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        {art}
      </div>
    );
  }
  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size * 0.36),
        background: "linear-gradient(150deg, rgba(255,255,255,0.78), rgba(255,255,255,0.28) 55%, rgba(255,255,255,0.5))",
        WebkitBackdropFilter: "blur(14px) saturate(170%)",
        backdropFilter: "blur(14px) saturate(170%)",
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(255,255,255,0.4), inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 0.5px rgba(20,20,19,0.08), 0 ${Math.round(size / 8)}px ${Math.round(size / 3.5)}px rgba(20,20,19,0.14)`,
      }}
    >
      <span
        aria-hidden
        style={{ position: "absolute", left: "12%", right: "12%", bottom: "6%", height: "45%", borderRadius: 999, background: shade[1], opacity: 0.28, filter: `blur(${Math.round(size / 7)}px)`, pointerEvents: "none" }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          top: "4%",
          height: "38%",
          borderRadius: `${Math.round(size * 0.3)}px ${Math.round(size * 0.3)}px 50% 50%`,
          background: "linear-gradient(to bottom, rgba(255,255,255,0.75), rgba(255,255,255,0))",
          pointerEvents: "none",
        }}
      />
      {art}
    </div>
  );
}

/** A big faint mascot body bleeding off a card corner (the card's `*-shape` colour). */
export function Silhouette({ kind, color, size = 260, className, style }: { kind: MascotKind; color: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg aria-hidden viewBox="-4 -4 108 108" width={size} height={size} className={`dw-silhouette pointer-events-none absolute ${className ?? ""}`} style={style}>
      <path d={mascotBody(kind)} fill={color} />
    </svg>
  );
}
