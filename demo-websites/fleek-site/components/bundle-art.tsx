/**
 * Original product imagery: a flat-lay "bundle" of garments drawn in SVG from the catalog's colours.
 * No photos: every bundle and category image on the site is generated here.
 */
import { useId } from "react";
import type { Garment } from "@/lib/catalog";

const LONG_SLEEVE = "M30 18 L42 12 Q50 18 58 12 L70 18 L92 70 L82 75 L70 46 L70 90 L30 90 L30 46 L18 75 L8 70 Z";
const TEE = "M30 18 L42 12 Q50 18 58 12 L70 18 L87 32 L77 44 L70 38 L70 90 L30 90 L30 38 L23 44 L13 32 Z";

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function GarmentShape({ kind, color, uid }: { kind: Garment; color: string; uid: string }) {
  const dark = shade(color, -0.14);
  const light = shade(color, 0.12);
  const line = { stroke: dark, strokeWidth: 1.2, fill: "none", strokeLinecap: "round" as const };
  switch (kind) {
    case "tee":
      return (
        <g>
          <path d={TEE} fill={color} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <path d="M42 12 Q50 22 58 12" {...line} strokeWidth={2} />
          <rect x={38} y={36} width={24} height={18} rx={3} fill={light} opacity={0.85} />
          <circle cx={50} cy={45} r={5} fill={dark} opacity={0.5} />
        </g>
      );
    case "rugby": {
      const pid = `stripe-${uid}`;
      return (
        <g>
          <defs>
            <pattern id={pid} width={10} height={14} patternUnits="userSpaceOnUse">
              <rect width={10} height={14} fill={color} />
              <rect y={7} width={10} height={7} fill={shade(color, 0.35)} />
            </pattern>
          </defs>
          <path d={LONG_SLEEVE} fill={`url(#${pid})`} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <path d="M40 12 L50 26 L60 12 L55 10 L50 18 L45 10 Z" fill="#f4f1ea" stroke={dark} strokeWidth={0.8} />
          <path d="M50 26 L50 38" {...line} />
        </g>
      );
    }
    case "jacket":
      return (
        <g>
          <path d={LONG_SLEEVE} fill={color} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <path d="M40 12 L50 30 L60 12 L64 16 L54 34 L46 34 L36 16 Z" fill={dark} />
          <path d="M50 30 L50 90" stroke={shade(color, -0.3)} strokeWidth={1.6} />
          <rect x={34} y={58} width={11} height={12} rx={1.5} fill="none" stroke={dark} strokeWidth={1.2} />
          <rect x={55} y={58} width={11} height={12} rx={1.5} fill="none" stroke={dark} strokeWidth={1.2} />
          <path d="M30 84 L70 84" {...line} />
        </g>
      );
    case "hoodie":
      return (
        <g>
          <ellipse cx={50} cy={14} rx={15} ry={11} fill={dark} />
          <path d={LONG_SLEEVE} fill={color} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <path d="M40 13 Q50 30 60 13" fill={shade(color, -0.25)} />
          <path d="M46 22 L45 38 M54 22 L55 38" stroke="#f4f1ea" strokeWidth={1.2} strokeLinecap="round" />
          <path d="M35 62 L65 62 L69 80 L31 80 Z" fill={light} stroke={dark} strokeWidth={1} />
          <path d="M30 86 L70 86" {...line} strokeWidth={2} />
        </g>
      );
    case "knit":
      return (
        <g>
          <path d={LONG_SLEEVE} fill={color} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <path d="M42 12 Q50 20 58 12" {...line} strokeWidth={3} />
          {[38, 46, 54, 62].map((x) => (
            <path key={x} d={`M${x} 24 q3 5 0 10 q-3 5 0 10 q3 5 0 10 q-3 5 0 10 q3 5 0 10`} stroke={light} strokeWidth={2} fill="none" />
          ))}
          {[32, 36, 40, 44, 48, 52, 56, 60, 64, 68].map((x) => (
            <path key={x} d={`M${x} 84 L${x} 90`} stroke={dark} strokeWidth={1} />
          ))}
        </g>
      );
    case "jeans":
      return (
        <g>
          <path d="M31 10 L69 10 L73 93 L55 93 L50 38 L45 93 L27 93 Z" fill={color} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <rect x={31} y={10} width={38} height={6} fill={dark} />
          <path d="M36 16 Q40 26 46 22 M64 16 Q60 26 54 22" {...line} />
          <path d="M50 16 L50 34" {...line} />
          <circle cx={50} cy={13} r={1.3} fill="#d9b36c" />
          <path d="M33 60 L41 60 M59 60 L67 60" stroke={light} strokeWidth={1} opacity={0.7} />
        </g>
      );
    case "shorts":
      return (
        <g>
          <path d="M28 28 L72 28 L77 72 L54 72 L50 50 L46 72 L23 72 Z" fill={color} stroke={dark} strokeWidth={1} strokeLinejoin="round" />
          <rect x={28} y={28} width={44} height={6} fill={dark} />
          <path d="M34 34 Q38 42 44 39 M66 34 Q62 42 56 39" {...line} />
          <path d="M24 72 l1 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 M55 72 l1 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3 l2 3 l2 -3" stroke={light} strokeWidth={1} fill="none" />
        </g>
      );
    case "cap":
      return (
        <g>
          <path d="M22 62 Q22 28 50 26 Q78 28 78 62 Z" fill={color} stroke={dark} strokeWidth={1} />
          <path d="M50 26 L50 62 M36 30 Q32 44 34 62 M64 30 Q68 44 66 62" {...line} />
          <path d="M20 62 Q55 55 94 68 Q62 78 20 66 Z" fill={dark} />
          <circle cx={50} cy={26} r={2.4} fill={dark} />
          <rect x={40} y={42} width={20} height={9} rx={2} fill={light} />
        </g>
      );
    case "bag":
      return (
        <g>
          <path d="M32 44 Q50 4 68 44" stroke={dark} strokeWidth={4} fill="none" strokeLinecap="round" />
          <rect x={20} y={40} width={60} height={44} rx={9} fill={color} stroke={dark} strokeWidth={1} />
          <path d="M20 52 Q50 66 80 52 L80 49 Q80 40 71 40 L29 40 Q20 40 20 49 Z" fill={shade(color, -0.1)} stroke={dark} strokeWidth={1} />
          <rect x={46} y={56} width={8} height={6} rx={1.5} fill="#d9b36c" />
          <path d="M26 78 L74 78" stroke={light} strokeWidth={1} strokeDasharray="2 2" />
        </g>
      );
  }
}

