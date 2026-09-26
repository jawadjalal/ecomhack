#!/usr/bin/env node
/**
 * Seed Darwin with simulated Orchard traffic: humans AND AI shopping agents whose drop-offs follow the
 * conversion mistakes in storefront.config.json (fix a knob, re-seed, and the funnel improves).
 *
 *   node seed/seed.mjs --darwin http://localhost:3000            # 1200 humans + 120 agents, then 4 loop steps
 *   node seed/seed.mjs --darwin https://darwin.example --token $DARWIN_ADMIN_TOKEN --humans 1500
 *   node seed/seed.mjs --dry-run                                  # print the funnel, send nothing
 *   node seed/seed.mjs --write-baseline /path/to/DARWIN_DATA_DIR  # make this config Darwin's Gen 0 (Darwin stopped)
 *
 * Every event is synthetic and labelled so: it goes to Darwin's POST /api/simulate/events, which stamps
 * `properties.synthetic = true` server-side (the public ingest routes can't, by design). Darwin's console
 * labels simulated traffic. No dependencies; Node 20+.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
if (flag("help", false)) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n"));
  process.exit(0);
}
const DARWIN = String(flag("darwin", process.env.DARWIN_URL || "http://localhost:3000")).replace(/\/+$/, "");
const TOKEN = flag("token", process.env.DARWIN_ADMIN_TOKEN || "");
const HUMANS = Number(flag("humans", 1200));
const AGENTS = Number(flag("agents", 120));
const HOURS = Number(flag("hours", 24));
const SITE = String(flag("site", process.env.NEXT_PUBLIC_DARWIN_SITE || "orchard"));
const SITE_URL = String(flag("site-url", "http://localhost:3001")).replace(/\/+$/, "");
const CONFIG = path.resolve(String(flag("config", path.join(here, "..", "storefront.config.json"))));
const LOOP_STEPS = Number(flag("loop", 4));
const DRY = Boolean(flag("dry-run", false));
const SEED = Number(flag("seed", Date.now() % 1e9));
const BASELINE_DIR = flag("write-baseline", "");

const spec = JSON.parse(fs.readFileSync(CONFIG, "utf8"));

if (BASELINE_DIR) {
  // Darwin keeps its live PageSpec in DARWIN_DATA_DIR/spec.json. Writing this site's config there (while
  // Darwin is stopped) makes it Darwin's Gen 0, so "ship the winner" PRs keep Orchard's copy.
  const dir = path.resolve(String(BASELINE_DIR));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "spec.json");
  fs.writeFileSync(file, JSON.stringify({ live: spec, history: [spec] }, null, 2));
  console.log(`Wrote ${file}: Darwin's baseline is now "${spec.label}" (v${spec.version}). Start Darwin with DARWIN_DATA_DIR=${dir}.`);
  if (!argv.includes("--darwin")) process.exit(0);
}

/* ------------------------------------------------------------------ catalog (mirrors lib/catalog.ts) */

const PRODUCTS = [
  { id: "orchard-phone-17-pro", price: 109900, weight: 0.3, stock: 39 },
  { id: "orchard-phone-17", price: 79900, weight: 0.22, stock: 77 },
  { id: "orchard-book-air", price: 109900, weight: 0.14, stock: 36 },
  { id: "orchard-watch-11", price: 39900, weight: 0.14, stock: 21 },
  { id: "orchard-buds-pro", price: 22900, weight: 0.12, stock: 40 },
  { id: "orchard-pad-air", price: 59900, weight: 0.08, stock: 25 },
];
const ACCESSORIES = [
  { id: "orchard-clear-case", price: 4900 },
  { id: "orchard-35w-charger", price: 5900 },
  { id: "orchard-braided-cable", price: 1900 },
];
const DELIVERY_FEE = 995;

/* ------------------------------------------------------------------ rng */

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED >>> 0);
const chance = (p) => rand() < Math.max(0, Math.min(1, p));
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const weighted = (xs) => {
  let r = rand() * xs.reduce((s, x) => s + x.weight, 0);
  return xs.find((x) => (r -= x.weight) < 0) ?? xs[0];
};
const rid = () => Math.floor(rand() * 2 ** 48).toString(36).padStart(9, "0");

/* ------------------------------------------------------------------ the behaviour model */

