/**
 * Procedural product illustrations for the PACE demo catalog.
 *
 * Every product (and every colourway) gets a consistent, side-on illustration on a transparent
 * 1200×900 canvas with a soft ground shadow. `npm exec tsx src/lib/storefront/art/generate.ts`
 * writes them to `public/products/*.svg`; the storefront serves them as static files.
 */
import { mix, shade, tint } from "./color";

export const ART_W = 1200;
export const ART_H = 900;

export interface ShoePalette {
  upper: string;
  accent: string;
  midsole: string;
  outsole: string;
  laces: string;
}

export interface ShoeShape {
  /** Extra midsole height (px) on top of the base stack. */
  stack: number;
  /** Extra heel height (px) — the drop. */
  drop: number;
  /** Toe spring (px). */
  rocker: number;
  texture: "knit" | "mesh" | "ripstop" | "smooth" | "monomesh";
  lugs: boolean;
  plate: boolean;
  toeBumper: boolean;
  heelTab: "reflective" | "pull" | "none";
  gaiterRing: boolean;
  /** Lower, sleeker upper (racing). */
  low: boolean;
}

export type Pt = [number, number];

export const f = (n: number) => Math.round(n * 10) / 10;

export function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): { p: Pt; d: Pt } {
  const u = 1 - t;
  const p: Pt = [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
  const d: Pt = [
    3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
  ];
  return { p, d };
}

export function svgDoc(title: string, defs: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_W} ${ART_H}" width="${ART_W}" height="${ART_H}" role="img" aria-label="${title}">
<title>${title}</title>
<defs>
<filter id="blur-shadow" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="blur-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
${defs}
</defs>
${body}
</svg>
`;
}

export function groundShadow(cx: number, cy: number, rx: number, opacity = 0.2) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="22" fill="#0b1220" opacity="${opacity}" filter="url(#blur-shadow)"/>
<ellipse cx="${cx}" cy="${cy - 2}" rx="${rx * 0.72}" ry="9" fill="#0b1220" opacity="${opacity * 0.9}" filter="url(#blur-soft)"/>`;
}

/* ------------------------------------------------------------------ socks */

export function socksSvg(title: string, base: string, accent: string): string {
  const body1 = tint(base, 0.12);
  const patch = tint(base, 0.24);
  const rib = shade(base, 0.35);
  const outline = shade(base, 0.45);
  // Sock silhouette: leg (cuff at top) → heel → foot → toe.
  const sock =
    "M300,150 L520,150 L520,470 C520,520 560,548 620,552 L860,560 C930,564 968,610 960,660 C952,712 902,736 840,734 L470,726 C360,722 290,660 290,560 Z";
  const defs = `
<clipPath id="clip-sock"><path d="${sock}"/></clipPath>
<linearGradient id="g-sock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tint(base, 0.2)}"/><stop offset=".6" stop-color="${base}"/><stop offset="1" stop-color="${shade(base, 0.25)}"/></linearGradient>
<pattern id="p-rib" width="14" height="10" patternUnits="userSpaceOnUse"><path d="M7 0V10" stroke="${rib}" stroke-width="4" opacity=".7"/></pattern>
<pattern id="p-knit" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5 L5 0 L10 5" fill="none" stroke="#ffffff" stroke-width="1" opacity=".08"/></pattern>
<radialGradient id="g-sheen" cx=".35" cy=".3" r=".6"><stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`;

  const one = (id: string, dark: boolean) => {
    const fill = dark ? shade(base, 0.2) : "url(#g-sock)";
    return `<g>
<path d="${sock}" fill="${fill}" stroke="${outline}" stroke-width="4" stroke-linejoin="round"/>
<g clip-path="url(#clip-sock)">
<rect x="0" y="0" width="1200" height="900" fill="url(#p-knit)"/>
<rect x="280" y="140" width="260" height="92" fill="url(#p-rib)"/>
<rect x="280" y="226" width="260" height="6" fill="${rib}" opacity=".7"/>
<path d="M270,520 C300,600 380,640 470,640 C500,640 520,700 470,760 L260,760 Z" fill="${patch}"/>
<path d="M880,540 C850,600 850,690 880,760 L1000,760 L1000,540 Z" fill="${patch}"/>
<path d="M600,540 C610,600 610,680 600,740 L660,740 C672,680 672,600 660,540 Z" fill="${body1}" opacity=".9"/>
<path d="M392,300 l44,0 l-40,70 l-44,0 Z M452,300 l26,0 l-40,70 l-26,0 Z" fill="${accent}"/>
</g>
<path d="${sock}" fill="url(#g-sheen)"/>
${id === "front" ? `<text x="420" y="455" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="800" letter-spacing="6" fill="${tint(base, 0.45)}" transform="rotate(-90 420 455)">PACE</text>` : ""}
</g>`;
  };

  const body = `${groundShadow(640, 800, 360, 0.16)}
<g transform="translate(-40 -10) rotate(-8 600 450)">${one("back", true)}</g>
<g transform="translate(110 40) rotate(4 600 450)">${one("front", false)}</g>`;
  return svgDoc(title, defs, body);
}

