/**
 * Buyer agent: a scripted shopping policy that talks to the store only through tools.
 *
 * Transport-agnostic (a `ToolCaller`), so the same policy runs in-process for the simulator
 * (hundreds per run, no I/O beyond event appends) and over MCP HTTP in scripts/grok-shopper.ts.
 *
 * Randomness is a deterministic hash of the session id, so runs are reproducible.
 */
import type { AgentProduct, ShoppingGoal } from "@/lib/contracts";
import { formatGBP } from "@/lib/money";
import type { AgentOrder, AgentToolName, AgentToolResult, NegotiationOutcome, ToolCaller } from "./types";

/**
 * Probability that a buyer proceeds anyway when the store hides something it needs.
 * These are the knobs that make the agent surface matter:
 *   - deliveryEtaDays: goal has a deadline; 20% gamble on "standard delivery is probably fine".
 *   - returnPolicy: principal requires free returns; 25% assume they're free.
 *   - stock: can't pre-check the size; 60% just try add_to_cart.
 *   - landedPrice: list price is within £5 of the budget, so unknown shipping may bust it; 50% risk it.
 */
export const PROCEED_ANYWAY = { deliveryEtaDays: 0.2, returnPolicy: 0.25, stock: 0.6, landedPrice: 0.5 } as const;
/** Share of buyers who take the merchant's bundle sweetener when it fits the budget. */
export const BUNDLE_TAKE_RATE = 0.4;
/** Buyers who negotiate look at items up to budget / STRETCH (i.e. ~15% over budget). */
export const STRETCH = 0.85;
/** A buyer's guess at shipping when the store hides it, pence. */
const SHIPPING_GUESS = 500;
const MAX_CANDIDATES = 3;

export interface BuyerStep {
  tool: AgentToolName;
  args: Record<string, unknown>;
  result: AgentToolResult;
}

export interface BuyerRunResult {
  outcome: "purchased" | "abandoned";
  reason?: string;
  order?: AgentOrder;
  steps: BuyerStep[];
  policy: "scripted" | "llm";
}

export interface BuyerHooks {
  onStep?: (step: BuyerStep) => void;
  onThought?: (text: string) => void;
}

/* ------------------------------------------------------------------ goal helpers */

/** FNV-1a → [0, 1). */
export function unitHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** Fields a buyer asks for, derived from its goal. */
export function wantFromGoal(goal: ShoppingGoal): string[] {
  const want: string[] = [];
  if (goal.size) want.push("sizes");
  if (goal.deadlineDays !== undefined) want.push("deliveryEtaDays");
  if (goal.requiresFreeReturns) want.push("returnPolicy");
  if (goal.maxBudget !== undefined) want.push("landedPrice");
  return want;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "by Friday" / "by tomorrow" from the brief, else "within N days". */
export function deadlineLabel(goal: ShoppingGoal): string {
  const m = goal.brief.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b/i);
  if (m) return `by ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`;
  const d = goal.deadlineDays ?? 0;
  return `within ${d} day${d === 1 ? "" : "s"}`;
}

export function sizeLabel(size: string): string {
  return /^\d/.test(size) ? `UK ${size}` : size;
}

/**
 * Heuristic parse of a natural-language brief into a ShoppingGoal:
 * "trail shoes UK 10 under £140 by Friday, free returns" →
 * { category: "trail", size: "10", maxBudget: 14000, deadlineDays: <days to Friday>, requiresFreeReturns: true }.
 */