const pp = spec.productPage;
const cart = spec.cart;
const co = spec.checkout;
const agentSurface = spec.agentSurface;
const buyish = /\b(buy|shop|order|get|bag|add)\b/i.test(spec.hero.ctaText);

/** How likely a product-page visitor adds to bag, from the product page knobs. */
function addRate(device) {
  let p = 0.14;
  p *= { "below-description": 0.52, "above-fold": 1, sticky: 1.12 }[pp.ctaPosition] ?? 1;
  if (pp.showReviews) p *= 1.1;
  if (pp.showDeliveryEstimate) p *= 1.1;
  if (pp.showReturnsPolicy) p *= 1.06;
  if (pp.trustBadges) p *= 1.05;
  if (pp.urgency === "low-stock") p *= 1.03;
  if (pp.showSizeGuide) p *= 1.03;
  if (device === "Mobile" && pp.ctaPosition === "below-description") p *= 0.8; // an even longer scroll on a phone
  return Math.min(0.75, p);
}

const SOURCES = [
  { source: "search", weight: 0.32, referrer: () => pick(["https://www.google.com/", "https://www.google.co.uk/", "https://www.bing.com/"]), utm: () => ({ utm_term: pick(["orchard phone 17 pro", "orchard book air", "best phone 2026", "orchard watch"]) }) },
  { source: "social", weight: 0.18, referrer: () => pick(["https://l.instagram.com/", "https://www.tiktok.com/", "https://t.co/x"]), utm: () => ({}) },
  { source: "ai", weight: 0.14, referrer: () => pick(["https://chatgpt.com/", "https://www.perplexity.ai/", "https://claude.ai/", "https://gemini.google.com/"]), utm: () => ({ utm_source: "chatgpt.com" }) },
  { source: "paid", weight: 0.14, referrer: () => "https://www.google.com/", utm: () => ({ gclid: rid() }) },
  { source: "email", weight: 0.1, referrer: () => undefined, utm: () => ({ utm_source: "newsletter", utm_medium: "email" }) },
  { source: "direct", weight: 0.12, referrer: () => undefined, utm: () => ({}) },
];

const now = Date.now();
const events = [];
const stats = { humans: 0, agents: 0, viewed: 0, added: 0, bag: 0, checkout: 0, orders: 0, agentOrders: 0, revenue: 0, drops: {} };
const drop = (why) => (stats.drops[why] = (stats.drops[why] ?? 0) + 1);

function session(kind, i) {
  const id = `v_seed_${SEED.toString(36)}_${kind[0]}${i}`;
  const sid = `s_seed_${SEED.toString(36)}_${kind[0]}${i}`;
  let t = now - rand() * HOURS * 3600_000;
  const base = { darwin_site: SITE, $lib: "darwin-seed", $session_id: sid, spec_version: spec.version, orchard_config_version: spec.version, store: "orchard" };
  const emit = (event, props = {}, path) => {
    t += 1500 + rand() * 20_000;
    if (t > now) t = now - rand() * 1000;
    const p = { ...base, ...props };
    if (path) Object.assign(p, { $pathname: path.split("?")[0], $current_url: SITE_URL + path });
    events.push({ event, distinct_id: id, timestamp: new Date(t).toISOString(), properties: p });
  };
  return { id, emit, base };
}

