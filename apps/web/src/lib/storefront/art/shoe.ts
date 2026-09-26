/** Side-on running shoe illustration (toe pointing right). See svg.ts for the shared canvas. */
import { mix, shade, tint } from "./color";
import { ART_H, ART_W, bez, f, groundShadow, svgDoc, type Pt, type ShoePalette, type ShoeShape } from "./svg";

export function shoeSvg(title: string, pal: ShoePalette, s: ShoeShape): string {
  const G = 676; // ground line (bottom of outsole)
  const ol = s.lugs ? 20 : 15; // outsole thickness
  const mb = G - ol; // midsole bottom
  const rk = s.rocker;
  const heelTop = 528 - s.stack - s.drop;
  const foreTop = 584 - s.stack * 0.72;
  const heelX = 104; // midsole heel flares out behind the upper
  const toeX = 1066;
  const tipY = mb - 62 - rk;
  const up = s.stack * 0.8 + s.drop * 0.6; // how far the upper is lifted by the stack
  const lo = s.low ? 1 : 0;

  const U = (x: number, y: number) => `${f(x)},${f(y - up)}`;
  const P = (x: number, y: number): Pt => [x, y - up];

  const tongueY = 250 + 26 * lo;
  const collarY = 352 + 12 * lo;
  const flareY = 280 + 12 * lo;
  const laceStart = P(452, tongueY + 4);
  const laceC1 = P(572, 318 + 14 * lo);
  const laceC2 = P(694, 384 + 8 * lo);
  const laceEnd = P(806, 424 + 4 * lo);

  const upperPath = [
    `M${U(150, 640)}`,
    `C${U(116, 560)} ${U(100, 440)} ${U(126, 356)}`,
    `C${U(132, 322)} ${U(130, flareY + 12)} ${U(148, flareY)}`,
    `C${U(170, flareY - 12)} ${U(198, flareY - 4)} ${U(216, flareY + 20)}`,
    `C${U(242, collarY - 18)} ${U(272, collarY)} ${U(312, collarY)}`,
    `C${U(346, collarY)} ${U(368, tongueY + 50)} ${U(386, tongueY + 12)}`,
    `C${U(396, tongueY - 10)} ${U(434, tongueY - 14)} ${U(452, tongueY + 4)}`,
    `C${f(laceC1[0])},${f(laceC1[1])} ${f(laceC2[0])},${f(laceC2[1])} ${f(laceEnd[0])},${f(laceEnd[1])}`,
    `C${U(926, 456)} ${U(1024, 494)} ${U(1052, 556)}`,
    `C${U(1066, 592)} ${U(1052, 630)} ${U(1024, 640)}`,
    `Z`,
  ].join(" ");

  const midsolePath = [
    `M${heelX + 18},${f(heelTop)}`,
    `C${heelX - 6},${f(heelTop + 8)} ${heelX - 14},${f(mb - 46)} ${heelX + 2},${f(mb - 18)}`,
    `Q${heelX + 14},${mb} ${heelX + 64},${mb}`,
    `L720,${mb}`,
    `C860,${mb} 975,${f(mb - 24 - rk * 0.75)} ${toeX},${f(tipY + 22)}`,
    `C${toeX + 16},${f(tipY + 12)} ${toeX + 14},${f(tipY - 12)} ${toeX - 6},${f(tipY - 18)}`,
    `C990,${f(foreTop - rk * 0.8 - 6)} 900,${f(foreTop)} 780,${f(foreTop)}`,
    `C600,${f(foreTop)} 380,${f(heelTop + 6)} ${heelX + 18},${f(heelTop)}`,
    "Z",
  ].join(" ");

  // Outsole: a thick stroke along the bottom of the midsole. pathLength lets us segment it.
  const oy = mb + ol / 2 - 1;
  const outsoleLine = [
    `M${heelX + 6},${f(mb - 14)}`,
    `Q${heelX + 16},${f(oy)} ${heelX + 64},${f(oy)}`,
    `L720,${f(oy)}`,
    `C860,${f(oy)} 975,${f(oy - 24 - rk * 0.75)} ${toeX - 6},${f(tipY + 22 + ol / 2)}`,
  ].join(" ");
  const bottomCurve: [Pt, Pt, Pt, Pt] = [
    [720, G],
    [860, G],
    [975, G - 24 - rk * 0.75],
    [toeX - 6, tipY + 22 + ol],
  ];

  const upperDark = shade(pal.upper, 0.22);
  const upperDeep = shade(pal.upper, 0.42);
  const upperLight = tint(pal.upper, 0.2);
  const outline = shade(pal.upper, 0.5);
  const midShade = mix(pal.midsole, "#94a3b8", 0.4);
  const midLine = mix(pal.midsole, "#64748b", 0.4);

  const defs: string[] = [
    `<clipPath id="clip-upper"><path d="${upperPath}"/></clipPath>`,
    `<clipPath id="clip-mid"><path d="${midsolePath}"/></clipPath>`,
    `<linearGradient id="g-upper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${upperLight}"/><stop offset=".55" stop-color="${pal.upper}"/><stop offset="1" stop-color="${upperDark}"/></linearGradient>`,
    `<radialGradient id="g-sheen" cx=".6" cy=".25" r=".55"><stop offset="0" stop-color="#ffffff" stop-opacity=".36"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="g-mid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tint(pal.midsole, 0.6)}"/><stop offset=".55" stop-color="${pal.midsole}"/><stop offset="1" stop-color="${midShade}"/></linearGradient>`,
    `<linearGradient id="g-plate" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0b0f19"/><stop offset=".45" stop-color="#334155"/><stop offset=".6" stop-color="${tint(pal.upper, 0.1)}"/><stop offset=".72" stop-color="#1e293b"/><stop offset="1" stop-color="#0b0f19"/></linearGradient>`,
  ];

  let texture = "";
  const texRect = `<rect x="0" y="0" width="${ART_W}" height="${ART_H}" fill="url(#p-tex)" clip-path="url(#clip-upper)"/>`;
  if (s.texture === "knit") {
    defs.push(
      `<pattern id="p-tex" width="14" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(-10)"><path d="M0 5 Q3.5 0 7 5 T14 5" fill="none" stroke="${upperDeep}" stroke-width="1.6" opacity=".45"/></pattern>`,
    );
    texture = texRect;
  } else if (s.texture === "mesh") {
    defs.push(
      `<pattern id="p-tex" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="2.1" fill="${upperDeep}" opacity=".3"/></pattern>`,
    );
    texture = texRect;
  } else if (s.texture === "ripstop") {
    defs.push(
      `<pattern id="p-tex" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M0 0H18M0 0V18" stroke="${upperDeep}" stroke-width="1.4" opacity=".35"/></pattern>`,
    );
    texture = texRect;
  } else if (s.texture === "monomesh") {
    defs.push(
      `<pattern id="p-tex" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><path d="M0 4H8" stroke="#ffffff" stroke-width="1.2" opacity=".3"/></pattern>`,
    );
    texture = texRect;
  }

  const parts: string[] = [];
  parts.push(groundShadow(596, G + 8, 480));

  // Heel pull tab sits behind the upper.
  if (s.heelTab === "pull") {
    parts.push(
      `<path d="M${U(150, flareY + 26)} C${U(134, flareY - 22)} ${U(150, flareY - 40)} ${U(176, flareY - 34)} L${U(192, flareY + 10)} Z" fill="${pal.accent}" stroke="${shade(pal.accent, 0.4)}" stroke-width="3" stroke-linejoin="round"/>`,
    );
  }

  // Upper
  parts.push(`<path d="${upperPath}" fill="url(#g-upper)" stroke="${outline}" stroke-width="3.5" stroke-linejoin="round"/>`);
  parts.push(texture);

  // Heel counter
  const counter = `M${U(90, 680)} L${U(90, 330)} C${U(176, 340)} ${U(224, 390)} ${U(246, 450)} C${U(266, 510)} ${U(306, 570)} ${U(346, 680)}`;
  parts.push(`<path d="${counter} Z" fill="${upperDark}" opacity=".85" clip-path="url(#clip-upper)"/>`);
  parts.push(
    `<path d="M${U(90, 330)} C${U(176, 340)} ${U(224, 390)} ${U(246, 450)} C${U(266, 510)} ${U(306, 570)} ${U(346, 680)}" fill="none" stroke="${upperDeep}" stroke-width="2.5" stroke-dasharray="7 7" opacity=".55" clip-path="url(#clip-upper)"/>`,
  );
  if (s.heelTab === "reflective") {
    parts.push(
      `<path d="M${U(124, 470)} C${U(116, 420)} ${U(118, 380)} ${U(132, 340)}" fill="none" stroke="#f1f5f9" stroke-width="12" stroke-linecap="round"/>`,
      `<path d="M${U(124, 470)} C${U(116, 420)} ${U(118, 380)} ${U(132, 340)}" fill="none" stroke="#94a3b8" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    );
  }

  // Toe cap / rubber bumper
  if (s.toeBumper) {
    parts.push(
      `<path d="M${U(902, 720)} C${U(900, 570)} ${U(944, 506)} ${U(1090, 494)} L${U(1110, 720)} Z" fill="${pal.outsole}" opacity=".92" clip-path="url(#clip-upper)"/>`,
    );
  } else {
    parts.push(
      `<path d="M${U(936, 720)} C${U(934, 590)} ${U(966, 524)} ${U(1100, 504)} L${U(1110, 720)} Z" fill="${upperDark}" opacity=".45" clip-path="url(#clip-upper)"/>`,
    );
  }

  // Brand mark: two forward-leaning speed stripes on the quarter.
  const bx = 476 + 8 * lo;
  const by = 584;
  const stripe = (dx: number, w: number, o: number) =>
    `<path d="M${U(bx + dx, by)} L${U(bx + dx + w, by)} L${U(bx + dx + w + 168, by - 196)} L${U(bx + dx + 168, by - 196)} Z" fill="${pal.accent}" opacity="${o}" clip-path="url(#clip-upper)"/>`;
  parts.push(stripe(0, 50, 1));
  parts.push(stripe(72, 30, 0.9));

  parts.push(`<path d="${upperPath}" fill="url(#g-sheen)"/>`);

  // Collar padding
  parts.push(
    `<path d="M${U(144, flareY + 8)} C${U(168, flareY - 4)} ${U(196, flareY + 4)} ${U(214, flareY + 28)} C${U(240, collarY - 12)} ${U(272, collarY + 6)} ${U(312, collarY + 6)} C${U(344, collarY + 6)} ${U(366, tongueY + 58)} ${U(382, tongueY + 22)}" fill="none" stroke="${upperDeep}" stroke-width="11" stroke-linecap="round" opacity=".7"/>`,
  );
  // Tongue
  parts.push(
    `<path d="M${U(382, tongueY + 20)} C${U(392, tongueY - 12)} ${U(432, tongueY - 18)} ${U(452, tongueY + 2)} L${U(440, tongueY + 42)} L${U(394, tongueY + 44)} Z" fill="${upperLight}" stroke="${outline}" stroke-width="3" stroke-linejoin="round"/>`,
  );

  // Eyelets + laces
  const lc: [Pt, Pt, Pt, Pt] = [laceStart, laceC1, laceC2, laceEnd];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const t = 0.08 + (i / (count - 1)) * 0.78;
    const { p, d } = bez(...lc, t);
    const len = Math.hypot(d[0], d[1]);
    const nx = -d[1] / len;
    const ny = d[0] / len;
    const tx = d[0] / len;
    const ty = d[1] / len;
    const ex = p[0] + nx * 26;
    const ey = p[1] + ny * 26;
    const x1 = ex - tx * 6;
    const y1 = ey - ty * 6;
    const x2 = p[0] - nx * 8 + tx * 16;
    const y2 = p[1] - ny * 8 + ty * 16;
    parts.push(
      `<circle cx="${f(ex)}" cy="${f(ey)}" r="5.5" fill="${upperDeep}" stroke="${tint(pal.upper, 0.35)}" stroke-width="2"/>`,
      `<path d="M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}" stroke="${shade(pal.laces, 0.35)}" stroke-width="11" stroke-linecap="round"/>`,
      `<path d="M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}" stroke="${pal.laces}" stroke-width="7" stroke-linecap="round"/>`,
    );
  }

  if (s.gaiterRing) {
    parts.push(
      `<circle cx="138" cy="${f(566 - up)}" r="11" fill="none" stroke="${pal.accent}" stroke-width="6"/>`,
      `<path d="M${U(986, 474)} q16 -20 34 -6" fill="none" stroke="${pal.accent}" stroke-width="6" stroke-linecap="round"/>`,
    );
  }

  // Midsole
  parts.push(`<path d="${midsolePath}" fill="url(#g-mid)" stroke="${midLine}" stroke-width="3" stroke-linejoin="round"/>`);
  const gy = (heelTop + mb) / 2 + 8;
  const fy = (foreTop + mb) / 2 + 2;
  // Sculpted sidewall (concave midfoot)
  parts.push(
    `<path d="M300,${mb + 4} C400,${f(mb - (mb - heelTop) * 0.46)} 640,${f(mb - (mb - foreTop) * 0.62)} 760,${mb + 4} Z" fill="${midShade}" opacity=".42" clip-path="url(#clip-mid)"/>`,
  );
  // Groove
  parts.push(
    `<path d="M${heelX + 34},${f(gy)} C400,${f(gy + 12)} 620,${f(fy)} 860,${f(fy - 6)} C930,${f(fy - 8)} 990,${f(fy - 16 - rk * 0.5)} 1024,${f(fy - 28 - rk * 0.6)}" fill="none" stroke="${midLine}" stroke-width="3" opacity=".5" stroke-linecap="round" clip-path="url(#clip-mid)"/>`,
  );
  if (s.plate) {
    parts.push(
      `<path d="M${heelX + 50},${f(gy - 12)} C420,${f(gy - 2)} 640,${f(fy - 12)} 870,${f(fy - 18)} C940,${f(fy - 20)} 992,${f(fy - 28 - rk * 0.5)} 1030,${f(fy - 42 - rk * 0.6)}" fill="none" stroke="url(#g-plate)" stroke-width="11" stroke-linecap="round" clip-path="url(#clip-mid)"/>`,
    );
  }
  // Accent flash on the heel of the midsole
  parts.push(
    `<path d="M${heelX + 12},${f(heelTop + 16)} C200,${f(heelTop + 20)} 270,${f(heelTop + 30)} 330,${f(heelTop + 48)}" fill="none" stroke="${pal.accent}" stroke-width="6" stroke-linecap="round" clip-path="url(#clip-mid)"/>`,
  );
  // Highlight along the top edge
  parts.push(
    `<path d="M${heelX + 22},${f(heelTop + 6)} C380,${f(heelTop + 12)} 600,${f(foreTop + 4)} 780,${f(foreTop + 6)} C880,${f(foreTop + 6)} 960,${f(foreTop - rk * 0.6)} 1020,${f(tipY - 4)}" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity=".75" clip-path="url(#clip-mid)"/>`,
  );

  // Outsole (road shoes get an exposed-foam gap at the midfoot)
  const dash = s.lugs ? "" : ` stroke-dasharray="330 150 2000"`;
  parts.push(
    `<path d="${outsoleLine}" pathLength="1000" fill="none" stroke="${shade(pal.outsole, 0.35)}" stroke-width="${ol + 5}" stroke-linecap="round"${dash}/>`,
    `<path d="${outsoleLine}" pathLength="1000" fill="none" stroke="${pal.outsole}" stroke-width="${ol}" stroke-linecap="round"${dash}/>`,
  );
  if (s.lugs) {
    const lugs: string[] = [];
    const lugAt = (x: number, y: number, angle: number) =>
      `<path d="M-15,-2 l5,14 h20 l5,-14 Z" transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})" fill="${shade(pal.outsole, 0.1)}" stroke="${shade(pal.outsole, 0.4)}" stroke-width="2" stroke-linejoin="round"/>`;
    for (let x = heelX + 50; x <= 720; x += 48) lugs.push(lugAt(x, G, 0));
    for (let t = 0.2; t < 0.95; t += 0.24) {
      const { p, d } = bez(...bottomCurve, t);
      lugs.push(lugAt(p[0], p[1], (Math.atan2(d[1], d[0]) * 180) / Math.PI));
    }
    parts.push(lugs.join("\n"));
  }

  const body = `<g transform="translate(606 476) scale(0.92) rotate(-5) translate(-586 -500)">\n${parts.join("\n")}\n</g>`;
  return svgDoc(title, defs.join("\n"), body);
}
