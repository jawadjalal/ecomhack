#!/usr/bin/env node
/**
 * qa-sweep: end-to-end QA for the storefront, checkout, experiments, agent APIs and console.
 *
 *   npm run build && npx next start -p 3300 &      # the server under test (sections specs/agent/console)
 *   node scripts/qa-sweep.mjs --base http://localhost:3300
 *   node scripts/qa-sweep.mjs --only specs,agent --quick
 *
 * Sections (all by default, pick with --only):
 *   specs     Renders /store, a product page, /store/cart (with items) and /store/checkout for ~55 generated
 *             PageSpecs via `?previewSpec=` at 1440px and 390px. Flags page errors, console errors, hydration
 *             warnings, horizontal overflow, clipped CTA text, missing key elements, and knobs that didn't render.
 *   checkout  Real UI checkout in all 12 checkout variants (steps × guest × express), plus the express-pay path,
 *             each against its own `next start` (port --checkout-port, default 3301) whose live spec is written
 *             to DARWIN_DATA_DIR/spec.json before start. Verifies exactly one `order_completed` per order.
 *             Needs a production build in .next. Also runs a real "server goes away" console test.
 *   arms      Own `next start` (same port as checkout) with no simulated traffic per experiment round, so the
 *             A/B test stays open: resets the loop, steps to the `experiment` phase, loads the store as 40
 *             visitors, checks both arms render their spec, arms are sticky, captured events carry
 *             experiment_id/variant/spec_version, and the store renders the live spec after decide/ship.
 *   agent     Odd input to /api/mcp, /api/agent/*, other APIs; /llms.txt, /.well-known/*: no 5xx, JSON errors.
 *   console   /console with every /api call failing (HTTP 500 and connection refused), then recovering;
 *             /console?mock=1.
 *
 * Options: --base <url> (default http://localhost:3300), --only <a,b>, --quick (fewer specs),
 *          --concurrency <n> (default 4), --checkout-port <n> (default 3301), --widths <list> (default 1440,390;
 *          under 768 = emulated phone), --verbose (print passes and warnings as they happen).
 * Exit code 1 if any check fails. Playwright browsers are classified as AI agents by analytics (expected).
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values: opts } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3300" },
    only: { type: "string" },
    quick: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
    "checkout-port": { type: "string", default: "3301" },
    widths: { type: "string", default: "1440,390" },
    verbose: { type: "boolean", default: false },
  },
});
const BASE = opts.base.replace(/\/$/, "");
const SECTIONS = new Set((opts.only ?? "specs,checkout,arms,agent,console").split(",").map((s) => s.trim()));
const CONCURRENCY = Math.max(1, Number(opts.concurrency) || 4);
const CHECKOUT_PORT = Number(opts["checkout-port"]) || 3301;
/** `--widths 1440,390,820`: widths under 768px are emulated phones (touch, mobile viewport). */
const VIEWPORTS = opts.widths
  .split(",")
  .map(Number)
  .filter((w) => w > 0)
  .map((width) =>
    width < 768
      ? { name: `mobile-${width}`, width, height: 844, isMobile: true, hasTouch: true }
      : { name: `${width >= 1200 ? "desktop" : "tablet"}-${width}`, width, height: 900 },
  );

/* ------------------------------------------------------------------ reporting */

const results = [];
function record(section, name, ok, detail = "") {
  results.push({ section, name, ok, detail });
  if (!ok || opts.verbose) console.log(`${ok ? "  ok  " : "  FAIL"} [${section}] ${name}${detail ? ` — ${detail}` : ""}`);
}
const warnings = [];
function warn(section, name, detail) {
  warnings.push({ section, name, detail });
  if (opts.verbose) console.log(`  warn [${section}] ${name} — ${detail}`);
}

/* ------------------------------------------------------------------ fixtures from the app itself */

