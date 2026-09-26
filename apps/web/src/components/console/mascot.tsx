/**
 * The Darwin crew (design handoff, source/Mascot.dc.html) as SVG: observer (blue clover), designer
 * (orange cog), analyst (purple side-eye disc, also the Darwin logo), experimenter (pink drop) and
 * shipper (green rounded diamond). Radial-gradient body, bottom shade, soft specular highlight.
 * `active` bobs and blinks (off under prefers-reduced-motion; see MASCOT_CSS).
 */
import { cn } from "@/components/ui/cn";

export type MascotKind = "observer" | "analyst" | "designer" | "experimenter" | "shipper";

export const MASCOT_CSS = `@keyframes dm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4%)}}
@keyframes dm-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(0.12)}}
.dm-bob{animation:dm-bob 2.6s ease-in-out infinite}
.dm-eyes{transform-box:fill-box;transform-origin:center}
.dm-live .dm-eyes{animation:dm-blink 4.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.dm-bob,.dm-live .dm-eyes{animation:none}}`;

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

interface Layer {
  d: string;
  fill?: string;
  stroke?: string;
  w?: number;
  eyes?: boolean;
  op?: number;
}

const SHADES: Record<MascotKind, [string, string, string]> = {
  observer: ["#4aa2ff", "#2f86ff", "#1c66e0"],
  designer: ["#ff9a3d", "#ff7a1c", "#ec5f00"],
  experimenter: ["#ff8fc4", "#f0579e", "#d63a84"],
  shipper: ["#5ff0b4", "#22d18b", "#0fae6f"],
  analyst: ["#a77bff", "#8e5cff", "#7440f0"],
};

const NAMES: Record<MascotKind, string> = { observer: "Observer", analyst: "Darwin", designer: "Designer", experimenter: "Experimenter", shipper: "Shipper" };