export function parseGoalBrief(brief: string, today: Date = new Date()): ShoppingGoal {
  const text = brief.toLowerCase();
  const goal: ShoppingGoal = { brief };

  if (/\btrail|fell|off-?road|mud/.test(text)) goal.category = "trail";
  else if (/\b(racing|race day|carbon|super ?shoe)/.test(text)) goal.category = "racing";
  else if (/\b(sock|vest|hydration|accessor)/.test(text)) goal.category = "accessories";
  else if (/\broad\b/.test(text)) goal.category = "road";

  const size = text.match(/\b(?:uk|size)\s*(\d{1,2}(?:\.5)?)\b/) ?? text.match(/\b(s\/m|l\/xl)\b/);
  if (size) goal.size = size[1].toUpperCase();

  const budget = text.match(/(?:under|below|less than|max(?:imum)?|up to|budget(?: of)?|within|<)\s*£\s*(\d+(?:\.\d{1,2})?)/) ?? text.match(/£\s*(\d+(?:\.\d{1,2})?)\s*(?:max|budget|or less)/);
  if (budget) goal.maxBudget = Math.round(Number(budget[1]) * 100);

  const day = text.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  const within = text.match(/\b(?:within|in)\s+(\d{1,2})\s+days?\b/);
  if (day) {
    const diff = (DAYS.indexOf(day[1]) - today.getUTCDay() + 7) % 7;
    goal.deadlineDays = diff === 0 ? 7 : diff;
  } else if (/\b(by )?tomorrow\b|next[- ]day/.test(text)) goal.deadlineDays = 1;
  else if (within) goal.deadlineDays = Number(within[1]);

  if (/free returns?/.test(text)) goal.requiresFreeReturns = true;
  if (/negotiat|haggle|best (price|deal)|discount|bargain/.test(text)) goal.negotiates = true;
  return goal;
}

function describeGoal(goal: ShoppingGoal): string {
  const parts = [goal.category ?? "any product"];
  if (goal.size) parts.push(sizeLabel(goal.size));
  if (goal.maxBudget !== undefined) parts.push(`≤ ${formatGBP(goal.maxBudget)}`);
  if (goal.deadlineDays !== undefined) parts.push(`delivered ${deadlineLabel(goal)}`);
  if (goal.requiresFreeReturns) parts.push("free returns");
  return parts.join(", ");
}

/* ------------------------------------------------------------------ scripted policy */

const round50 = (n: number) => Math.round(n / 50) * 50;

type Rejection = { rank: number; reason: string };

/**
 * Run the scripted policy to completion. Always ends with a checkout that succeeded
 * (purchased) or an `abandon` tool call carrying a human-readable reason.
 */