/** Catalog + optimizer playbook, loaded from the TS sources so the sweep never drifts from the app. */
function loadFixtures() {
  const code = `
    import { IDEAS } from "@/lib/optimizer/proposals";
    import { PRODUCTS, SHIPPING_FEE } from "@/lib/catalog/products";
    import { storeProducts, LOW_STOCK } from "@/lib/storefront/products";
    const sorts = ["featured", "bestselling", "price-asc", "rating"];
    console.log(JSON.stringify({
      ideas: Object.fromEntries(Object.entries(IDEAS).map(([k, v]) => [k, v.patch])),
      products: PRODUCTS.map((p) => ({ id: p.id, slug: p.slug, name: p.name, price: p.price, stock: p.stock, colors: p.colors.map((c) => c.name) })),
      shippingFee: SHIPPING_FEE,
      lowStock: LOW_STOCK,
      sorted: Object.fromEntries(sorts.map((s) => [s, storeProducts(s).map((p) => p.id)])),
    }));`;
  const out = execFileSync(path.join(APP_DIR, "node_modules/.bin/tsx"), ["--eval", code], { cwd: APP_DIR, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").at(-1));
}

const DEFAULT_SPEC = JSON.parse(fs.readFileSync(path.join(APP_DIR, "storefront.config.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) deepMerge((target[k] ??= {}), v);
    else target[k] = v;
  }
  return target;
}

function setPath(obj, dotted, value) {
  const keys = dotted.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = clone(value);
}

const encodeSpec = (spec) => Buffer.from(JSON.stringify(spec)).toString("base64url");
const gbp = (pence) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

/* ------------------------------------------------------------------ spec matrix */

const LONG_HEADLINE = "Engineered in London for every single stride you take, from parkrun to marathon"; // 80
const LONG_SUB =
  "Performance running shoes designed in our Shoreditch studio, tested on Regent's Canal towpaths, and built to go the distance with free 60-day returns and carbon-neutral UK delivery on every order."; // ~200
const LONG_CTA = "Find your perfect running shoe →"; // 32
const LONG_ANNOUNCEMENT =
  "Free UK delivery over £60 · Free 60-day returns, even worn · Order by 9pm for next-day delivery across London · New AW26 drop"; // ~120

const KNOBS = [
  ["hero.showSocialProof", [true, false]],
  ["hero.headline", ["Engineered for every stride", LONG_HEADLINE.slice(0, 80), "Your fastest mile starts here"]],
  ["hero.subheadline", ["Performance running shoes designed in London.", "", LONG_SUB.slice(0, 200)]],
  ["hero.ctaText", ["Explore collection", LONG_CTA.slice(0, 32), "Shop"]],
  [
    "announcement",
    [
      { enabled: false, text: "" },
      { enabled: true, text: "Free UK delivery over £60" },
      { enabled: true, text: LONG_ANNOUNCEMENT.slice(0, 120) },
      { enabled: true, text: "   " },
    ],
  ],
  ["productGrid.showRatings", [true, false]],
  ["productGrid.showQuickAdd", [true, false]],
  ["productGrid.sort", ["featured", "bestselling", "price-asc", "rating"]],
  ["productPage.ctaText", ["Add to bag", "Grab yours before they're gone", "Buy now", "Add to bag — free next-day deliv"]],
  ["productPage.ctaPosition", ["above-fold", "below-description", "sticky"]],
  ["productPage.showReviews", [true, false]],
  ["productPage.showSizeGuide", [true, false]],
  ["productPage.showDeliveryEstimate", [true, false]],
  ["productPage.showReturnsPolicy", [true, false]],
  ["productPage.urgency", ["none", "low-stock"]],
  ["productPage.trustBadges", [true, false]],
  ["cart.showShippingUpfront", [true, false]],
  ["cart.freeShippingThreshold", [null, 6000, 0, 15000]],
  ["cart.upsell", [true, false]],
  ["theme.radius", ["none", "md", "full"]],
  ["theme.accent", ["#111827", "#ea580c", "#ffffff", "#fde047", "#000000", "#2563eb"]],
  ["agentSurface.structuredData", [true, false]],
  ["agentSurface.exposeStock", [true, false]],
  ["agentSurface.exposeLandedPrice", [true, false]],
  ["agentSurface.negotiation", [{ enabled: false, maxDiscountPct: 0 }, { enabled: true, maxDiscountPct: 30 }]],
];

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSpecs(fx, quick) {
  const specs = [];
  const add = (label, spec) => specs.push({ ...clone(spec), version: 900 + specs.length, label: `QA ${specs.length}: ${label}`.slice(0, 80) });

  add("baseline", DEFAULT_SPEC);

  // Everything on / everything off.
  const on = clone(DEFAULT_SPEC);
  for (const [k, vals] of KNOBS) if (typeof vals[0] === "boolean") setPath(on, k, true);
  deepMerge(on, {
    hero: { layout: "fullbleed", headline: LONG_HEADLINE.slice(0, 80), subheadline: LONG_SUB.slice(0, 200), ctaText: LONG_CTA.slice(0, 32) },
    announcement: { enabled: true, text: LONG_ANNOUNCEMENT.slice(0, 120) },
    productGrid: { columns: 4 },
    productPage: { ctaPosition: "sticky", urgency: "low-stock", ctaText: "Grab yours before they're gone" },
    cart: { freeShippingThreshold: 6000 },
    checkout: { steps: 1, guestCheckout: true, expressPay: true },
    theme: { radius: "full", accent: "#ea580c" },
    agentSurface: { exposeDeliveryEta: true, exposeReturnPolicy: true, negotiation: { enabled: true, maxDiscountPct: 10 } },
  });
  add("everything on", on);
  const off = clone(DEFAULT_SPEC);
  for (const [k, vals] of KNOBS) if (typeof vals[0] === "boolean") setPath(off, k, false);
  deepMerge(off, { hero: { layout: "split", subheadline: "" }, productGrid: { columns: 2 }, productPage: { ctaPosition: "above-fold" }, theme: { radius: "none" } });
  add("everything off", off);

  // The optimizer's own playbook, applied cumulatively like successive generations.
  const evolving = clone(DEFAULT_SPEC);
  for (const [key, patch] of Object.entries(fx.ideas)) {
    deepMerge(evolving, patch);
    add(`playbook +${key}`, evolving);
  }

  // Rotating combinations: the structured knobs cycle so every combination of checkout (3×2×2) and
  // hero layout × grid columns (3×3) appears; the rest are seeded-random, with a diagonal first pass so
  // every enum value shows up at least once.
  const rand = mulberry32(42);
  const n = quick ? 12 : 30;
  for (let i = 0; i < n; i++) {
    const s = clone(DEFAULT_SPEC);
    s.checkout = { steps: [1, 2, 3][i % 3], guestCheckout: Math.floor(i / 3) % 2 === 0, expressPay: Math.floor(i / 6) % 2 === 0 };
    s.hero.layout = ["split", "centered", "fullbleed"][i % 3];
    s.productGrid.columns = [2, 3, 4][Math.floor(i / 3) % 3];
    for (const [k, vals] of KNOBS) setPath(s, k, i < 6 ? vals[i % vals.length] : vals[Math.floor(rand() * vals.length)]);
    add(`combo ${i}`, s);
  }
  return quick ? specs.filter((_, i) => i < 3 || i % 2 === 0) : specs;
}

/* ------------------------------------------------------------------ page instrumentation */

function instrument(page, origin) {
  const issues = [];
  const push = (type, text) => {
    if (!issues.some((i) => i.type === type && i.text === text)) issues.push({ type, text: text.slice(0, 400), url: page.url() });
  };
  page.on("pageerror", (e) => push("pageerror", `${e.name}: ${e.message}`));
  page.on("console", (m) => {
    const text = m.text();
    if (/hydrat|did not match|server rendered html|#418|#423|#425/i.test(text)) push("hydration", text);
    else if (m.type() === "error") push("console", text);
  });
  page.on("response", (r) => {
    if (r.status() >= 500 || (r.status() >= 400 && r.url().startsWith(origin) && r.request().resourceType() !== "document")) {
      push("http", `${r.status()} ${r.request().method()} ${r.url().replace(origin, "").slice(0, 160)}`);
    }
  });
  return issues;
}

/**
 * Horizontal overflow + the elements sticking out. Compares against the layout viewport
 * (`clientWidth`): with mobile emulation Chrome widens `innerWidth` to fit overflowing content.
 */
async function overflowCheck(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    if (sw <= w + 1) return null;
    const out = [];
    const clipped = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== "visible") return true;
      return false;
    };
    const sticksOut = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== "fixed" && !clipped(el);
    };
    const describe = (el) => {
      const d = el.getAttribute("data-darwin");
      return `${el.tagName.toLowerCase()}${d ? `[data-darwin=${d}]` : ""}.${String(el.className).split(" ").slice(0, 4).join(".")} right=${Math.round(el.getBoundingClientRect().right)}`;
    };
    // Where the overflow starts (parent fits, element doesn't), plus the first named element inside it.
    for (const el of document.querySelectorAll("body *")) {
      if (!sticksOut(el) || (el.parentElement && sticksOut(el.parentElement))) continue;
      const named = [...el.querySelectorAll("[data-darwin]")].find(sticksOut);
      out.push(describe(el) + (named ? ` > ${describe(named)}` : ""));
      if (out.length >= 3) break;
    }
    return { scrollWidth: sw, viewportWidth: w, offenders: out };
  });
}

/** Buttons/links whose text is wider than the element (nowrap text spilling out of a CTA). */
async function clippedCtas(page) {
  return page.evaluate(() => {
    const out = [];
    // Buttons are `white-space: nowrap` and centred: long copy spills into the padding first (fine), then
    // past the button's edges (broken). Measure the label itself against the button box.
    const hidden = (node, root) => {
      for (let a = node.parentElement; a && a !== root.parentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.clip !== "auto" || cs.clipPath !== "none" || cs.display === "none" || cs.visibility === "hidden") return true; // e.g. sr-only
      }
      return false;
    };
    for (const el of document.querySelectorAll(".pace-btn[data-darwin]")) {
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      let left = Infinity;
      let right = -Infinity;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim() || hidden(n, el)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        left = Math.min(left, t.left);
        right = Math.max(right, t.right);
      }
      const msg = `${el.getAttribute("data-darwin")}: label ${Math.round(right - left)}px wider than the ${Math.round(b.width)}px button`;
      if ((left < b.left - 0.5 || right > b.right + 0.5) && !out.includes(msg)) out.push(msg);
    }
    return out;
  });
}

const count = (page, sel) => page.locator(sel).count();

/* ------------------------------------------------------------------ per-page checks (shared by specs + arms) */

