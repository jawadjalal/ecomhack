"use client";

/**
 * Crew art for the cream console.
 *
 * Animated characters are served from public/mascots (see components/mascot/mascot.tsx).
 * Silhouettes stay as vector bodies bleeding off card corners — they are not the character.
 *
 *   leader        red crowned squircle   (Darwin itself)
 *   observer      blue clover            (watches shoppers)
 *   analyst       purple side-eye disc   (finds issues)
 *   designer      orange cog             (proposes fixes)
 *   experimenter  pink drop              (runs A/B tests)
 *   shipper       green rounded diamond  (ships pull requests)
 */
import type { CSSProperties } from "react";
import { Mascot as AnimatedMascot, type MascotProps } from "@/components/mascot/mascot";
import type { MascotKind } from "@/lib/mascot/state";

export type { MascotKind, MascotState, CrewRole } from "@/lib/mascot/state";
export type { MascotProps };
export { DarwinLogo } from "@/components/mascot/logo";

export const MASCOT_SHADE: Record<MascotKind, [string, string, string]> = {
  leader: ["#FF7A7A", "#E23B3B", "#B81F2E"],
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

/** Body outline of a kind (big faint card silhouettes). */
export function mascotBody(kind: MascotKind): string {
  switch (kind) {
    case "leader":
      return "M30 10C20 10 12 18 12 30V70C12 82 20 90 32 90H68C80 90 88 82 88 70V30C88 18 80 10 70 10H30Z";
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

export function Mascot(props: MascotProps) {
  return <AnimatedMascot {...props} />;
}

/** A big faint mascot body bleeding off a card corner (the card's `*-shape` colour). */
export function Silhouette({ kind, color, size = 260, className, style }: { kind: MascotKind; color: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg aria-hidden viewBox="-4 -4 108 108" width={size} height={size} className={`dw-silhouette pointer-events-none absolute ${className ?? ""}`} style={style}>
      <path d={mascotBody(kind)} fill={color} />
    </svg>
  );
}