function human(i) {
  stats.humans++;
  const src = weighted(SOURCES);
  const r = rand();
  const device = r < 0.6 ? "Mobile" : r < 0.94 ? "Desktop" : "Tablet";
  const s = session("human", i);
  Object.assign(s.base, { visitor_kind: "human", persona: `orchard-seed:${src.source}`, $device_type: device, $referrer: src.referrer() });
  const product = weighted(PRODUCTS);
  const productPath = `/products/${product.id}`;
  const utm = src.utm();
  const qs = Object.keys(utm).length ? `?${new URLSearchParams(utm)}` : "";
  const land = rand();
  const mobile = device === "Mobile" ? 0.88 : 1;

  let onProduct = false;
  if (land < 0.5) {
    s.emit("$pageview", { title: "Orchard (UK)", ...utm }, `/${qs}`);
    let p = 0.52 * (spec.hero.showSocialProof ? 1.1 : 1) * (buyish ? 1.06 : 1) * (spec.announcement.enabled ? 1.03 : 1);
    if (chance(0.25)) s.emit("$autocapture", { $event_type: "click", $el_tag: "a", $el_text: spec.hero.ctaText, $selector: 'a[data-darwin="hero-cta"]' }, "/");
    if (!chance(p)) {
      drop("bounced from home");
      return s.emit("$pageleave", {}, "/");
    }
    onProduct = true;
  } else if (land < 0.65) {
    s.emit("$pageview", { title: "Store - Orchard (UK)", ...utm }, `/store${qs}`);
    const g = spec.productGrid;
    if (g.showQuickAdd && chance(0.1 * (g.showRatings ? 1.1 : 1))) {
      s.emit("product_added", { product_id: product.id, price: product.price, quantity: 1, source: "grid-quick-add" }, "/store");
      stats.added++;
      return bagAndCheckout(s, product, device);
    }
    if (!chance(0.58 * (g.showRatings ? 1.08 : 1) * (g.sort === "bestselling" ? 1.04 : 1))) {
      drop("left the store page");
      return s.emit("$pageleave", {}, "/store");
    }
    onProduct = true;
  } else {
    s.emit("$pageview", { title: "Buy Orchard", ...utm }, `${productPath}${qs}`);
    onProduct = true;
  }
  if (!onProduct) return;

  if (land < 0.65) s.emit("$pageview", { title: "Buy Orchard" }, productPath);
  s.emit("product_viewed", { product_id: product.id, price: product.price, cta_position: pp.ctaPosition }, productPath);
  stats.viewed++;
  if (!chance(addRate(device) * mobile)) {
    drop(pp.ctaPosition === "below-description" ? "left product page (Add to Bag below the fold)" : "left product page");
    return s.emit("$pageleave", {}, productPath);
  }
  s.emit("$autocapture", { $event_type: "click", $el_tag: "button", $el_text: pp.ctaText, $selector: 'button[data-darwin="add-to-bag"]' }, productPath);
  s.emit("product_added", { product_id: product.id, price: product.price, quantity: 1, source: pp.ctaPosition === "sticky" && chance(0.4) ? "sticky-bar" : "buy-summary" }, productPath);
  stats.added++;
  bagAndCheckout(s, product, device);
}

function bagAndCheckout(s, product, device) {
  let subtotal = product.price;
  s.emit("$pageview", { title: "Bag" }, "/bag");
  if (cart.upsell && chance(0.16)) {
    const a = pick(ACCESSORIES);
    s.emit("product_added", { product_id: a.id, price: a.price, quantity: 1, source: "bag-upsell" }, "/bag");
    subtotal += a.price;
  }
  const fee = cart.freeShippingThreshold !== null && subtotal >= cart.freeShippingThreshold ? 0 : DELIVERY_FEE;
  s.emit("cart_viewed", { value: subtotal, items: 1 }, "/bag");
  stats.bag++;
  if (cart.showShippingUpfront) s.emit("shipping_cost_revealed", { shipping: fee, subtotal, where: "bag" }, "/bag");
  if (!chance(cart.showShippingUpfront && fee > 0 ? 0.64 : 0.7)) {
    drop("left the bag");
    return s.emit("$pageleave", {}, "/bag");
  }
  s.emit("$pageview", { title: "Checkout" }, "/checkout");
  s.emit("checkout_started", { value: subtotal, items: 1, steps: co.steps, guest_checkout: co.guestCheckout, express_pay: co.expressPay }, "/checkout");
  stats.checkout++;

  if (co.expressPay && chance(0.32)) {
    s.emit("express_pay_clicked", { method: pick(["orchard-pay", "wallet-pay"]), value: subtotal + fee }, "/checkout");
    if (!cart.showShippingUpfront) s.emit("shipping_cost_revealed", { shipping: fee, subtotal, where: "express-pay" }, "/checkout");
    if (chance(0.93)) return order(s, subtotal, fee, true);
    drop("abandoned express pay");
    return s.emit("checkout_abandoned", { step: 1, reason: "express_pay_cancelled" }, "/checkout");
  }

  const groups = co.steps === 1 ? [["Orchard ID", "Delivery", "Payment"]] : co.steps === 2 ? [["Orchard ID", "Delivery"], ["Payment"]] : [["Orchard ID"], ["Delivery"], ["Payment"]];
  let revealed = cart.showShippingUpfront;
  for (let i = 0; i < groups.length; i++) {
    const step = i + 1;
    const name = groups[i].join(" + ");
    s.emit("checkout_step_viewed", { step, step_name: name, steps: groups.length }, "/checkout");
    let leave = i > 0 ? 0.07 : 0.04;
    let reason = "left_site";
    if (groups[i].includes("Orchard ID")) {
      if (!co.guestCheckout) {
        leave += 0.36;
        reason = "account_required";
        if (chance(0.12)) {
          for (let k = 0; k < 3; k++) s.emit("$autocapture", { $event_type: "click", $el_tag: "button", $el_text: "Continue", $selector: 'button[data-darwin="checkout-continue"]' }, "/checkout");
          s.emit("$rageclick", { $event_type: "click", $el_tag: "button", $el_text: "Continue", $selector: 'button[data-darwin="checkout-continue"]' }, "/checkout");
          s.emit("checkout_error", { step, message: "Your password needs 8+ characters, a capital letter and a number." }, "/checkout");
        }
      } else leave += 0.04;
    }
    if (groups[i].includes("Payment") && !revealed) {
      revealed = true;
      s.emit("shipping_cost_revealed", { shipping: fee, subtotal, where: `checkout-step-${step}` }, "/checkout");
      if (fee > 0) {
        leave += 0.3;
        reason = "unexpected_shipping_cost";
      }
    }
    if (device === "Mobile") leave *= 1.12;
    if (chance(leave)) {
      drop(`checkout step ${step} (${name}): ${reason}`);
      return s.emit("checkout_abandoned", { step, step_name: name, steps: groups.length, reason }, "/checkout");
    }
    s.emit("checkout_step_completed", { step, step_name: name, steps: groups.length }, "/checkout");
  }
  order(s, subtotal, fee, false);
}