async function checkHome(page, spec, fx, fail) {
  const hero = page.locator('[data-darwin="hero"]');
  if ((await hero.count()) !== 1) fail("hero missing");
  else if ((await hero.getAttribute("data-layout")) !== spec.hero.layout) fail(`hero layout ${await hero.getAttribute("data-layout")} ≠ ${spec.hero.layout}`);
  const h1 = (await page.locator("h1").first().textContent())?.trim();
  if (h1 !== spec.hero.headline) fail(`headline "${h1}" ≠ spec`);
  const cta = (await page.locator('[data-darwin="hero-cta"]').first().textContent())?.trim();
  if (cta !== spec.hero.ctaText.trim()) fail(`hero CTA "${cta}" ≠ "${spec.hero.ctaText}"`);
  const wantAnn = spec.announcement.enabled && spec.announcement.text.trim().length > 0;
  if ((await count(page, '[data-darwin="announcement"]')) !== (wantAnn ? 1 : 0)) fail(`announcement shown ≠ ${wantAnn}`);
  if ((await count(page, '[data-darwin="social-proof"]')) !== (spec.hero.showSocialProof ? 1 : 0)) fail("social proof ≠ spec");
  const grid = page.locator('[data-darwin="product-grid"]');
  if ((await grid.getAttribute("data-columns")) !== String(spec.productGrid.columns)) fail("grid columns ≠ spec");
  const ids = await page.locator('[data-darwin="product-grid"] [data-darwin="product-card"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-product-id")));
  const want = fx.sorted[spec.productGrid.sort];
  if (ids.join() !== want.join()) fail(`grid order (${spec.productGrid.sort}) ${ids.join()} ≠ ${want.join()}`);
  const quick = await count(page, '[data-darwin="product-grid"] [data-darwin="quick-add"]');
  if (quick !== (spec.productGrid.showQuickAdd ? want.length : 0)) fail(`quick-add buttons ${quick}`);
  const ratings = await count(page, '[data-darwin="product-grid"] [data-darwin="card-rating"]');
  if (ratings !== (spec.productGrid.showRatings ? want.length : 0)) fail(`card ratings ${ratings}`);
}

async function checkProduct(page, spec, product, fail) {
  const pp = spec.productPage;
  const oneSize = Object.keys(product.stock).length === 1;
  const cta = page.locator('[data-darwin="cta-add-to-cart"]');
  if ((await cta.count()) !== 1) return fail(`add-to-cart CTA count ${await cta.count()}`);
  if ((await cta.getAttribute("data-cta-position")) !== pp.ctaPosition) fail("CTA position attr ≠ spec");
  const ctaText = (await cta.textContent()) ?? "";
  if (!ctaText.includes(pp.ctaText.trim())) fail(`CTA text "${ctaText}" lacks "${pp.ctaText}"`);
  const sizes = await count(page, 'main [data-darwin="size-option"]');
  if (!oneSize && sizes < Object.keys(product.stock).length) fail(`size options ${sizes}`);
  const expect = [
    ['[data-darwin="reviews-link"]', pp.showReviews],
    ["#reviews", pp.showReviews],
    ['[data-darwin="size-guide-open"]', pp.showSizeGuide && !oneSize],
    ['[data-darwin="delivery-estimate"]', pp.showDeliveryEstimate],
    ['[data-darwin="returns-policy"]', pp.showReturnsPolicy],
    ['[data-darwin="trust-badges"]', pp.trustBadges],
    ['[data-darwin="sticky-cta-bar"]', pp.ctaPosition === "sticky"],
    ['script[type="application/ld+json"]', spec.agentSurface.structuredData],
  ];
  for (const [sel, want] of expect) if ((await count(page, sel)) > 0 !== want) fail(`${sel} shown ≠ ${want}`);
  if (spec.agentSurface.structuredData) {
    const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
    try {
      const ld = JSON.parse(raw);
      if (ld["@type"] !== "Product" || !ld.offers?.price) fail("JSON-LD missing Product/offers");
    } catch {
      fail("JSON-LD does not parse");
    }
  }
  const box = await cta.boundingBox();
  const vh = page.viewportSize().height;
  if (pp.ctaPosition === "sticky" && (!box || box.y + box.height > vh + 1 || box.y < 0)) fail("sticky CTA not in viewport");
  if (pp.ctaPosition === "above-fold" && page.viewportSize().width >= 1024 && (!box || box.y + box.height > vh)) {
    warn("specs", `${spec.label} above-fold CTA`, `CTA bottom at ${Math.round(box?.y + box?.height)}px > ${vh}px fold (desktop)`);
  }
  // Add to bag: without a size (should prompt), then with one.
  const before = await cartCount(page);
  if (!oneSize) {
    await cta.click();
    await page.getByText("Please select a size").first().waitFor({ timeout: 3000 }).catch(() => fail("no 'Please select a size' prompt"));
    const size = Object.entries(product.stock).find(([, n]) => n > 0)[0];
    await page.locator(`main [data-darwin="size-option"]:not([disabled])`, { hasText: new RegExp(`^${size}$`) }).first().click();
  }
  await cta.click();
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem("pace_cart_v1") || "[]").reduce((s, l) => s + l.quantity, 0) > n, before, { timeout: 4000 }).catch(() => fail("add to bag did not update the cart"));
  if ((await page.getByRole("status").filter({ hasText: "Added to your bag" }).count()) < 1) fail("no 'Added to your bag' toast");
  if (pp.showSizeGuide && !oneSize) {
    await page.locator('[data-darwin="size-guide-open"]').click();
    const dialog = page.getByRole("dialog", { name: /size guide/i });
    await dialog.waitFor({ timeout: 3000 }).catch(() => fail("size guide did not open"));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 3000 }).catch(() => fail("size guide did not close on Escape"));
  }
}

const cartCount = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("pace_cart_v1") || "[]").reduce((s, l) => s + l.quantity, 0));

async function checkCart(page, spec, fx, fail) {
  const lines = await page.evaluate(() => JSON.parse(localStorage.getItem("pace_cart_v1") || "[]"));
  const rows = await count(page, '[data-darwin="cart-line"]');
  if (rows !== lines.length) fail(`cart rows ${rows} ≠ ${lines.length} lines`);
  const subtotal = lines.reduce((s, l) => s + fx.products.find((p) => p.id === l.productId).price * l.quantity, 0);
  const t = spec.cart.freeShippingThreshold;
  const shipping = t !== null && subtotal >= t ? 0 : fx.shippingFee;
  const ship = (await page.locator('[data-darwin="cart-shipping"]').textContent()) ?? "";
  if (spec.cart.showShippingUpfront) {
    if (!ship.includes(shipping === 0 ? "Free" : gbp(shipping))) fail(`cart delivery "${ship}" ≠ ${gbp(shipping)}`);
  } else if (!ship.includes("Calculated at checkout")) fail(`cart delivery "${ship}" should be hidden`);
  const summary = (await page.locator("aside").first().textContent()) ?? "";
  const total = spec.cart.showShippingUpfront ? subtotal + shipping : subtotal;
  if (!summary.includes(gbp(total))) fail(`cart total ${gbp(total)} not shown`);
  if ((await count(page, '[data-darwin="free-shipping-progress"]')) !== (t !== null ? 1 : 0)) fail("free-shipping bar ≠ spec");
  if ((await count(page, '[data-darwin="cart-upsell"]')) !== (spec.cart.upsell ? 1 : 0)) fail("upsell ≠ spec");
  if ((await count(page, '[data-darwin="cart-checkout"]')) !== 1) fail("checkout button missing");
  // Quantity +1 / −1 round trip.
  const qty = () => cartCount(page);
  const q0 = await qty();
  await page.locator('[data-darwin="cart-qty-inc"]').first().click();
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem("pace_cart_v1") || "[]").reduce((s, l) => s + l.quantity, 0) === n + 1, q0, { timeout: 3000 }).catch(() => fail("qty + did nothing"));
  await page.locator('[data-darwin="cart-qty-dec"]').first().click();
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem("pace_cart_v1") || "[]").reduce((s, l) => s + l.quantity, 0) === n, q0, { timeout: 3000 }).catch(() => fail("qty − did nothing"));
}