const PILE: [number, number, number][] = [
  [30, 38, -9],
  [178, 26, 8],
  [40, 192, 6],
  [186, 186, -7],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A mirror-mode item's own image, else the generated flat-lay. */
export function ProductVisual({ bundle }: { bundle: { id: string; name: string; garments: Garment[]; colors: string[]; bg: string; image?: string } }) {
  if (bundle.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={bundle.image} alt={bundle.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  }
  return <BundleArt garments={bundle.garments} colors={bundle.colors} bg={bundle.bg} seed={bundle.id} label={bundle.name} />;
}

export function BundleArt({
  garments,
  colors,
  bg,
  seed,
  single = false,
  label,
  className,
}: {
  garments: Garment[];
  colors: string[];
  bg: string;
  seed: string;
  single?: boolean;
  label: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const h = hash(seed);
  const items = single ? [garments[0]] : garments.slice(0, 4);
  return (
    <svg viewBox="0 0 400 400" className={className} role="img" aria-label={label} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={`weave-${uid}`} width={8} height={8} patternUnits="userSpaceOnUse">
          <rect width={8} height={8} fill={bg} />
          <path d="M0 8 L8 0" stroke={shade(bg, -0.05)} strokeWidth={1} />
        </pattern>
        <filter id={`sh-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx={3} dy={6} stdDeviation={5} floodColor="#000" floodOpacity={0.22} />
        </filter>
      </defs>
      <rect width={400} height={400} fill={`url(#weave-${uid})`} />
      {items.map((g, i) => {
        const [x, y, r] = single ? [55, 55, (h % 9) - 4] : PILE[i];
        const jitter = ((h >> (i * 3)) % 7) - 3;
        const scale = single ? 2.9 : 1.85;
        return (
          <g key={i} filter={`url(#sh-${uid})`} transform={`translate(${x + jitter} ${y - jitter}) rotate(${r + jitter} ${50 * scale} ${50 * scale}) scale(${scale})`}>
            <GarmentShape kind={g} color={colors[i % colors.length]} uid={`${uid}${i}`} />
          </g>
        );
      })}
    </svg>
  );
}
