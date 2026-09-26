/**
 * Synthetic human sessions. Each visitor gets a persona and device, is served the spec
 * `resolveSpecForVisitor` picks for their distinct_id (so running experiments split traffic),
 * and walks the storefront funnel. Every step's probability comes from `behavior-model.ts`.
 *
 * Each visitor is generated from its own seed and draws a fixed set of latent "propensities"
 * (one uniform number per decision) before seeing the page. The page then decides whether each
 * propensity clears the model's threshold. Same seed = same person, so comparing two specs on the
 * same seed isolates the effect of the page (common random numbers).
 *
 * Events mirror what the real storefront + posthog-js would record ($pageview, $autocapture,
 * $rageclick, $pageleave, commerce events), always tagged `synthetic: true`.
 */
import type { AnalyticsEventInput, EventProperties, PageSpec } from "@/lib/contracts";
import { PRODUCTS, type Product } from "@/lib/catalog/products";
import { attributionProps, resolveSpecForVisitor } from "@/lib/spec/resolve";
import {
  CHECKOUT_STEP_NAMES,
  EXPRESS_COMPLETE,
  EXPRESS_SHOCK_FACTOR,
  PERSONAS,
  PERSONA_PROFILES,
  QUICK_ADD_USE,
  SHIPPING_SHOCK_ABANDON,
  SHOE_SIZES,
  TOPUP,
  UPSELL_TAKE,
  accountWallPass,
  checkoutPagePass,
  expressAdoption,
  gridOrder,
  productAffinity,
  shippingFor,
  stageProbability,
  type Device,
  type Persona,
} from "./behavior-model";
import { placeSession, type SimClock } from "./clock";
import { createRng, deriveSeed, type Rng } from "./rng";

/* ------------------------------------------------------------------ fixtures */

interface UserAgent {
  ua: string;
  os: string;
  browser: string;
}

const USER_AGENTS: Record<Device, UserAgent[]> = {
  Mobile: [
    {
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      os: "iOS",
      browser: "Mobile Safari",
    },
    {
      ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
      os: "Android",
      browser: "Chrome",
    },
    {
      ua: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
      os: "Android",
      browser: "Chrome",
    },
  ],
  Desktop: [
    {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      os: "Mac OS X",
      browser: "Chrome",
    },
    {
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
      os: "Windows",
      browser: "Microsoft Edge",
    },
    {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
      os: "Mac OS X",
      browser: "Safari",
    },
    {
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      os: "Windows",
      browser: "Firefox",
    },
  ],
  Tablet: [
    {
      ua: "Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      os: "iOS",
      browser: "Mobile Safari",
    },
  ],
};

const DIRECT = "$direct";
const REFERRERS: Record<Persona, [string, number][]> = {
  "bargain-hunter": [
    ["https://www.google.com/", 0.45],
    ["https://www.hotukdeals.com/", 0.25],
    ["https://www.idealo.co.uk/", 0.15],
    [DIRECT, 0.15],
  ],
  "mobile-skimmer": [
    ["https://l.instagram.com/", 0.4],
    ["https://www.google.com/", 0.3],
    ["https://www.tiktok.com/", 0.2],
    [DIRECT, 0.1],
  ],
  researcher: [
    ["https://www.google.com/", 0.5],
    ["https://www.runnersworld.com/uk/", 0.25],
    ["https://www.reddit.com/r/running/", 0.15],
    [DIRECT, 0.1],
  ],
  "impulse-buyer": [
    ["https://l.instagram.com/", 0.45],
    ["https://www.tiktok.com/", 0.3],
    [DIRECT, 0.25],
  ],
  "gift-shopper": [
    ["https://www.google.com/", 0.55],
    [DIRECT, 0.3],
    ["https://www.pinterest.co.uk/", 0.15],
  ],
};

const ORIGIN = "http://localhost:3000";
const SOCKS = PRODUCTS.find((p) => p.id === "p_socks")!;
const VEST = PRODUCTS.find((p) => p.id === "p_vest")!;


/* ------------------------------------------------------------------ session */

export interface HumanVisitResult {
  distinctId: string;
  persona: Persona;
  device: Device;
  /** "control" | "treatment" | "live". */
  variantKey: string;
  /** Events with ISO timestamps, in session order. */
  events: AnalyticsEventInput[];
  ordered: boolean;
  revenue: number;
}

interface CartLine {
  product: Product;
  size: string;
  price: number;
  quantity: number;
}

function click(selector: string, text: string): EventProperties {
  return { $event_type: "click", $el_text: text, $elements_chain: `${selector}:text="${text}"` };
}