/** Walks the checkout steps with autofill. Clicks pay only when `pay` (previews never place orders). */
async function checkCheckout(page, spec, fail, { pay = false } = {}) {
  const c = spec.checkout;
  if ((await count(page, '[data-darwin="checkout-form"]')) !== 1) return fail("checkout form missing");
  if ((await count(page, '[data-darwin="express-pay"]')) !== (c.expressPay ? 1 : 0)) fail("express pay ≠ spec");
  if ((await count(page, '[data-darwin="account-required"]')) !== (c.guestCheckout ? 0 : 1)) fail("account-required ≠ spec");
  if ((await count(page, '[data-darwin="guest-checkout"]')) !== (c.guestCheckout ? 1 : 0)) fail("guest-checkout ≠ spec");
  const stepper = await count(page, 'ol[aria-label="Checkout steps"] > li');
  if (stepper !== (c.steps > 1 ? c.steps : 0)) fail(`stepper shows ${stepper} steps, spec ${c.steps}`);
  // Submitting empty shows errors, not a crash.
  await page.locator('[data-darwin="checkout-next"], [data-darwin="checkout-pay"]').first().click();
  if ((await page.locator('[aria-invalid="true"]').count()) === 0) fail("empty submit shows no validation errors");
  let screens = 1;
  for (; screens <= 4; screens++) {
    await page.locator('[data-darwin="checkout-autofill"]').click();
    if (await page.locator('[data-darwin="checkout-pay"]').count()) break;
    await page.locator('[data-darwin="checkout-next"]').click();
    await page.waitForFunction((n) => document.querySelector('[data-darwin="checkout-form"]')?.getAttribute("data-step") === String(n), screens + 1, { timeout: 3000 }).catch(() => fail(`step ${screens} → ${screens + 1} did not advance`));
  }
  if (screens !== c.steps) fail(`reached pay after ${screens} screens, spec ${c.steps}`);
  if ((await count(page, '[data-darwin="final-totals"]')) !== 1) fail("final totals missing on last step");
  if (pay) await page.locator('[data-darwin="checkout-pay"]').click();
}

/* ------------------------------------------------------------------ section: specs */

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

const SEED_CART = [{ productId: "p_aurora", color: "Midnight", size: "9", quantity: 1 }];

async function sectionSpecs(browser, fx) {
  const specs = buildSpecs(fx, opts.quick);
  const rotation = ["aurora-daily-trainer", "velocity-carbon", "blister-shield-socks", "flow-hydration-vest", "summit-ultra"];
  const jobs = specs.flatMap((spec, i) => VIEWPORTS.map((vp) => ({ spec, i, vp })));
  console.log(`\n[specs] ${specs.length} specs × ${VIEWPORTS.length} viewports × 4 pages = ${jobs.length * 4} page loads`);
  let done = 0;
  await pool(jobs, CONCURRENCY, async ({ spec, i, vp }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, baseURL: BASE });
    await ctx.addInitScript((seed) => {
      try {
        if (!localStorage.getItem("pace_cart_v1")) localStorage.setItem("pace_cart_v1", JSON.stringify(seed));
      } catch {}
    }, SEED_CART);
    const page = await ctx.newPage();
    const issues = instrument(page, BASE);
    const q = `previewSpec=${encodeSpec(spec)}`;
    const product = fx.products.find((p) => p.slug === rotation[i % rotation.length]);
    const pages = [
      ["home", `/store?${q}`, (f) => checkHome(page, spec, fx, f)],
      ["product", `/store/products/${product.slug}?${q}`, (f) => checkProduct(page, spec, product, f)],
      ["cart", `/store/cart?${q}`, (f) => checkCart(page, spec, fx, f)],
      ["checkout", `/store/checkout?${q}`, (f) => checkCheckout(page, spec, f)],
    ];
    if (i === 0) {
      pages.push(["success-unknown", `/store/checkout/success?order=ord_nope&${q}`, async () => {}]);
      pages.push(["category", `/store?category=trail&${q}`, async () => {}]);
      pages.push(["404", `/store/products/does-not-exist?${q}`, async () => {}]);
      pages.push(["404-percent", `/store/products/100%25?${q}`, async () => {}]);
    }
    for (const [name, url, check] of pages) {
      const label = `${spec.label} · ${vp.name} · ${name}`;
      const failures = [];
      const fail = (m) => failures.push(m);
      issues.length = 0;
      try {
        const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        const status = res?.status() ?? 0;
        if (status !== (name.startsWith("404") ? 404 : 200)) fail(`HTTP ${status}`);
        if (name.startsWith("404")) issues.splice(0); // the 404 document itself is expected
        await page.waitForTimeout(150);
        if (/Application error|client-side exception/i.test(await page.locator("body").innerText())) fail("Next.js application error screen");
        const ov = await overflowCheck(page);
        if (ov) fail(`horizontal overflow ${ov.scrollWidth}px > ${ov.viewportWidth}px: ${ov.offenders.join(" | ")}`);
        const clipped = await clippedCtas(page);
        if (clipped.length) fail(`clipped CTA text: ${clipped.join("; ")}`);
        await check(fail);
        const ov2 = await overflowCheck(page); // after interactions (toast, size picker…)
        if (ov2 && !ov) fail(`horizontal overflow after interaction ${ov2.scrollWidth}px: ${ov2.offenders.join(" | ")}`);
      } catch (e) {
        fail(`exception: ${String(e.message ?? e).split("\n")[0]}`);
      }
      for (const is of issues) fail(`${is.type}: ${is.text}`);
      record("specs", label, failures.length === 0, failures.join(" ; "));
    }
    await ctx.close();
    if (++done % 10 === 0) console.log(`  … ${done}/${jobs.length} spec×viewport jobs`);
  });
}

/* ------------------------------------------------------------------ server management (checkout section) */

