/**
 * The Darwin crew (from the design handoff's Mascot.dc.html): five SVG characters with a 3D look
 * (radial-gradient body, bottom shade, specular highlight).
 *
 *   observer      Iris, blue clover with antenna   (Watcher: finds where shoppers get stuck)
 *   analyst       Darwin, purple side-eye disc     (Lead: talks to you; also the Darwin logo)
 *   designer      Theo, orange cog                 (Designer: drafts page changes)
 *   experimenter  Ada, pink drop                   (Tester: runs A vs B tests)
 *   shipper       Max, green rounded diamond       (Shipper: ships winners as code changes)
 *
 * `frame` draws a liquid-glass squircle around it; `active` makes it bob and blink.
 */
import { useId } from "react";

export type MascotKind = "observer" | "analyst" | "designer" | "experimenter" | "shipper";

/** Crew names (see the style brief): Darwin leads; the others have their own names and roles. */
export const CREW_NAMES: Record<MascotKind, string> = { observer: "Iris", analyst: "Darwin", designer: "Theo", experimenter: "Ada", shipper: "Max" };
export const CREW_ROLES: Record<MascotKind, string> = { observer: "Watcher", analyst: "Lead", designer: "Designer", experimenter: "Tester", shipper: "Shipper" };
const NAMES = CREW_NAMES;

export const MASCOT_SHADE: Record<MascotKind, [string, string, string]> = {
  observer: ["#4aa2ff", "#2f86ff", "#1c66e0"],
  designer: ["#ff9a3d", "#ff7a1c", "#ec5f00"],
  experimenter: ["#ff8fc4", "#f0579e", "#d63a84"],
  shipper: ["#5ff0b4", "#22d18b", "#0fae6f"],
  analyst: ["#a77bff", "#8e5cff", "#7440f0"],
};