function order(s, subtotal, fee, express) {
  const revenue = subtotal + fee;
  s.emit("order_completed", { order_id: `OR${rid().toUpperCase()}`, revenue, shipping: fee, items: 1, express }, "/checkout");
  s.emit("$pageview", { title: "Thank you" }, "/order/confirmation");
  stats.revenue += revenue;
  if (s.base.visitor_kind === "agent") stats.agentOrders++;
  else stats.orders++;
}

/* ------------------------------------------------------------------ AI shopping agents */

const AGENT_NAMES = ["ChatGPT-User", "ChatGPT Agent", "Claude-User", "Perplexity-User", "Gemini Deep Research", "Grok"];
const FIELDS = [
  { field: "delivery_eta", exposed: agentSurface.exposeDeliveryEta, weight: 0.24, reason: "no delivery ETA, can't promise an arrival date" },
  { field: "landed_price", exposed: agentSurface.exposeLandedPrice, weight: 0.22, reason: "landed price unknown: delivery cost hidden until checkout" },
  { field: "return_policy", exposed: agentSurface.exposeReturnPolicy, weight: 0.18, reason: "no return policy published" },
  { field: "stock", exposed: agentSurface.exposeStock, weight: 0.08, reason: "stock availability unknown" },
  { field: "structured_data", exposed: agentSurface.structuredData, weight: 0.08, reason: "no structured product data (JSON-LD)" },
];

