/** Tiny colour helpers for the product art generator and the storefront theme. */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix `hex` towards `other` by `t` (0 = hex, 1 = other). */
export function mix(hex: string, other: string, t: number) {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export const shade = (hex: string, t: number) => mix(hex, "#000000", t);
export const tint = (hex: string, t: number) => mix(hex, "#ffffff", t);

/** WCAG relative luminance, 0..1. */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text colour on top of `hex`. */
export function readableOn(hex: string) {
  return luminance(hex) > 0.45 ? "#0a0a0a" : "#ffffff";
}