async function waitForHttp(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startServer(port, dataDir, extraEnv = {}) {
  const log = [];
  const child = spawn(process.execPath, [path.join(APP_DIR, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
    cwd: APP_DIR,
    env: { ...process.env, ...extraEnv, DARWIN_DATA_DIR: dataDir, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  const ok = await waitForHttp(`http://localhost:${port}/api/spec`, 45000);
  const stop = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    });
  if (!ok) {
    await stop();
    throw new Error(`server on :${port} did not start:\n${log.join("").slice(-2000)}`);
  }
  /** Server-side errors Next printed (⨯ …, unhandled rejections), minus expected offline noise. */
  const errors = () =>
    log
      .join("")
      .split("\n")
      .filter((l) => /⨯|Error:|Unhandled/.test(l) && !/\[github\]|\[llm\]|ENOTFOUND|EAI_AGAIN|fetch failed/.test(l));
  return { child, stop, log, errors, origin: `http://localhost:${port}` };
}

async function portFree(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

async function events(origin, query) {
  const r = await fetch(`${origin}/api/analytics/events?${query}`, { cache: "no-store" });
  return (await r.json()).events ?? [];
}

/* ------------------------------------------------------------------ section: checkout */

async function sectionCheckout(browser, fx) {
  if (!fs.existsSync(path.join(APP_DIR, ".next/BUILD_ID"))) return record("checkout", "production build present", false, "run `npm run build` first");
  if (!(await portFree(CHECKOUT_PORT))) return record("checkout", `port ${CHECKOUT_PORT} free`, false, "something is listening there; pass --checkout-port");
  const variants = [];
  for (const steps of [1, 2, 3]) for (const guestCheckout of [true, false]) for (const expressPay of [true, false]) variants.push({ steps, guestCheckout, expressPay });
  const aurora = fx.products.find((p) => p.id === "p_aurora");
  console.log(`\n[checkout] ${variants.length} variants (+ express path where enabled), one fresh server each on :${CHECKOUT_PORT}`);

  for (const [vi, checkout] of variants.entries()) {
    const spec = clone(DEFAULT_SPEC);
    spec.version = 1;
    spec.label = `QA checkout ${checkout.steps}-step guest=${checkout.guestCheckout} express=${checkout.expressPay}`;
    spec.checkout = checkout;
    spec.cart.showShippingUpfront = vi % 2 === 0;
    spec.cart.freeShippingThreshold = vi % 4 < 2 ? null : 6000;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "darwin-qa-"));
    fs.writeFileSync(path.join(dataDir, "spec.json"), JSON.stringify({ live: spec, history: [DEFAULT_SPEC, spec] }));
    let server;
    try {
      server = await startServer(CHECKOUT_PORT, dataDir);
      const live = await (await fetch(`${server.origin}/api/spec`)).json();
      const liveSpec = live.spec ?? live.live ?? live;
      if (JSON.stringify(liveSpec.checkout) !== JSON.stringify(checkout)) record("checkout", `${spec.label}: live spec applied`, false, JSON.stringify(liveSpec.checkout));
      const paths = checkout.expressPay ? ["card", "express"] : ["card"];
      for (const [pi, payPath] of paths.entries()) {
        const vp = VIEWPORTS[(vi + pi) % VIEWPORTS.length];
        await runCheckout(browser, server.origin, spec, aurora, fx, payPath, vp);
      }
      if (vi === 0) {
        // Odd product URLs must 404 cleanly (no server-side exception in the log).
        for (const p of ["/store/products/100%25", "/store/products/%25E0%25A4", "/store/products/does-not-exist"]) {
          const r = await fetch(`${server.origin}${p}`);
          record("checkout", `GET ${p} → 404`, r.status === 404, `HTTP ${r.status}`);
        }
      }
      const errs = server.errors();
      record("checkout", `${spec.label}: server log clean`, errs.length === 0, errs.slice(0, 3).join(" | "));
    } catch (e) {
      record("checkout", spec.label, false, String(e.message ?? e).split("\n").slice(0, 3).join(" "));
    } finally {
      await server?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  }
}

async function runCheckout(browser, origin, spec, product, fx, payPath, vp) {
  const label = `${spec.label} · ${payPath} · ${vp.name}`;
  const failures = [];
  const fail = (m) => failures.push(m);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, baseURL: origin });
  const page = await ctx.newPage();
  const issues = instrument(page, origin);
  try {
    await page.goto(`/store/products/${product.slug}`, { waitUntil: "networkidle" });
    await page.locator('main [data-darwin="size-option"]:not([disabled])', { hasText: /^9$/ }).first().click();
    await page.locator('[data-darwin="cta-add-to-cart"]').click();
    await page.waitForFunction(() => (localStorage.getItem("pace_cart_v1") || "[]") !== "[]", null, { timeout: 4000 });
    await page.goto("/store/checkout", { waitUntil: "networkidle" });
    if (payPath === "express") {
      await page.locator('[data-darwin="express-pay-apple"]').click();
    } else {
      await checkCheckout(page, spec, fail, { pay: true });
    }
    await page.waitForURL(/\/store\/checkout\/success\?order=/, { timeout: 15000 });
    await page.getByText(/You.re all set/).waitFor({ timeout: 5000 }).catch(() => fail("success page did not render the order"));
    const orderId = new URL(page.url()).searchParams.get("order");
    const subtotal = product.price;
    const t = spec.cart.freeShippingThreshold;
    const shipping = t !== null && subtotal >= t ? 0 : fx.shippingFee;
    const orders = async () => (await events(origin, "limit=200&synthetic=0&events=order_completed")).filter((e) => e.properties.order_id === orderId);
    let got = [];
    for (let i = 0; i < 40 && got.length === 0; i++) {
      await page.waitForTimeout(250);
      got = await orders();
    }
    if (got.length !== 1) fail(`order_completed events for ${orderId}: ${got.length}`);
    else {
      const p = got[0].properties;
      if (p.revenue !== subtotal + shipping) fail(`revenue ${p.revenue} ≠ ${subtotal + shipping}`);
      if (p.shipping !== shipping) fail(`shipping ${p.shipping} ≠ ${shipping}`);
      if (p.spec_version !== spec.version) fail(`spec_version ${p.spec_version} ≠ ${spec.version}`);
      if (!p.visitor_kind) fail("visitor_kind missing");
      if (Boolean(p.express) !== (payPath === "express")) fail(`express flag ${p.express}`);
    }
    if (await page.evaluate(() => localStorage.getItem("pace_cart_v1")) !== "[]") fail("cart not cleared after order");
    // Reload the confirmation: must not double count.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const again = await orders();
    if (again.length !== 1) fail(`after reload: ${again.length} order_completed events`);
    const funnel = (await events(origin, "limit=500&synthetic=0&events=checkout_started,checkout_step_completed,checkout_abandoned")).filter(
      (e) => e.distinct_id === got[0]?.distinct_id,
    );
    const started = funnel.filter((e) => e.event === "checkout_started").length;
    const stepsDone = funnel.filter((e) => e.event === "checkout_step_completed").length;
    const abandoned = funnel.filter((e) => e.event === "checkout_abandoned").length;
    if (started !== 1) fail(`checkout_started ×${started}`);
    if (stepsDone !== (payPath === "express" ? 1 : spec.checkout.steps)) fail(`checkout_step_completed ×${stepsDone}`);
    if (abandoned) fail(`checkout_abandoned fired ×${abandoned} for a completed order`);
  } catch (e) {
    fail(`exception: ${String(e.message ?? e).split("\n")[0]}`);
  }
  for (const is of issues) fail(`${is.type}: ${is.text}`);
  record("checkout", label, failures.length === 0, failures.join(" ; "));
  await ctx.close();
}

/** Console against a server that really goes away and comes back. */
async function consoleServerRestart(browser) {
  if (!fs.existsSync(path.join(APP_DIR, ".next/BUILD_ID")) || !(await portFree(CHECKOUT_PORT))) return;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "darwin-qa-"));
  let server;
  const failures = [];
  try {
    server = await startServer(CHECKOUT_PORT, dataDir);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: server.origin });
    const page = await ctx.newPage();
    const issues = instrument(page, server.origin);
    await page.goto("/console", { waitUntil: "networkidle" });
    await server.stop();
    await page.waitForTimeout(8000);
    if (/Application error|client-side exception/i.test(await page.locator("body").innerText())) failures.push("crash screen while server down");
    server = await startServer(CHECKOUT_PORT, dataDir);
    await page.waitForTimeout(6000);
    if (/Application error|client-side exception/i.test(await page.locator("body").innerText())) failures.push("crash screen after server came back");
    for (const is of issues.filter((i) => i.type === "pageerror" || i.type === "hydration")) failures.push(`${is.type}: ${is.text}`);
    await ctx.close();
  } catch (e) {
    failures.push(`exception: ${String(e.message ?? e).split("\n")[0]}`);
  } finally {
    await server?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  record("console", "/console while the server stops and restarts", failures.length === 0, failures.join(" ; "));
}