export async function runScriptedBuyer(
  goal: ShoppingGoal,
  call: ToolCaller,
  opts: { seed: string } & BuyerHooks,
): Promise<BuyerRunResult> {
  const steps: BuyerStep[] = [];
  const rand = (key: string) => unitHash(`${opts.seed}:${key}`);
  const think = (text: string) => opts.onThought?.(text);
  const invoke = async (tool: AgentToolName, args: Record<string, unknown>) => {
    const result = await call(tool, args);
    const step = { tool, args, result };
    steps.push(step);
    opts.onStep?.(step);
    return result;
  };
  const abandon = async (reason: string): Promise<BuyerRunResult> => {
    think(`Giving up: ${reason}`);
    await invoke("abandon", { reason });
    return { outcome: "abandoned", reason, steps, policy: "scripted" };
  };

  const want = wantFromGoal(goal);
  const budget = goal.maxBudget;
  const canStretch = !!goal.negotiates && budget !== undefined;
  const size = goal.size;

  think(`Looking for ${describeGoal(goal)}.`);
  const search = await invoke("search_products", {
    query: goal.brief,
    ...(goal.category ? { category: goal.category } : {}),
    ...(budget !== undefined ? { maxPrice: canStretch ? Math.floor(budget / STRETCH) : budget } : {}),
    ...(size ? { size } : {}),
    want,
  });
  if (!search.ok) return abandon(`search failed: ${search.error ?? "unknown error"}`);
  const products = (search.data as AgentProduct[] | undefined) ?? [];
  if (!products.length) {
    return abandon(`no ${goal.category ?? "products"}${size ? ` in ${sizeLabel(size)}` : ""}${budget !== undefined ? ` within ${formatGBP(budget)}` : ""}`);
  }
  const missing = new Set(search.missing ?? []);
  if (missing.size) think(`The store doesn't expose: ${[...missing].join(", ")}.`);

  // 1. Filter on what the store does tell us.
  const candidates: { p: AgentProduct; stretch: boolean }[] = [];
  let firstRejection: Rejection | undefined;
  const reject = (r: Rejection) => {
    firstRejection ??= r;
  };
  for (const p of products) {
    if (goal.deadlineDays !== undefined && p.deliveryEtaDays !== undefined && p.deliveryEtaDays > goal.deadlineDays) {
      reject({ rank: 0, reason: `${p.name} takes ${p.deliveryEtaDays} days to deliver — can't make it ${deadlineLabel(goal)}` });
      continue;
    }
    if (goal.requiresFreeReturns && p.returnPolicy && !p.returnPolicy.free) {
      reject({ rank: 1, reason: `${p.name} doesn't offer free returns` });
      continue;
    }
    if (size && p.sizes) {
      const s = p.sizes.find((x) => x.size.toLowerCase() === size.toLowerCase());
      if (!s?.inStock) {
        reject({ rank: 2, reason: `${p.name} is out of stock in ${sizeLabel(size)}` });
        continue;
      }
    }
    const known = p.landedPrice?.amount ?? p.price.amount;
    if (budget !== undefined && known > budget) {
      if (canStretch && known * STRETCH <= budget) candidates.push({ p, stretch: true });
      else reject({ rank: 3, reason: `${p.name} costs ${formatGBP(known)}, over the ${formatGBP(budget)} budget` });
      continue;
    }
    candidates.push({ p, stretch: false });
  }
  candidates.sort((a, b) => Number(a.stretch) - Number(b.stretch));
  if (!candidates.length) return abandon(firstRejection?.reason ?? "nothing suitable");

  // 2. Work through the best candidates.
  let hiddenInfoChecked = false;
  let stockGambleChecked = false;
  let lastReason: string | undefined;
  for (const { p, stretch } of candidates.slice(0, MAX_CANDIDATES)) {
    const view = await invoke("get_product", { id: p.id, want });
    const detail = view.ok ? (view.data as AgentProduct) : p;
    const hidden = view.ok ? new Set(view.missing ?? []) : missing;

    if (!hiddenInfoChecked) {
      hiddenInfoChecked = true;
      if (goal.deadlineDays !== undefined && hidden.has("deliveryEtaDays") && rand("eta") >= PROCEED_ANYWAY.deliveryEtaDays) {
        return abandon(`no delivery ETA exposed — can't guarantee delivery ${deadlineLabel(goal)}`);
      }
      if (goal.requiresFreeReturns && hidden.has("returnPolicy") && rand("returns") >= PROCEED_ANYWAY.returnPolicy) {
        return abandon("no return policy exposed — can't confirm the free returns my principal requires");
      }
      if (
        budget !== undefined &&
        !stretch &&
        hidden.has("landedPrice") &&
        detail.price.amount + SHIPPING_GUESS > budget &&
        rand("landed") >= PROCEED_ANYWAY.landedPrice
      ) {
        return abandon(`no landed price exposed — can't confirm the total incl. shipping fits the ${formatGBP(budget)} budget`);
      }
    }

    // Size / stock.
    let chosenSize = size;
    if (!chosenSize && detail.sizes) chosenSize = detail.sizes.find((s) => s.inStock)?.size;
    if (size) {
      const avail = await invoke("check_availability", { id: p.id, size });
      if (avail.ok) {
        if (!(avail.data as { inStock: boolean }).inStock) {
          lastReason = `${p.name} is out of stock in ${sizeLabel(size)}`;
          continue;
        }
      } else if (avail.missing?.includes("stock") && !stockGambleChecked) {
        stockGambleChecked = true;
        if (rand("stock") >= PROCEED_ANYWAY.stock) return abandon(`no stock levels exposed — can't confirm ${sizeLabel(size)} is available`);
        think(`Stock is hidden; trying ${sizeLabel(size)} anyway.`);
      }
    }

    // Negotiate.
    const shipping = detail.landedPrice?.shipping ?? SHIPPING_GUESS;
    let unitPrice = detail.price.amount;
    let bundle: NegotiationOutcome["bundle"];
    if (goal.negotiates || stretch) {
      const reservation = Math.min(detail.price.amount, budget !== undefined ? budget - shipping : detail.price.amount);
      const deal = await negotiate(detail, reservation, invoke);
      if (deal.kind === "disabled") {
        if (stretch) return abandon(`${formatGBP(detail.price.amount)} is over the ${formatGBP(budget!)} budget and the store won't negotiate`);
        think("No negotiation here; paying list price.");
      } else if (deal.kind === "walk") {
        lastReason = `merchant's best and final ${formatGBP(deal.finalPrice)} for ${p.name} is over my ${formatGBP(budget ?? deal.finalPrice)} budget`;
        continue;
      } else {
        unitPrice = deal.price;
        bundle = deal.bundle;
      }
    }

    // Cart.
    let add = await invoke("add_to_cart", { id: p.id, ...(chosenSize ? { size: chosenSize } : {}), quantity: 1 });
    if (!add.ok && add.code === "invalid_args" && !chosenSize) {
      const listed = add.error?.match(/Sizes: ([^.]+)\./)?.[1]?.split(", ");
      if (listed?.length) add = await invoke("add_to_cart", { id: p.id, size: listed[Math.floor(listed.length / 2)], quantity: 1 });
    }
    if (!add.ok) {
      lastReason = add.code === "out_of_stock" ? `${p.name} is sold out in ${sizeLabel(chosenSize ?? "my size")}` : `couldn't add ${p.name} to cart: ${add.error}`;
      continue;
    }
    if (bundle && (budget === undefined || unitPrice + bundle.price + shipping <= budget) && rand("bundle") < BUNDLE_TAKE_RATE) {
      think(`Taking the bundle: ${bundle.name} for ${formatGBP(bundle.price)}.`);
      await invoke("add_to_cart", { id: bundle.productId, quantity: 1 });
    }

    // Checkout, never above budget.
    const co = await invoke("checkout", budget !== undefined ? { maxTotal: budget } : {});
    if (co.ok) {
      const order = co.data as AgentOrder;
      think(`Bought for ${formatGBP(order.total)}.`);
      return { outcome: "purchased", order, steps, policy: "scripted" };
    }
    if (co.code === "over_budget") {
      const d = co.data as { total: number; shipping: number } | undefined;
      return abandon(
        d
          ? `total ${formatGBP(d.total)} incl. ${formatGBP(d.shipping)} shipping is over the ${formatGBP(budget!)} budget`
          : `order total is over the ${formatGBP(budget!)} budget`,
      );
    }
    return abandon(`checkout failed: ${co.error ?? "unknown error"}`);
  }
  return abandon(lastReason ?? "nothing suitable");
}