function layersFor(kind: MascotKind, simple: boolean): Layer[] {
  const W = "#ffffff";
  const BODY = `url(#dm-shade-${kind})`;
  const SH = `url(#dm-sh-${kind})`;
  const HI = `url(#dm-hi-${kind})`;
  const depth = (body: string, hx: number, hy: number): Layer[] =>
    simple ? [] : [{ d: body, fill: SH }, { d: ell(hx, hy, 15, 8), fill: HI, op: 0.9 }, { d: ell(hx - 3, hy - 1, 5, 2.6), fill: W, op: 0.8 }];
  switch (kind) {
    case "observer": {
      const body = clover(14, 31);
      const dimple = 50 - 14 - Math.sqrt(31 * 31 - 14 * 14);
      const stalk = `M50 ${n2(dimple + 4)}L50 -1`;
      const ball = circle(50, -1, 5);
      return simple
        ? [{ d: body, fill: W, stroke: W, w: 11 }, { d: body, fill: BODY }, { d: pill(37, 46, 12, 18) + pill(63, 46, 12, 18), fill: W, eyes: true }]
        : [
            { d: body, fill: W, stroke: W, w: 11 },
            { d: stalk, stroke: W, w: 15 },
            { d: ball, fill: W, stroke: W, w: 11 },
            { d: stalk, stroke: "#1d63d8", w: 4.5 },
            { d: ball, fill: "#ffd23f" },
            { d: body, fill: BODY },
            ...depth(body, 36, 30),
            { d: pill(39, 45, 11, 20) + pill(61, 45, 11, 20), fill: W, eyes: true },
            { d: circle(50, 67, 4.5), fill: W },
          ];
    }
    case "designer": {
      const gear = cog(8, 36, 44.5, 10, 15);
      return simple
        ? [{ d: gear, fill: W, stroke: W, w: 16 }, { d: gear, fill: BODY, stroke: BODY, w: 5 }, { d: "M29 45L43 47.5M71 45L57 47.5", stroke: W, w: 10, eyes: true }]
        : [
            { d: gear, fill: W, stroke: W, w: 16 },
            { d: gear, fill: BODY, stroke: BODY, w: 5 },
            ...depth(gear, 36, 30),
            { d: "M31 43.5L44 45.5M69 43.5L56 45.5", stroke: W, w: 7, eyes: true },
            { d: "M35 56H65A15 15 0 0 1 35 56Z", fill: W, stroke: W, w: 2 },
          ];
    }
    case "experimenter": {
      const drop = "M50 6C62 6 71 22 79 36C88 52 92 64 88 76C84 88 70 96 50 96C30 96 16 88 12 76C8 64 12 52 21 36C29 22 38 6 50 6Z";
      return simple
        ? [{ d: drop, fill: W, stroke: W, w: 11 }, { d: drop, fill: BODY }, { d: circle(37, 58, 7) + circle(63, 58, 7), fill: W, eyes: true }]
        : [
            { d: drop, fill: W, stroke: W, w: 11 },
            { d: drop, fill: BODY },
            ...depth(drop, 40, 34),
            { d: circle(37, 56, 8.5) + circle(63, 56, 8.5), fill: W, eyes: true },
            { d: circle(39, 53.5, 4) + circle(65, 53.5, 4), fill: "#5a0f33", eyes: true },
            { d: circle(50, 76, 4.5), fill: W },
          ];
    }
    case "shipper": {
      const sq = "M50 4C56 4 60 7 64 11L89 36C93 40 96 44 96 50C96 56 93 60 89 64L64 89C60 93 56 96 50 96C44 96 40 93 36 89L11 64C7 60 4 56 4 50C4 44 7 40 11 36L36 11C40 7 44 4 50 4Z";
      return simple
        ? [{ d: sq, fill: W, stroke: W, w: 11 }, { d: sq, fill: BODY }, { d: "M33 47Q38 41 43 47M57 47Q62 41 67 47", stroke: W, w: 7, eyes: true }]
        : [
            { d: sq, fill: W, stroke: W, w: 11 },
            { d: sq, fill: BODY },
            ...depth(sq, 38, 26),
            { d: "M33 46Q38 40 43 46M57 46Q62 40 67 46", stroke: W, w: 5.5, eyes: true },
            { d: "M38 60Q50 72 62 60", stroke: W, w: 5.5 },
          ];
    }
    default: {
      const disc = circle(50, 50, 45);
      return simple
        ? [{ d: disc, fill: W, stroke: W, w: 11 }, { d: disc, fill: BODY }, { d: lidded(35, 44, 13) + lidded(65, 44, 13), fill: W, eyes: true }]
        : [
            { d: disc, fill: W, stroke: W, w: 11 },
            { d: disc, fill: BODY },
            ...depth(disc, 34, 24),
            { d: lidded(36, 45, 10) + lidded(64, 45, 10), fill: W, eyes: true },
            { d: circle(41.5, 49, 4.3) + circle(69.5, 49, 4.3), fill: "#34198a", eyes: true },
            { d: "M56 33.5L72 28.5", stroke: W, w: 5.5 },
            { d: "M52 69.5L62 68", stroke: W, w: 5.5 },
          ];
    }
  }
}

export function Mascot({ kind = "analyst", size = 32, active = false, className }: { kind?: MascotKind; size?: number; active?: boolean; className?: string }) {
  const [s0, s1, s2] = SHADES[kind];
  const layers = layersFor(kind, size < 20);
  return (
    <span
      role="img"
      aria-label={NAMES[kind]}
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size, filter: `drop-shadow(0 ${Math.max(1, Math.round(size / 40))}px ${Math.max(1, Math.round(size / 30))}px rgba(20,26,74,0.18))` }}
    >
      <span className={cn("block size-full", active && "dm-bob")}>
        <svg className={active ? "dm-live" : undefined} width="100%" height="100%" viewBox="-4 -4 108 108" style={{ overflow: "visible" }} aria-hidden>
          <defs>
            <radialGradient id={`dm-shade-${kind}`} cx=".36" cy=".28" r=".8">
              <stop offset="0" stopColor={s0} />
              <stop offset=".6" stopColor={s1} />
              <stop offset="1" stopColor={s2} />
            </radialGradient>
            <linearGradient id={`dm-sh-${kind}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset=".45" stopColor="#0B0F3A" stopOpacity="0" />
              <stop offset="1" stopColor="#0B0F3A" stopOpacity=".28" />
            </linearGradient>
            <radialGradient id={`dm-hi-${kind}`} cx=".5" cy=".5" r=".5">
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
      </span>
    </span>
  );
}