/* ------------------------------------------------------------------ section: arms */

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function sectionArms(browser, fx) {
  if (!fs.existsSync(path.join(APP_DIR, ".next/BUILD_ID"))) return record("arms", "production build present", false, "run `npm run build` first");
  if (!(await portFree(CHECKOUT_PORT))) return record("arms", `port ${CHECKOUT_PORT} free`, false, "something is listening there; pass --checkout-port");
  // Own server with no simulated traffic per experiment round, so the A/B test stays open for real visitors
  // (with the defaults, simulated shoppers usually settle it within the step that starts it).
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "darwin-qa-arms-"));
  let server;
  try {
    server = await startServer(CHECKOUT_PORT, dataDir, { DARWIN_ROUND_HUMANS: "0", DARWIN_ROUND_AGENTS: "0" });
    console.log(`\n[arms] fresh server on :${CHECKOUT_PORT}; stepping the loop to the experiment phase`);
    await runArms(browser, fx, server.origin);
    const errs = server.errors();
    record("arms", "server log clean", errs.length === 0, errs.slice(0, 3).join(" | "));
  } catch (e) {
    record("arms", "arms section", false, String(e.message ?? e).split("\n").slice(0, 3).join(" "));
  } finally {
    await server?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function runArms(browser, fx, origin) {
  const reset = await post(`${origin}/api/loop/reset`);
  if (reset.status !== 200) return record("arms", "loop reset", false, `HTTP ${reset.status}`);
  let state = reset.json;
  const step = async () => {
    const r = await post(`${origin}/api/loop/step`);
    if (r.status !== 200) throw new Error(`POST /api/loop/step → HTTP ${r.status}`);
    state = r.json;
  };
  // Test successive experiments until one changes what humans see (agent-only ones render identically).
  let humanVisible = false;
  for (let n = 0; n < 4 && !humanVisible; n++) {
    for (let i = 0; i < 12 && state.phase !== "experiment"; i++) await step();
    if (state.phase !== "experiment") return record("arms", "reach experiment phase", false, `stuck in ${state.phase}`);
    const exp = ((await (await fetch(`${origin}/api/experiments`)).json()).experiments ?? []).find((e) => e.status === "running");
    if (!exp) return record("arms", "running experiment", false, "none running in /api/experiments");
    const keys = Object.keys(state.proposal?.patch ?? {});
    humanVisible = keys.some((k) => k !== "agentSurface");
    record("arms", `experiment ${n + 1} running: "${exp.name}" (${keys.join(", ")})`, true);
    await armVisitors(browser, fx, origin, exp, state.liveSpec, n);
    // Close it out: with no simulated traffic per round it runs to max rounds, then decides.
    for (let i = 0; i < 8 && (state.phase === "experiment" || state.phase === "decide"); i++) await step();
    const failures = [];
    const ctx = await browser.newContext({ baseURL: origin });
    const page = await ctx.newPage();
    const issues = instrument(page, origin);
    await page.goto("/store", { waitUntil: "networkidle" });
    const v = await page.locator(".pace-root").first().getAttribute("data-spec-version");
    const arm = await page.locator(".pace-root").first().getAttribute("data-variant");
    const liveNow = (await (await fetch(`${origin}/api/loop`)).json()).liveSpec;
    if (Number(v) !== liveNow.version || arm !== "live") failures.push(`store renders v${v} (${arm}), live is v${liveNow.version}`);
    await checkHome(page, liveNow, fx, (m) => failures.push(m));
    for (const is of issues) failures.push(`${is.type}: ${is.text}`);
    record("arms", `experiment ${n + 1} closed (phase ${state.phase}): store renders live spec v${liveNow.version}`, failures.length === 0, failures.join(" ; "));
    await ctx.close();
  }
  record("arms", "a human-visible experiment was tested", humanVisible);
}

async function armVisitors(browser, fx, origin, exp, liveSpec, n) {
  const N = opts.quick ? 12 : 30;
  const tag = `${Date.now().toString(36)}${n}`;
  const seen = { control: [], treatment: [] };
  await pool(
    Array.from({ length: N }, (_, i) => i),
    CONCURRENCY,
    async (i) => {
      const distinctId = `v_qa_${tag}_${i}`;
      const vp = VIEWPORTS[i % 2];
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, baseURL: origin });
      await ctx.addCookies([{ name: "darwin_id", value: distinctId, url: origin }]);
      const page = await ctx.newPage();
      const issues = instrument(page, origin);
      const failures = [];
      const fail = (m) => failures.push(m);
      try {
        await page.goto("/store", { waitUntil: "networkidle" });
        const arm = await page.locator(".pace-root").first().getAttribute("data-variant");
        if (arm !== "control" && arm !== "treatment") fail(`data-variant=${arm}`);
        else seen[arm].push(distinctId);
        const spec = arm === "treatment" ? exp.treatmentSpec : liveSpec;
        await checkHome(page, spec, fx, fail);
        await page.goto("/store/products/aurora-daily-trainer", { waitUntil: "networkidle" });
        const arm2 = await page.locator(".pace-root").first().getAttribute("data-variant");
        if (arm2 !== arm) fail(`arm not sticky: ${arm} then ${arm2}`);
        await checkProduct(page, spec, fx.products.find((p) => p.id === "p_aurora"), fail);
        await page.goto("/store/cart", { waitUntil: "networkidle" });
        await checkCart(page, spec, fx, fail);
        await page.goto("/store/checkout", { waitUntil: "networkidle" });
        await checkCheckout(page, spec, fail);
        await page.waitForTimeout(1500); // posthog flushes every second
      } catch (e) {
        fail(`exception: ${String(e.message ?? e).split("\n")[0]}`);
      }
      for (const is of issues) fail(`${is.type}: ${is.text}`);
      if (failures.length) record("arms", `visitor ${distinctId}`, false, failures.join(" ; "));
      await ctx.close();
    },
  );
  record("arms", `both arms rendered (control ${seen.control.length}, treatment ${seen.treatment.length})`, seen.control.length > 0 && seen.treatment.length > 0);

  await new Promise((r) => setTimeout(r, 2500));
  const evs = (await events(origin, "limit=1000&synthetic=0")).filter((e) => e.distinct_id.startsWith(`v_qa_${tag}_`));
  const armOf = new Map([...seen.control.map((d) => [d, "control"]), ...seen.treatment.map((d) => [d, "treatment"])]);
  const bad = [];
  const withEvents = new Set();
  for (const e of evs) {
    withEvents.add(e.distinct_id);
    const p = e.properties;
    const arm = armOf.get(e.distinct_id);
    if (p.experiment_id !== exp.id || p.variant !== arm) bad.push(`${e.event} ${e.distinct_id}: experiment_id=${p.experiment_id} variant=${p.variant} (rendered ${arm})`);
    const wantVersion = arm === "treatment" ? exp.treatmentSpec.version : liveSpec.version;
    if (p.spec_version !== wantVersion) bad.push(`${e.event} ${e.distinct_id}: spec_version=${p.spec_version} ≠ ${wantVersion}`);
  }
  record("arms", `${evs.length} captured events attributed to the rendered arm`, bad.length === 0, bad.slice(0, 5).join(" ; "));
  const missing = [...armOf.keys()].filter((d) => !withEvents.has(d));
  record("arms", `every visitor's events captured (${withEvents.size}/${armOf.size})`, missing.length === 0, missing.slice(0, 5).join(", "));
  record("arms", "visitor_kind stamped on every event", evs.every((e) => e.properties.visitor_kind === "human" || e.properties.visitor_kind === "agent"));
}

/* ------------------------------------------------------------------ section: agent APIs */