const n2 = (v: number) => Math.round(v * 100) / 100;
const rad = (d: number) => (d * Math.PI) / 180;
const circle = (cx: number, cy: number, r: number) => `M${n2(cx)} ${n2(cy - r)}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
const pill = (cx: number, cy: number, w: number, h: number) =>
  `M${n2(cx - w / 2)} ${n2(cy - h / 2 + w / 2)}a${w / 2} ${w / 2} 0 0 1 ${w} 0v${n2(h - w)}a${w / 2} ${w / 2} 0 0 1 ${-w} 0Z`;
const lidded = (cx: number, cy: number, r: number) => `M${n2(cx - r)} ${cy}H${n2(cx + r)}A${r} ${r} 0 0 1 ${n2(cx - r)} ${cy}Z`;
const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
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
    case "shipper":
      return "M50 4C56 4 60 7 64 11L89 36C93 40 96 44 96 50C96 56 93 60 89 64L64 89C60 93 56 96 50 96C44 96 40 93 36 89L11 64C7 60 4 56 4 50C4 44 7 40 11 36L36 11C40 7 44 4 50 4Z";
    default:
      return circle(50, 50, 45);
  }
}

interface Layer {
  d: string;
  fill?: string;
  stroke?: string;
  w?: number;
  eyes?: boolean;
  op?: number;
}

export function Mascot({
  kind = "analyst",
  size = 64,
  active = true,
  frame = false,
  className,
  title,
}: {
  kind?: MascotKind;
  size?: number;
  active?: boolean;
  frame?: boolean;
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const inner = frame ? Math.round(size * 0.7) : size;
  const simple = inner < 20;
  const shade = MASCOT_SHADE[kind];
  const BODY = `url(#dm-body-${uid})`;
  const SH = `url(#dm-sh-${uid})`;
  const HI = `url(#dm-hi-${uid})`;
  const W = "#ffffff";
  const L = (d: string, fill?: string, stroke?: string, w?: number, eyes?: boolean, op?: number): Layer => ({ d, fill, stroke, w, eyes, op });
  const depth = (body: string, hx: number, hy: number): Layer[] =>
    simple ? [] : [L(body, SH), L(ell(hx, hy, 15, 8), HI, undefined, 0, false, 0.9), L(ell(hx - 3, hy - 1, 5, 2.6), "#FFFFFF", undefined, 0, false, 0.8)];

  let layers: Layer[];
  if (kind === "observer") {
    const body = clover(14, 31);
    const dimple = 50 - 14 - Math.sqrt(31 * 31 - 14 * 14);
    const stalk = `M50 ${n2(dimple + 4)}L50 -1`;
    const ball = circle(50, -1, 5);
    layers = simple
      ? [L(body, W, W, 11), L(body, BODY), L(pill(37, 46, 12, 18) + pill(63, 46, 12, 18), W, undefined, 0, true)]
      : [
          L(body, W, W, 11),
          L(stalk, undefined, W, 15),
          L(ball, W, W, 11),
          L(stalk, undefined, "#1d63d8", 4.5),
          L(ball, "#ffd23f"),
          L(body, BODY),
          ...depth(body, 36, 30),
          L(pill(39, 45, 11, 20) + pill(61, 45, 11, 20), W, undefined, 0, true),
          L(circle(50, 67, 4.5), W),
        ];
  } else if (kind === "designer") {
    const gear = cog(8, 36, 44.5, 10, 15);
    layers = simple
      ? [L(gear, W, W, 16), L(gear, BODY, BODY, 5), L("M29 45L43 47.5M71 45L57 47.5", undefined, W, 10, true)]
      : [L(gear, W, W, 16), L(gear, BODY, BODY, 5), ...depth(gear, 36, 30), L("M31 43.5L44 45.5M69 43.5L56 45.5", undefined, W, 7, true), L("M35 56H65A15 15 0 0 1 35 56Z", W, W, 2)];
  } else if (kind === "experimenter") {
    const drop = mascotBody("experimenter");
    layers = simple
      ? [L(drop, W, W, 11), L(drop, BODY), L(circle(37, 58, 7) + circle(63, 58, 7), W, undefined, 0, true)]
      : [
          L(drop, W, W, 11),
          L(drop, BODY),
          ...depth(drop, 40, 34),
          L(circle(37, 56, 8.5) + circle(63, 56, 8.5), W, undefined, 0, true),
          L(circle(39, 53.5, 4) + circle(65, 53.5, 4), "#5a0f33", undefined, 0, true),
          L(circle(50, 76, 4.5), W),
        ];
  } else if (kind === "shipper") {
    const sq = mascotBody("shipper");
    layers = simple
      ? [L(sq, W, W, 11), L(sq, BODY), L("M33 47Q38 41 43 47M57 47Q62 41 67 47", undefined, W, 7, true)]
      : [L(sq, W, W, 11), L(sq, BODY), ...depth(sq, 38, 26), L("M33 46Q38 40 43 46M57 46Q62 40 67 46", undefined, W, 5.5, true), L("M38 60Q50 72 62 60", undefined, W, 5.5)];
  } else {
    const disc = circle(50, 50, 45);
    layers = simple
      ? [L(disc, W, W, 11), L(disc, BODY), L(lidded(35, 44, 13) + lidded(65, 44, 13), W, undefined, 0, true)]
      : [
          L(disc, W, W, 11),
          L(disc, BODY),
          ...depth(disc, 34, 24),
          L(lidded(36, 45, 10) + lidded(64, 45, 10), W, undefined, 0, true),
          L(circle(41.5, 49, 4.3) + circle(69.5, 49, 4.3), "#34198a", undefined, 0, true),
          L("M56 33.5L72 28.5", undefined, W, 5.5),
          L("M52 69.5L62 68", undefined, W, 5.5),
        ];
  }

  const svg = (
    <div
      style={{
        position: "relative",
        width: inner,
        height: inner,
        flexShrink: 0,
        filter: `drop-shadow(0 ${Math.max(1, Math.round(size / 40))}px ${Math.max(1, Math.round(size / 30))}px rgba(20,26,74,0.18))`,
      }}
    >
      <div className={active ? "dm-bob" : undefined} style={{ width: "100%", height: "100%" }}>
        <svg className={active ? "dm-live" : undefined} width="100%" height="100%" viewBox="-4 -4 108 108" style={{ overflow: "visible" }} aria-hidden>
          <defs>
            <radialGradient id={`dm-body-${uid}`} cx=".36" cy=".28" r=".8">
              <stop offset="0" stopColor={shade[0]} />
              <stop offset=".6" stopColor={shade[1]} />
              <stop offset="1" stopColor={shade[2]} />
            </radialGradient>
            <linearGradient id={`dm-sh-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset=".45" stopColor="#0B0F3A" stopOpacity="0" />
              <stop offset="1" stopColor="#0B0F3A" stopOpacity=".28" />
            </linearGradient>
            <radialGradient id={`dm-hi-${uid}`} cx=".5" cy=".5" r=".5">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity=".85" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </radialGradient>
          </defs>
          {layers.map((l, i) => (
            <path
              key={i}
              className={l.eyes ? "dm-eyes" : undefined}
              d={l.d}
              fill={l.fill ?? "none"}
              stroke={l.stroke ?? "none"}
              strokeWidth={l.w ?? 0}
              opacity={l.op ?? 1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
    </div>
  );

  if (!frame) {
    return (
      <div role="img" aria-label={title ?? NAMES[kind]} className={className} style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        {svg}
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={title ?? NAMES[kind]}
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
      {svg}
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
