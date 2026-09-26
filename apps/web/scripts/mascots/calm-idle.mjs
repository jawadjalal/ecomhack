#!/usr/bin/env node
/**
 * Turns the design handoff's lively idle SVGs into calm resting loops, so a screen full of mascots
 * is quiet until something happens (tap, thinking, working…).
 *
 *   node scripts/mascots/calm-idle.mjs <handoff svg dir> <out dir>
 *   e.g. node scripts/mascots/calm-idle.mjs ~/darwin-mascots-FINAL/svg public/mascots
 *
 * Copies every {kind}/{kind}-{state}.svg to <out>/{kind}-{state}.svg unchanged, except idle, which is:
 *   - slowed ~2.3× (a slightly different factor per kind, so a row of mascots never bobs in sync),
 *   - damped: bob / squash / sway / wobble move at ~30% of the original distance,
 *   - kept whole: blinks and the side-eye glance (the signs of life),
 *   - stripped: the glint sweep and ambient sparkles, bubbles, rings and dust.
 * (The lively original stays in the handoff zip.)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: calm-idle.mjs <handoff svg dir> <out dir>");
  process.exit(1);
}

const KINDS = { leader: 2.3, analyst: 2.45, observer: 2.2, designer: 2.35, experimenter: 2.25, shipper: 2.4 };
/** Class suffixes. Anything not listed is damped. */
// rot: the designer cog ratchets one 45° tooth per loop, which only loops seamlessly at full size: slowed, not damped.
const KEEP = new Set(["bl", "pu", "look", "rot"]);
const HIDE = new Set(["gl", "cs", "ring", "bu", "sp", "du"]);
const DAMP = 0.3;

const r3 = (v) => String(Math.round(v * 1000) / 1000).replace(/^(-?)0\./, "$1.");

/** Scale every transform in a keyframes body toward rest. */
function damp(body) {
  return body.replace(/(translate[XY]?|rotate|skew[XY]?|scale[XY]?)\(([^)]*)\)/g, (_, fn, args) => {
    const scaled = args.replace(/-?\d*\.?\d+/g, (n) => {
      const v = Number(n);
      return fn.startsWith("scale") ? r3(1 + (v - 1) * DAMP) : r3(v * DAMP);
    });
    return `${fn}(${scaled})`;
  });
}

function calm(svg, kind) {
  const T = KINDS[kind];
  const css = svg.match(/<style>([\s\S]*?)<\/style>/)[1];
  // class → keyframes it runs (a class may be declared twice; the last one wins, as in CSS).
  const runs = new Map();
  for (const m of css.matchAll(/\.([a-z]+-id-([a-z0-9]+))\{animation:([a-z0-9-]+)/g)) runs.set(m[1], { suffix: m[2], kf: m[3] });
  const dampKf = new Set([...runs.values()].filter((r) => !KEEP.has(r.suffix) && !HIDE.has(r.suffix)).map((r) => r.kf));

  let next = css
    // Slow every loop (durations and delays).
    .replace(/animation:([^;}]*)/g, (_, v) => `animation:${v.replace(/(-?\d*\.?\d+)s\b/g, (__, n) => `${r3(Number(n) * T)}s`)}`)
    // Damp the big moves.
    .replace(/@keyframes ([a-z0-9-]+)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, (all, name, body) => (dampKf.has(name) ? `@keyframes ${name}{${damp(body)}}` : all));
  const hidden = [...runs].filter(([, r]) => HIDE.has(r.suffix)).map(([cls]) => `.${cls}`);
  if (hidden.length) next = next.replace(/@media \(prefers-reduced-motion/, `${[...new Set(hidden)].join(",")}{animation:none!important;opacity:0!important}\n@media (prefers-reduced-motion`);
  return svg.replace(css, next).replace(/: idle</g, ": resting<").replace(/: idle"/g, ': resting"');
}

mkdirSync(out, { recursive: true });
let n = 0;
for (const kind of Object.keys(KINDS)) {
  for (const file of readdirSync(join(src, kind))) {
    if (!file.endsWith(".svg") || file.endsWith("-logo.svg") && kind !== "leader") continue;
    const svg = readFileSync(join(src, kind, file), "utf8");
    writeFileSync(join(out, file), file === `${kind}-idle.svg` ? calm(svg, kind) : svg);
    n++;
  }
}
console.log(`wrote ${n} mascots to ${out}`);