type DealResult =
  | { kind: "disabled" }
  | { kind: "walk"; finalPrice: number }
  | { kind: "deal"; price: number; bundle?: NegotiationOutcome["bundle"] };

/**
 * Buyer side of the negotiation: open at ~80% of list (capped at the reservation price),
 * meet halfway, accept any counter within the reservation from round 2, walk when the
 * merchant's final price is above it. At most 4 calls; usually 2-3.
 */
async function negotiate(
  p: AgentProduct,
  reservation: number,
  invoke: (tool: AgentToolName, args: Record<string, unknown>) => Promise<AgentToolResult>,
): Promise<DealResult> {
  let offer = Math.min(reservation, round50(p.price.amount * 0.8));
  for (let round = 1; round <= 4; round++) {
    const r = await invoke("negotiate", {
      id: p.id,
      offer,
      message: round === 1 ? `Would you take ${formatGBP(offer)} for the ${p.name}?` : `I can do ${formatGBP(offer)}.`,
    });
    if (!r.ok) return r.missing?.includes("negotiation") ? { kind: "disabled" } : { kind: "walk", finalPrice: p.price.amount };
    const o = r.data as NegotiationOutcome;
    if (o.status === "accepted") return { kind: "deal", price: o.agreedPrice ?? offer, bundle: o.bundle };
    const counter = o.counterOffer ?? p.price.amount;
    if (counter <= reservation && (round >= 2 || o.status === "final")) {
      offer = counter;
      continue;
    }
    if (o.status === "final") return { kind: "walk", finalPrice: counter };
    const next = Math.min(reservation, round50((offer + counter) / 2));
    if (next <= offer && offer >= reservation && round >= 3) return { kind: "walk", finalPrice: counter };
    offer = Math.max(offer, next);
  }
  return { kind: "walk", finalPrice: p.price.amount };
}
