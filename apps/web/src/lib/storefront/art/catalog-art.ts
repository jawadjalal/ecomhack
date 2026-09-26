/**
 * Art direction per catalog item and colourway. Pure data + string builders (no fs), so it can be
 * used both by the generator script and by tests.
 */
import { PRODUCTS, type Product } from "@/lib/catalog/products";
import { socksSvg, vestSvg, type ShoePalette, type ShoeShape } from "./svg";
import { shoeSvg } from "./shoe";
import { colorSlug } from "../products";

const SHAPES: Record<string, ShoeShape> = {
  p_aurora: { stack: 22, drop: 10, rocker: 26, texture: "knit", lugs: false, plate: false, toeBumper: false, heelTab: "reflective", gaiterRing: false, low: false },
  p_ridge: { stack: 6, drop: 6, rocker: 18, texture: "ripstop", lugs: true, plate: false, toeBumper: true, heelTab: "pull", gaiterRing: false, low: false },
  p_velocity: { stack: 44, drop: 10, rocker: 46, texture: "monomesh", lugs: false, plate: true, toeBumper: false, heelTab: "none", gaiterRing: false, low: true },
  p_tempo: { stack: 4, drop: 6, rocker: 22, texture: "mesh", lugs: false, plate: false, toeBumper: false, heelTab: "none", gaiterRing: false, low: true },
  p_summit: { stack: 34, drop: 2, rocker: 30, texture: "ripstop", lugs: true, plate: false, toeBumper: true, heelTab: "pull", gaiterRing: true, low: false },
  p_city: { stack: 16, drop: 14, rocker: 14, texture: "smooth", lugs: false, plate: false, toeBumper: false, heelTab: "pull", gaiterRing: false, low: false },
};

/** Palette per `productId:colourName`. */
const PALETTES: Record<string, ShoePalette> = {
  "p_aurora:Midnight": { upper: "#1e293b", accent: "#f97316", midsole: "#f8fafc", outsole: "#0f172a", laces: "#e2e8f0" },
  "p_aurora:Solar": { upper: "#f97316", accent: "#1e293b", midsole: "#fff7ed", outsole: "#1e293b", laces: "#ffffff" },
  "p_ridge:Moss": { upper: "#3f6212", accent: "#facc15", midsole: "#e7e5e4", outsole: "#1c1917", laces: "#fef9c3" },
  "p_ridge:Slate": { upper: "#475569", accent: "#f97316", midsole: "#e7e5e4", outsole: "#1c1917", laces: "#f1f5f9" },
  "p_velocity:Volt": { upper: "#a3e635", accent: "#111827", midsole: "#ffffff", outsole: "#111827", laces: "#111827" },
  "p_tempo:Chalk": { upper: "#e7e5e4", accent: "#dc2626", midsole: "#fafaf9", outsole: "#dc2626", laces: "#ffffff" },
  "p_tempo:Signal Red": { upper: "#dc2626", accent: "#fafaf9", midsole: "#fafaf9", outsole: "#1f2937", laces: "#ffffff" },
  "p_summit:Ember": { upper: "#b45309", accent: "#fde68a", midsole: "#f5f5f4", outsole: "#292524", laces: "#fef3c7" },
  "p_city:Fog": { upper: "#9ca3af", accent: "#1e3a8a", midsole: "#f5f0e6", outsole: "#b7793f", laces: "#f8fafc" },
  "p_city:Navy": { upper: "#1e3a8a", accent: "#e5e7eb", midsole: "#f5f0e6", outsole: "#b7793f", laces: "#f8fafc" },
};


/** Base name of the art file, e.g. "aurora" for "/products/aurora.svg". */
export function artBase(product: Product) {
  return product.image.replace(/^\/products\//, "").replace(/\.svg$/, "");
}

export function artFor(product: Product, colorName: string): string {
  const title = `${product.name} — ${colorName}`;
  const color = product.colors.find((c) => c.name === colorName) ?? product.colors[0];
  if (product.id === "p_socks") return socksSvg(title, color.hex, "#f97316");
  if (product.id === "p_vest") return vestSvg(title, color.hex, "#f97316");
  const shape = SHAPES[product.id];
  const pal = PALETTES[`${product.id}:${color.name}`];
  if (!shape || !pal) {
    // Unknown product: fall back to a generic trainer in its first colour.
    return shoeSvg(title, { upper: color.hex, accent: "#f97316", midsole: "#f8fafc", outsole: "#111827", laces: "#ffffff" }, SHAPES.p_aurora);
  }
  return shoeSvg(title, pal, shape);
}

/** Every file the generator writes: default art + one per colourway. */
export function allArtFiles(): { file: string; svg: string }[] {
  const out: { file: string; svg: string }[] = [];
  for (const p of PRODUCTS) {
    const base = artBase(p);
    out.push({ file: `${base}.svg`, svg: artFor(p, p.colors[0].name) });
    if (p.colors.length > 1) {
      for (const c of p.colors) out.push({ file: `${base}--${colorSlug(c.name)}.svg`, svg: artFor(p, c.name) });
    }
  }
  return out;
}