async function sectionAgent() {
  console.log(`\n[agent] odd input against ${BASE}`);
  const rpc = (body, headers = {}) => ({ method: "POST", path: "/api/mcp", body: typeof body === "string" ? body : JSON.stringify(body), headers });
  const call = (name, args, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const cases = [
    ["mcp: invalid JSON", rpc("{not json"), { status: 400, rpcError: -32700 }],
    ["mcp: empty body", rpc(""), { status: 400, rpcError: -32700 }],
    ["mcp: null", rpc("null"), { rpcError: -32600 }],
    ["mcp: number", rpc("42"), { rpcError: -32600 }],
    ["mcp: unknown method", rpc({ jsonrpc: "2.0", id: 1, method: "nope" }), { status: 200, rpcError: -32601 }],
    ["mcp: missing method", rpc({ jsonrpc: "2.0", id: 1 }), { rpcError: -32600 }],
    ["mcp: object id", rpc({ jsonrpc: "2.0", id: {}, method: "ping" }), { rpcError: -32600 }],
    ["mcp: jsonrpc 1.0", rpc({ jsonrpc: "1.0", id: 1, method: "ping" }), { rpcError: -32600 }],
    ["mcp: array params", rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: [] }), { rpcError: -32602 }],
    ["mcp: tools/call no params", rpc({ jsonrpc: "2.0", id: 1, method: "tools/call" }), { rpcError: -32602 }],
    ["mcp: tools/call unknown tool", rpc(call("rm_rf", {})), { rpcError: -32602 }],
    ["mcp: tools/call args not object", rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_product", arguments: "p_aurora" } }), { rpcError: -32602 }],
    ["mcp: get_product no id", rpc(call("get_product", {})), { toolError: true }],
    ["mcp: get_product numeric id", rpc(call("get_product", { id: 123 })), { toolError: true }],
    ["mcp: get_product unknown", rpc(call("get_product", { id: "p_nope" })), { toolError: true }],
    ["mcp: add_to_cart bad size", rpc(call("add_to_cart", { id: "p_aurora", size: "99" })), { toolError: true }],
    ["mcp: add_to_cart negative qty", rpc(call("add_to_cart", { id: "p_aurora", size: "9", quantity: -3 })), { toolError: true }],
    ["mcp: add_to_cart huge qty", rpc(call("add_to_cart", { id: "p_aurora", size: "9", quantity: 1e9 })), { toolError: true }],
    ["mcp: add_to_cart string qty", rpc(call("add_to_cart", { id: "p_aurora", size: "9", quantity: "lots" })), { toolError: true }],
    ["mcp: add_to_cart sold-out size", rpc(call("add_to_cart", { id: "p_aurora", size: "12" })), { toolError: true }],
    ["mcp: negotiate negative offer", rpc(call("negotiate", { id: "p_aurora", offer: -500 })), { noServerError: true }],
    ["mcp: negotiate string offer", rpc(call("negotiate", { id: "p_aurora", offer: "cheap" })), { noServerError: true }],
    ["mcp: negotiate huge offer", rpc(call("negotiate", { id: "p_aurora", offer: 1e15 })), { noServerError: true }],
    ["mcp: checkout empty cart", rpc(call("checkout", { maxTotal: -1 }), { "mcp-session-id": `mcp_qa_${Date.now()}` }), { toolError: true }],
    ["mcp: search with junk", rpc(call("search_products", { query: "\u0000💥".repeat(200), maxPrice: "abc", size: {}, want: 7 })), { noServerError: true }],
    ["mcp: empty batch", rpc([]), { status: 400, rpcError: -32600 }],
    ["mcp: mixed batch", rpc([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }, 5, { jsonrpc: "2.0", id: 3, method: "nope" }]), { status: 200, batch: 4 }],
    ["mcp: notifications only", rpc([{ jsonrpc: "2.0", method: "notifications/initialized" }]), { status: 202 }],
    ["mcp: GET", { method: "GET", path: "/api/mcp" }, { status: 200 }],
    ["mcp: GET event-stream", { method: "GET", path: "/api/mcp", headers: { accept: "text/event-stream" } }, { status: 405, noBody: true }],
    ["mcp: DELETE without session", { method: "DELETE", path: "/api/mcp" }, { status: 400 }],
    ["rest: products maxPrice=abc", { method: "GET", path: "/api/agent/products?maxPrice=abc" }, { noServerError: true }],
    ["rest: products maxPrice=-1", { method: "GET", path: "/api/agent/products?maxPrice=-1" }, { noServerError: true }],
    ["rest: products want=junk&size=%00", { method: "GET", path: "/api/agent/products?want=junk,,,&size=%00&category=spaceships" }, { noServerError: true }],
    ["rest: product unknown id", { method: "GET", path: "/api/agent/products/does-not-exist" }, { status: 404 }],
    ["rest: product id with unicode", { method: "GET", path: "/api/agent/products/%F0%9F%91%9F" }, { status: 404 }],
    // Known Next.js 16 behaviour: a malformed escape in a dynamic segment fails in the router, before the
    // app (or proxy) runs, with a plain-text 500. Real clients never send these; reported as a warning.
    ["rest: product bad percent-encoding", { method: "GET", path: "/api/agent/products/%E0%A4%A" }, { noServerError: true, framework: true }],
    ["rest: availability empty", { method: "GET", path: "/api/agent/availability?id=&size=" }, { noServerError: true, errorJson: true }],
    ["rest: availability bad size", { method: "POST", path: "/api/agent/availability", body: JSON.stringify({ id: "p_aurora", size: 99 }) }, { noServerError: true }],
    ["rest: cart invalid JSON", { method: "POST", path: "/api/agent/cart", body: "{oops" }, { status: 400, errorJson: true }],
    ["rest: cart array body", { method: "POST", path: "/api/agent/cart", body: "[1,2]" }, { status: 400, errorJson: true }],
    ["rest: cart negative qty", { method: "POST", path: "/api/agent/cart", body: JSON.stringify({ id: "p_aurora", size: "9", quantity: -3 }) }, { status: 400, errorJson: true }],
    ["rest: cart fractional qty", { method: "POST", path: "/api/agent/cart", body: JSON.stringify({ id: "p_aurora", size: "9", quantity: 2.5 }) }, { status: 400, errorJson: true }],
    ["rest: cart unknown product", { method: "POST", path: "/api/agent/cart", body: JSON.stringify({ id: "p_nope", size: "9" }) }, { status: 404, errorJson: true }],
    ["rest: negotiate negative", { method: "POST", path: "/api/agent/negotiate", body: JSON.stringify({ id: "p_aurora", offer: -100 }) }, { noServerError: true }],
    ["rest: negotiate zero", { method: "POST", path: "/api/agent/negotiate", body: JSON.stringify({ id: "p_aurora", offer: 0 }) }, { noServerError: true }],
    ["rest: negotiate '£50'", { method: "POST", path: "/api/agent/negotiate", body: JSON.stringify({ id: "p_aurora", offer: "£50" }) }, { noServerError: true }],
    ["rest: checkout maxTotal=abc", { method: "POST", path: "/api/agent/checkout", body: JSON.stringify({ maxTotal: "abc" }), headers: { "x-agent-session": `qa_${Date.now()}` } }, { noServerError: true, errorJson: true }],
    ["rest: checkout empty cart", { method: "POST", path: "/api/agent/checkout", body: "{}", headers: { "x-agent-session": `qa_empty_${Date.now()}` } }, { noServerError: true, errorJson: true }],
    ["rest: abandon junk", { method: "POST", path: "/api/agent/abandon", body: JSON.stringify({ reason: 5 }) }, { noServerError: true }],
    ["rest: shop empty brief", { method: "POST", path: "/api/agent/shop", body: JSON.stringify({ brief: "" }) }, { status: 400, errorJson: true }],
    ["rest: shop negative budget", { method: "POST", path: "/api/agent/shop", body: JSON.stringify({ goal: { brief: "x", maxBudget: -5 } }) }, { status: 400, errorJson: true }],
    ["rest: shop invalid JSON", { method: "POST", path: "/api/agent/shop", body: "{" }, { noServerError: true }],
    ["rest: sessions limit=abc", { method: "GET", path: "/api/agent/sessions?limit=abc" }, { status: 200 }],
    ["rest: sessions limit=-5", { method: "GET", path: "/api/agent/sessions?limit=-5" }, { status: 200 }],
    ["rest: OPTIONS preflight", { method: "OPTIONS", path: "/api/agent/cart" }, { status: 204, noBody: true }],
    ["api: capture invalid", { method: "POST", path: "/api/capture", body: "{" }, { status: 400, errorJson: true }],
    ["api: capture wrong shape", { method: "POST", path: "/api/capture", body: JSON.stringify({ events: [{ event: "" }] }) }, { status: 400, errorJson: true }],
    ["api: events limit=abc after=junk", { method: "GET", path: "/api/analytics/events?limit=abc&after=junk&visitorKind=robot" }, { status: 200 }],
    ["api: summary", { method: "GET", path: "/api/analytics/summary" }, { status: 200 }],
    ["api: spec", { method: "GET", path: "/api/spec" }, { status: 200 }],
    ["api: experiments", { method: "GET", path: "/api/experiments" }, { status: 200 }],
    ["api: loop", { method: "GET", path: "/api/loop" }, { status: 200 }],
    ["api: autopilot junk", { method: "POST", path: "/api/loop/autopilot", body: "{" }, { noServerError: true }],
    ["api: simulate junk", { method: "POST", path: "/api/simulate", body: JSON.stringify({ humans: -5, agents: "many" }) }, { noServerError: true }],
    ["api: github status", { method: "GET", path: "/api/github/status" }, { noServerError: true }],
    ["api: github connect junk", { method: "POST", path: "/api/github/connect", body: "{" }, { noServerError: true }],
    ["api: github ship junk", { method: "POST", path: "/api/github/ship", body: JSON.stringify({ specVersion: "nope" }) }, { noServerError: true }],
    ["api: ingest junk", { method: "POST", path: "/ingest/e", body: "garbage" }, { noServerError: true }],
    ["api: ingest batch junk", { method: "POST", path: "/ingest/batch", body: JSON.stringify({ batch: "nope" }) }, { noServerError: true }],
    ["api: collect junk", { method: "POST", path: "/api/collect", body: "{" }, { noServerError: true }],
    ["doc: /llms.txt", { method: "GET", path: "/llms.txt" }, { status: 200, text: true }],
    ["doc: agent-card.json", { method: "GET", path: "/.well-known/agent-card.json" }, { status: 200 }],
    ["doc: agent.json", { method: "GET", path: "/.well-known/agent.json" }, { status: 200 }],
    ["doc: darwin.js", { method: "GET", path: "/darwin.js" }, { status: 200, text: true }],
  ];
  for (const [name, req, want] of cases) {
    const failures = [];
    try {
      const r = await fetch(`${BASE}${req.path}`, {
        method: req.method,
        headers: { "content-type": "application/json", "user-agent": "darwin-qa-sweep/1.0", ...(req.headers ?? {}) },
        body: req.body,
      });
      const text = await r.text();
      let body;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }
      if (r.status >= 500) failures.push(`HTTP ${r.status}: ${text.slice(0, 160)}`);
      if (want.status && r.status !== want.status) failures.push(`HTTP ${r.status}, want ${want.status}`);
      if (!want.text && !want.noBody && text && body === undefined) failures.push(`non-JSON body: ${text.slice(0, 80)}`);
      if (want.text && !text.trim()) failures.push("empty body");
      if (want.rpcError && body?.error?.code !== want.rpcError) failures.push(`rpc error ${JSON.stringify(body?.error ?? body).slice(0, 120)}, want ${want.rpcError}`);
      if (want.toolError && !(body?.result?.isError === true && body.result.structuredContent?.error)) failures.push(`want a tool error, got ${text.slice(0, 160)}`);
      if (want.batch !== undefined && (!Array.isArray(body) || body.length !== want.batch)) failures.push(`batch responses ${Array.isArray(body) ? body.length : typeof body}, want ${want.batch}`);
      if (want.errorJson && r.status >= 400 && !(typeof body?.error === "string" && body.error.length > 0)) failures.push(`error JSON lacks a message: ${text.slice(0, 120)}`);
      if (want.errorJson && r.status < 400 && body?.ok !== false) failures.push(`expected a refusal, got ${text.slice(0, 120)}`);
      if (body?.result?.structuredContent?.code === "internal" || body?.code === "internal") failures.push(`internal error: ${text.slice(0, 160)}`);
    } catch (e) {
      failures.push(`request failed: ${e.message}`);
    }
    if (want.framework && failures.length) warn("agent", name, `framework-level: ${failures.join(" ; ")}`);
    else record("agent", name, failures.length === 0, failures.join(" ; "));
  }
}