function agent(i) {
  stats.agents++;
  const s = session("agent", i);
  const name = pick(AGENT_NAMES);
  Object.assign(s.base, { visitor_kind: "agent", agent_name: name, persona: "orchard-seed:agent", $device_type: "Desktop" });
  const product = weighted(PRODUCTS);
  const productPath = `/products/${product.id}`;
  const missing = FIELDS.filter((f) => !f.exposed);
  const missingNames = missing.map((f) => f.field);
  s.emit("agent_request", { tool: "fetch_catalog", ok: true, missing: missingNames }, "/api/catalog");
  s.emit("agent_request", { tool: "get_product", ok: true, product_id: product.id, missing: missingNames }, productPath);
  s.emit("product_viewed", { product_id: product.id, price: product.price }, productPath);
  stats.viewed++;
  const pGiveUp = 1 - missing.reduce((keep, f) => keep * (1 - f.weight), 0.82);
  if (chance(pGiveUp)) {
    if (!missing.length) {
      drop("agent compared elsewhere");
      return s.emit("agent_abandoned", { tool: "get_product", reason: "found a better price elsewhere", product_id: product.id }, productPath);
    }
    const why = missing.slice().sort((a, b) => b.weight - a.weight)[Math.floor(rand() * Math.min(2, missing.length))];
    drop(`agent gave up: ${why.field}`);
    return s.emit("agent_abandoned", { tool: "get_product", reason: why.reason, product_id: product.id }, productPath);
  }
  s.emit("product_added", { product_id: product.id, price: product.price, quantity: 1, source: "agent" }, productPath);
  stats.added++;
  s.emit("checkout_started", { value: product.price, items: 1 }, "/checkout");
  stats.checkout++;
  if (!co.guestCheckout && chance(0.7)) {
    drop("agent gave up: account required");
    s.emit("agent_request", { tool: "checkout", ok: false, reason: "checkout requires creating an account (no guest checkout)" }, "/checkout");
    return s.emit("agent_abandoned", { tool: "checkout", reason: "checkout requires creating an account (no guest checkout)" }, "/checkout");
  }
  const fee = cart.freeShippingThreshold !== null && product.price >= cart.freeShippingThreshold ? 0 : DELIVERY_FEE;
  if (!agentSurface.exposeLandedPrice) s.emit("shipping_cost_revealed", { shipping: fee, subtotal: product.price, where: "checkout" }, "/checkout");
  if (chance(0.84)) order(s, product.price, fee, false);
  else {
    drop("agent checkout failed");
    s.emit("checkout_abandoned", { step: co.steps, reason: "agent_timeout" }, "/checkout");
  }
}

for (let i = 0; i < HUMANS; i++) human(i);
for (let i = 0; i < AGENTS; i++) agent(i);
events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

/* ------------------------------------------------------------------ report + send */

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
console.log(`Orchard seed · config v${spec.version} "${spec.label}" (${path.relative(process.cwd(), CONFIG) || CONFIG}) · seed ${SEED}`);
console.log(`  ${stats.humans} humans + ${stats.agents} AI agents → ${events.length} events (all synthetic)`);
console.log(`  product views ${stats.viewed} · adds ${stats.added} · bag ${stats.bag} · checkouts ${stats.checkout}`);
console.log(`  orders: humans ${stats.orders} (${pct(stats.orders, stats.humans)}), agents ${stats.agentOrders} (${pct(stats.agentOrders, stats.agents)}) · revenue £${(stats.revenue / 100).toFixed(2)}`);
console.log("  biggest drop-offs:");
for (const [why, n] of Object.entries(stats.drops).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${String(n).padStart(5)}  ${why}`);

if (DRY) {
  console.log("Dry run: nothing sent.");
  process.exit(0);
}

const headers = { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
let sent = 0;
for (let i = 0; i < events.length; i += 500) {
  const batch = events.slice(i, i + 500);
  let res;
  try {
    res = await fetch(`${DARWIN}/api/simulate/events`, { method: "POST", headers, body: JSON.stringify({ events: batch }) });
  } catch (err) {
    console.error(`\nCan't reach Darwin at ${DARWIN} (${err.cause?.code ?? err.message}). Is it running? Pass --darwin <url>.`);
    process.exit(1);
  }
  if (res.status === 404) {
    console.error(`\n${DARWIN} has no POST /api/simulate/events. Update Darwin (the route ships with this demo site) and try again.`);
    process.exit(1);
  }
  if (res.status === 401 || res.status === 503) {
    console.error(`\nDarwin refused the seed (${res.status}). Pass --token <DARWIN_ADMIN_TOKEN> (or set DARWIN_ADMIN_TOKEN).`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\nDarwin answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  sent += (await res.json()).count ?? batch.length;
  process.stdout.write(`\r  sent ${sent}/${events.length} events`);
}
console.log(`\nDone: ${sent} synthetic events stored in Darwin (${DARWIN}).`);

for (let i = 0; i < LOOP_STEPS; i++) {
  const res = await fetch(`${DARWIN}/api/loop/step`, { method: "POST", headers }).catch(() => null);
  if (!res?.ok) {
    console.log(`  loop step ${i + 1}: Darwin answered ${res?.status ?? "no response"}; skipping the rest.`);
    break;
  }
  const state = await res.json();
  console.log(`  loop step ${i + 1}: phase ${state.phase}${state.insights?.[0] ? ` · top issue: ${state.insights[0].title}` : ""}${state.proposal ? ` · fix: ${state.proposal.title}` : ""}`);
}
console.log(`Open ${DARWIN}/console/issues (then Fixes, Experiments). Simulated traffic is labelled as such.`);