function sizeFor(product: Product, shoeSize: string): string {
  if (product.stock[shoeSize] !== undefined) return shoeSize;
  const keys = Object.keys(product.stock);
  return keys.find((k) => product.stock[k] > 0) ?? keys[0];
}

/** Pick a product from the grid, weighted by persona taste and grid position, excluding `seen`. */
function pickProduct(rng: Rng, spec: PageSpec, persona: Persona, device: Device, seen: Set<string>): Product | undefined {
  const entries = gridOrder(spec)
    .map((p, i) => [p, productAffinity(persona, p, i, device)] as const)
    .filter(([p]) => !seen.has(p.id));
  return entries.length ? rng.weighted(entries) : undefined;
}

/** Latent per-visitor propensities: one uniform draw per decision, fixed before the page is seen. */
function drawPropensities(rng: Rng) {
  return {
    browse: rng.next(),
    quick: rng.next(),
    altProduct: rng.next(),
    add: rng.next(),
    cart: rng.next(),
    topup: rng.next(),
    upsell: rng.next(),
    checkout: rng.next(),
    express: rng.next(),
    account: rng.next(),
    shock: rng.next(),
    pages: [rng.next(), rng.next(), rng.next()],
    pay: rng.next(),
    expressDone: rng.next(),
  };
}

/**
 * Simulate one human visit from its seed. `clock` places the session on the wall clock.
 * Streams: `who` (identity + propensities), `browse` (product choice), `fx` (ids, timing, clicks).
 */