/* ------------------------------------------------------------------ section: console */

async function sectionConsole(browser) {
  console.log(`\n[console] /console under API failures, and ?mock=1`);
  const runs = [
    ["/console normal", "/console", null, VIEWPORTS[0]],
    ["/console mobile", "/console", null, VIEWPORTS[1]],
    ["/console with every /api → 500", "/console", "500", VIEWPORTS[0]],
    ["/console with /api unreachable", "/console", "abort", VIEWPORTS[0]],
    ["/console with /api returning HTML", "/console", "html", VIEWPORTS[0]],
    ["/console?mock=1", "/console?mock=1", null, VIEWPORTS[0]],
    ["/console?mock=1 mobile", "/console?mock=1", null, VIEWPORTS[1]],
    ["/ landing", "/", null, VIEWPORTS[1]],
  ];
  for (const [name, url, mode, vp] of runs) {
    const failures = [];
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, baseURL: BASE });
    // Skip the first-run "connect repo" modal except on the plain first load.
    if (name !== "/console normal") {
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("darwin.console.connect-dismissed", "1");
        } catch {}
      });
    }
    const page = await ctx.newPage();
    const issues = instrument(page, BASE);
    try {
      if (mode) {
        await page.route(/\/api\//, (route) =>
          mode === "abort"
            ? route.abort("connectionrefused")
            : mode === "html"
              ? route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" })
              : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
        );
      }
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(mode ? 7000 : 5000);
      // Mock mode must actually run the loop: step through a full generation with the Step button.
      if (url.includes("mock") && !vp.isMobile) {
        const before = await page.locator("header").first().innerText();
        const stepBtn = page.getByRole("button", { name: /^Step/ }).first();
        for (let i = 0; i < 7; i++) {
          await stepBtn.click({ timeout: 5000 }).catch((e) => failures.push(`step ${i + 1}: ${String(e.message).split("\n")[0]}`));
          await page.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => /^Step/.test(b.textContent ?? "") && b.disabled), null, { timeout: 20000 }).catch(() => failures.push(`step ${i + 1} never finished`));
        }
        if ((await page.locator("header").first().innerText()) === before) failures.push("7 steps changed nothing in the top bar");
      }
      const body = await page.locator("body").innerText();
      if (/Application error|client-side exception|Unhandled Runtime Error/i.test(body)) failures.push("crash screen");
      if (body.trim().length < 50) failures.push("blank page");
      if (mode) {
        await page.unroute(/\/api\//);
        await page.waitForTimeout(5000);
        if (/Application error|client-side exception/i.test(await page.locator("body").innerText())) failures.push("crash after API recovered");
      }
      const ov = await overflowCheck(page);
      // Mission control is a desktop/projector UI; on phones it scrolls sideways by design.
      if (ov && vp.isMobile && url.startsWith("/console")) warn("console", name, `desktop-only layout: ${ov.scrollWidth}px wide at ${ov.viewportWidth}px`);
      else if (ov) failures.push(`horizontal overflow ${ov.scrollWidth}px > ${ov.viewportWidth}px: ${ov.offenders.join(" | ")}`);
    } catch (e) {
      failures.push(`exception: ${String(e.message ?? e).split("\n")[0]}`);
    }
    // With APIs failing on purpose, failed requests/console errors are expected; crashes are not.
    for (const is of issues) if (!mode || is.type === "pageerror" || is.type === "hydration") failures.push(`${is.type}: ${is.text}`);
    record("console", name, failures.length === 0, failures.join(" ; "));
    await ctx.close();
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  const t0 = Date.now();
  const needsBase = ["specs", "agent", "console"].some((s) => SECTIONS.has(s));
  if (needsBase && !(await waitForHttp(`${BASE}/api/spec`, 5000))) {
    console.error(`No server at ${BASE}. Start one: npm run build && npx next start -p 3300`);
    process.exit(2);
  }
  const fx = loadFixtures();
  const browser = await chromium.launch();
  try {
    if (SECTIONS.has("agent")) await sectionAgent();
    if (SECTIONS.has("specs")) await sectionSpecs(browser, fx);
    if (SECTIONS.has("checkout")) await sectionCheckout(browser, fx);
    if (SECTIONS.has("console")) {
      await sectionConsole(browser);
      await consoleServerRestart(browser);
    }
    if (SECTIONS.has("arms")) await sectionArms(browser, fx);
  } finally {
    await browser.close();
  }

  console.log("\n================ summary ================");
  const bySection = {};
  for (const r of results) {
    const s = (bySection[r.section] ??= { ok: 0, fail: 0 });
    if (r.ok) s.ok++;
    else s.fail++;
  }
  for (const [s, c] of Object.entries(bySection)) console.log(`${s.padEnd(9)} ${String(c.ok).padStart(4)} passed  ${String(c.fail).padStart(4)} failed`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings.slice(0, 20)) console.log(`  [${w.section}] ${w.name} — ${w.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`\n${failed.length} failure(s):`);
    for (const f of failed) console.log(`  [${f.section}] ${f.name} — ${f.detail}`);
  }
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