/* ------------------------------------------------------------------ vest */

export function vestSvg(title: string, base: string, accent: string): string {
  const light = tint(base, 0.18);
  const dark = shade(base, 0.3);
  const outline = shade(base, 0.5);
  const panelL =
    "M520,150 C470,150 440,190 430,240 L380,470 C360,560 360,660 390,740 L560,740 C570,640 570,520 560,420 L560,200 C560,170 545,150 520,150 Z";
  const panelR =
    "M680,150 C730,150 760,190 770,240 L820,470 C840,560 840,660 810,740 L640,740 C630,640 630,520 640,420 L640,200 C640,170 655,150 680,150 Z";
  const flask = (x: number, flip: boolean) => `
<g transform="translate(${x} 0)${flip ? " scale(-1 1)" : ""}">
<path d="M-60,330 C-60,300 -40,290 0,290 C40,290 60,300 60,330 L66,520 C66,560 40,574 0,574 C-40,574 -66,560 -66,520 Z" fill="url(#g-flask)" stroke="#7dd3fc" stroke-opacity=".6" stroke-width="3"/>
<path d="M-40,340 C-40,320 -30,312 -18,312 L-22,540" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity=".55"/>
<rect x="-18" y="248" width="36" height="46" rx="8" fill="#111827"/>
<rect x="-10" y="224" width="20" height="30" rx="7" fill="${accent}"/>
</g>`;
  const defs = `
<linearGradient id="g-vest" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
<linearGradient id="g-flask" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e0f2fe" stop-opacity=".95"/><stop offset=".5" stop-color="#bae6fd" stop-opacity=".85"/><stop offset="1" stop-color="#7dd3fc" stop-opacity=".9"/></linearGradient>
<pattern id="p-mesh" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M0 6 L6 0 L12 6 L6 12 Z" fill="none" stroke="${dark}" stroke-width="1.4" opacity=".6"/></pattern>`;
  const body = `${groundShadow(600, 790, 300, 0.14)}
<g transform="translate(0 -10)">
<path d="M520,150 C560,110 640,110 680,150 L680,190 C640,170 560,170 520,190 Z" fill="${dark}" stroke="${outline}" stroke-width="4"/>
<path d="M450,300 C470,420 470,560 450,700 L750,700 C730,560 730,420 750,300 C700,340 500,340 450,300 Z" fill="${shade(base, 0.45)}"/>
<path d="${panelL}" fill="url(#g-vest)" stroke="${outline}" stroke-width="4" stroke-linejoin="round"/>
<path d="${panelR}" fill="url(#g-vest)" stroke="${outline}" stroke-width="4" stroke-linejoin="round"/>
<path d="M392,600 C420,610 540,612 560,600 L560,736 L392,736 Z" fill="url(#p-mesh)"/>
<path d="M808,600 C780,610 660,612 640,600 L640,736 L808,736 Z" fill="url(#p-mesh)"/>
${flask(495, false)}
${flask(705, true)}
<path d="M470,470 L730,470" stroke="#1f2937" stroke-width="10" stroke-linecap="round"/>
<path d="M470,540 L730,540" stroke="#1f2937" stroke-width="10" stroke-linecap="round"/>
<rect x="580" y="458" width="40" height="24" rx="5" fill="${accent}"/>
<rect x="580" y="528" width="40" height="24" rx="5" fill="${accent}"/>
<path d="M470,190 C480,170 500,160 520,160" fill="none" stroke="#e5e7eb" stroke-width="5" stroke-linecap="round" opacity=".85"/>
<path d="M730,190 C720,170 700,160 680,160" fill="none" stroke="#e5e7eb" stroke-width="5" stroke-linecap="round" opacity=".85"/>
<path d="M398,700 L552,700" stroke="#e5e7eb" stroke-width="5" stroke-linecap="round" opacity=".8"/>
<path d="M648,700 L802,700" stroke="#e5e7eb" stroke-width="5" stroke-linecap="round" opacity=".8"/>
<circle cx="760" cy="420" r="12" fill="${accent}"/>
<path d="M470,640 l26,0 l-24,40 l-26,0 Z M504,640 l16,0 l-24,40 l-16,0 Z" fill="${accent}"/>
</g>`;
  return svgDoc(title, defs, body);
}