export function simulateHumanVisit(seed: number, clock: SimClock): HumanVisitResult {
  const who = createRng(seed);
  const browse = createRng(deriveSeed(seed, 1));
  const fx = createRng(deriveSeed(seed, 2));

  const persona = who.weighted(PERSONAS.map((p) => [p, PERSONA_PROFILES[p].share] as const));
  const profile = PERSONA_PROFILES[persona];
  const device = who.weighted(Object.entries(profile.devices) as [Device, number][]);
  const shoeSize = who.weighted(SHOE_SIZES);
  const productsToView = who.weighted(profile.productsViewed);
  const u = drawPropensities(who);

  const distinctId = `sim_h_${fx.token(10)}`;
  const sessionId = `sim_s_${fx.token(12)}`;
  const resolved = resolveSpecForVisitor(distinctId);
  const spec = resolved.spec;
  const agent = fx.pick(USER_AGENTS[device]);
  const referrer = fx.weighted(REFERRERS[persona]);
  const dwell = (median: number) => fx.duration(median * profile.dwell * (device === "Mobile" ? 0.85 : 1));

  const base: EventProperties = {
    visitor_kind: "human",
    synthetic: true,
    persona,
    $session_id: sessionId,
    $device_type: device,
    $user_agent: agent.ua,
    $os: agent.os,
    $browser: agent.browser,
    ...attributionProps(resolved),
  };

  const events: AnalyticsEventInput[] = [];
  const offsets: number[] = [];
  let t = 0;
  let path = "/store";
  const emit = (event: string, props: EventProperties = {}) => {
    events.push({
      event,
      distinct_id: distinctId,
      properties: { ...base, $pathname: path, $current_url: `${ORIGIN}${path}`, ...props },
    });
    offsets.push(Math.round(t));
    t += fx.range(80, 600); // client batching jitter between consecutive events
  };
  const navigate = (to: string, props: EventProperties = {}) => {
    const from = path;
    path = to;
    emit("$pageview", from === to ? props : { $prev_pathname: from, ...props });
  };
  const result = (ordered: boolean, revenue = 0): HumanVisitResult => {
    emit("$pageleave");
    const stamps = placeSession(offsets, fx, clock);
    events.forEach((e, i) => (e.timestamp = stamps[i]));
    return { distinctId, persona, device, variantKey: resolved.variant ?? "live", events, ordered, revenue };
  };

  /* ---- landing */
  navigate("/store", { $referrer: referrer, $referring_domain: referrer === DIRECT ? DIRECT : new URL(referrer).hostname });
  t += dwell(12_000);
  if (!(u.browse < stageProbability("browse", spec, persona, { device }))) return result(false);

  /* ---- browse products */
  const quick = spec.productGrid.showQuickAdd && u.quick < QUICK_ADD_USE[persona];
  const belowFoldCta = spec.productPage.ctaPosition === "below-description";
  const seen = new Set<string>();
  let considered: Product | undefined;
  let raged = false;

  const viewProduct = (p: Product) => {
    emit("$autocapture", click('a[data-darwin="product-tile"]', p.name));
    navigate(`/store/products/${p.slug}`);
    emit("product_viewed", { product_id: p.id, price: p.price, name: p.name, category: p.category, compare_at_price: p.compareAtPrice });
    seen.add(p.id);
    t += dwell(spec.productPage.showReviews && persona === "researcher" ? 60_000 : 40_000);
    // Hunting for a buy button that sits below a long description on a phone.
    if (belowFoldCta && device === "Mobile" && !raged && fx.chance(0.16)) {
      raged = true;
      emit("$rageclick", click('div[data-darwin="product-gallery"]', p.name));
    }
  };

  if (fx.chance(0.35)) emit("$autocapture", click('a[data-darwin="hero-cta"]', spec.hero.ctaText));
  if (quick) {
    considered = pickProduct(browse, spec, persona, device, seen);
    if (!considered) return result(false);
    seen.add(considered.id);
    emit("product_viewed", {
      product_id: considered.id,
      price: considered.price,
      name: considered.name,
      category: considered.category,
      source: "grid",
    });
    t += dwell(6_000);
  } else {
    for (let i = 0; i < productsToView; i++) {
      if (i > 0) navigate("/store");
      const p = pickProduct(browse, spec, persona, device, seen);
      if (!p) break;
      viewProduct(p);
      considered = p;
    }
    if (!considered) return result(false);
  }

  /* ---- size availability: clicking a sold-out size */
  let size = sizeFor(considered, shoeSize);
  if ((considered.stock[size] ?? 0) <= 0) {
    emit("$autocapture", click('button[data-darwin="size-option"][disabled]', `UK ${size}`));
    if (fx.chance(0.45)) emit("$rageclick", click('button[data-darwin="size-option"][disabled]', `UK ${size}`));
    const alt =
      u.altProduct < 0.5
        ? PRODUCTS.find((p) => !seen.has(p.id) && p.category === considered!.category && (p.stock[shoeSize] ?? 0) > 0)
        : undefined;
    if (!alt) return result(false);
    viewProduct(alt);
    considered = alt;
    size = sizeFor(alt, shoeSize);
  }

  /* ---- add to cart */
  const surface = path === "/store" ? "grid" : "pdp";
  if (!(u.add < stageProbability("add", spec, persona, { device, product: considered, surface }))) {
    if (surface === "pdp" && belowFoldCta && device !== "Desktop" && !raged && fx.chance(0.1)) {
      emit("$rageclick", click('div[data-darwin="product-description"]', considered.name));
    }
    return result(false);
  }
  emit(
    "$autocapture",
    click(`button[data-darwin="${surface === "grid" ? "quick-add" : "add-to-cart"}"]`, surface === "grid" ? "Quick add" : spec.productPage.ctaText),
  );
  const cart: CartLine[] = [{ product: considered, size, price: considered.price, quantity: 1 }];
  emit("product_added", {
    product_id: considered.id,
    price: considered.price,
    quantity: 1,
    size,
    source: surface === "grid" ? "quick_add" : "product_page",
  });
  t += dwell(5_000);

  /* ---- cart */
  if (!(u.cart < stageProbability("cart", spec, persona, { device }))) return result(false);
  emit("$autocapture", click('a[data-darwin="cart-link"]', "Bag"));
  navigate("/store/cart");
  const subtotal = () => cart.reduce((s, l) => s + l.price * l.quantity, 0);
  const items = () => cart.reduce((n, l) => n + l.quantity, 0);
  const addLine = (p: Product, source: string) => {
    const existing = cart.find((l) => l.product.id === p.id);
    const lineSize = existing?.size ?? sizeFor(p, shoeSize);
    if (existing) existing.quantity += 1;
    else cart.push({ product: p, size: lineSize, price: p.price, quantity: 1 });
    emit("$autocapture", click('button[data-darwin="add-accessory"]', p.name));
    emit("product_added", { product_id: p.id, price: p.price, quantity: 1, size: lineSize, source });
  };

  // Free-shipping top-up: add an accessory to reach the threshold.
  const threshold = spec.cart.freeShippingThreshold;
  if (threshold !== null && subtotal() < threshold && threshold - subtotal() <= TOPUP.maxGap && u.topup < TOPUP.take[persona]) {
    for (let guard = 0; guard < 3 && subtotal() < threshold; guard++) {
      addLine(threshold - subtotal() > SOCKS.price * 2 ? VEST : SOCKS, "free_shipping_topup");
    }
  }
  // Cross-sell.
  if (spec.cart.upsell && u.upsell < UPSELL_TAKE[persona]) {
    addLine(cart.some((l) => l.product.id === SOCKS.id) ? VEST : SOCKS, "cart_upsell");
  }

  const shipping = shippingFor(spec, subtotal());
  const upfront = spec.cart.showShippingUpfront;
  emit("cart_viewed", {
    subtotal: subtotal(),
    items: items(),
    product_ids: cart.map((l) => l.product.id),
    shipping_shown: upfront,
    ...(upfront ? { shipping } : {}),
    free_shipping_threshold: threshold,
  });
  t += dwell(14_000);

  if (!(u.checkout < stageProbability("checkout", spec, persona, { device, subtotal: subtotal() }))) return result(false);

  /* ---- checkout */
  const express = u.express < expressAdoption(spec, persona, device);
  const steps = spec.checkout.steps;
  emit("$autocapture", click(`button[data-darwin="${express ? "express-pay" : "checkout"}"]`, express ? "Express checkout" : "Checkout"));
  emit("checkout_started", { subtotal: subtotal(), items: items(), method: express ? "express" : "standard", steps: express ? 1 : steps });
  navigate("/store/checkout");

  const abandon = (reason: string, props: EventProperties = {}) => {
    emit("checkout_abandoned", { reason, subtotal: subtotal(), ...props });
    t += dwell(3_000);
    return result(false);
  };
  const complete = (method: "card" | "express") => {
    const sub = subtotal();
    const revenue = sub + shipping;
    emit("order_completed", {
      order_id: `ord_${fx.token(10)}`,
      revenue,
      subtotal: sub,
      shipping,
      items: items(),
      product_id: cart[0].product.id,
      product_ids: cart.map((l) => l.product.id),
      payment_method: method,
    });
    navigate("/store/checkout/success");
    t += dwell(6_000);
    return result(true, revenue);
  };

  // Forced account creation (before any payment method is offered).
  if (!spec.checkout.guestCheckout) {
    t += dwell(8_000);
    if (!(u.account < accountWallPass(spec, persona, device))) return abandon("account_required", { step: 1, step_name: "account" });
    emit("$autocapture", click('button[data-darwin="create-account"]', "Create account"));
    t += dwell(25_000);
  }

  if (express) {
    t += dwell(10_000);
    if (shipping > 0 && !upfront) {
      emit("shipping_cost_revealed", { shipping, subtotal: subtotal(), step: 1, step_name: "express", upfront: false });
      if (u.shock < SHIPPING_SHOCK_ABANDON[persona] * EXPRESS_SHOCK_FACTOR) {
        return abandon("unexpected_shipping_cost", { step: 1, step_name: "express", shipping });
      }
    }
    if (!(u.expressDone < EXPRESS_COMPLETE)) return abandon("express_cancelled", { step: 1, step_name: "express" });
    emit("checkout_step_completed", { step: 1, steps: 1, step_name: "express", method: "express" });
    return complete("express");
  }

  const pagePass = checkoutPagePass(spec, persona, device);
  const names = CHECKOUT_STEP_NAMES[steps];
  for (let i = 1; i <= steps; i++) {
    const last = i === steps;
    const stepName = names[i - 1];
    t += dwell(device === "Mobile" ? 45_000 : 32_000);
    if (last && shipping > 0 && !upfront) {
      emit("shipping_cost_revealed", { shipping, subtotal: subtotal(), step: i, step_name: stepName, upfront: false });
      t += dwell(4_000);
      if (u.shock < SHIPPING_SHOCK_ABANDON[persona]) return abandon("unexpected_shipping_cost", { step: i, step_name: stepName, shipping });
    }
    if (!(u.pages[i - 1] < pagePass)) {
      if (device === "Mobile" && fx.chance(0.12)) emit("$rageclick", click('input[data-darwin="checkout-field"]', stepName));
      return abandon("checkout_friction", { step: i, step_name: stepName });
    }
    if (last && !(u.pay < stageProbability("pay", spec, persona, { device }))) {
      return abandon(fx.chance(0.4) ? "payment_declined" : "changed_mind", { step: i, step_name: stepName });
    }
    emit("$autocapture", click(`button[data-darwin="${last ? "place-order" : "checkout-continue"}"]`, last ? "Place order" : "Continue"));
    emit("checkout_step_completed", { step: i, steps, step_name: stepName, method: "card" });
  }
  return complete("card");
}
