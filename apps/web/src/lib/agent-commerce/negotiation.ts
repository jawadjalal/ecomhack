/**
 * Merchant agent: a rule-based concession strategy. Pure — the dispatcher owns state and tracking.
 *
 * Guarantees (tested):
 *   - never concedes below max(product.floorPrice, price × (1 − maxDiscountPct/100)),
 *   - never asks more than list, and counter-offers only move down,
 *   - counters converge to that floor by round 3 ("best and final"),
 *   - accepts any offer at or above its current counter,
 *   - from round 2 it sweetens with a discounted socks bundle (honoured once a deal is agreed).
 *
 * Numbers always come from the rules. An LLM may optionally rephrase the message
 * (DARWIN_MERCHANT_LLM=1 + a configured provider), never change the price.
 */
import { getProduct, type Product } from "@/lib/catalog/products";
import { generateText, llmAvailable } from "@/lib/llm/client";
import { formatGBP } from "@/lib/money";
import type { NegotiationOutcome } from "./types";

export const MAX_ROUNDS = 3;
/** Share of the (list − floor) gap the merchant has conceded after each round. */
const CONCESSION = [0.4, 0.75, 1];
export const BUNDLE_PRODUCT_ID = "p_socks";

export interface NegotiationState {
  /** Merchant turns so far for this product. */
  round: number;
  lastCounter?: number;
  agreedPrice?: number;
}

/** The lowest unit price the merchant agent will ever accept for this product under this spec. */
export function merchantFloor(product: Product, maxDiscountPct: number): number {
  const byPct = Math.ceil(product.price * (1 - maxDiscountPct / 100));
  return Math.min(product.price, Math.max(product.floorPrice, byPct));
}

function roundUpTo50p(pence: number) {
  return Math.ceil(pence / 50) * 50;
}

export function bundleOffer(product: Product, maxDiscountPct: number): NegotiationOutcome["bundle"] {
  if (product.id === BUNDLE_PRODUCT_ID) return undefined;
  const socks = getProduct(BUNDLE_PRODUCT_ID);
  if (!socks) return undefined;
  // Same rules as the main item: the socks' own floor and this spec's discount ceiling.
  const price = merchantFloor(socks, maxDiscountPct);
  if (price >= socks.price) return undefined;
  return { productId: socks.id, name: socks.name, price, listPrice: socks.price };
}

/** One merchant turn in response to a buyer offer (pence). */
export function negotiateRound(
  product: Product,
  offer: number,
  state: NegotiationState,
  maxDiscountPct: number,
): { outcome: NegotiationOutcome; state: NegotiationState } {
  const list = product.price;
  const floor = merchantFloor(product, maxDiscountPct);
  const base = { productId: product.id, listPrice: list, offer };

  if (state.agreedPrice !== undefined) {
    return {
      outcome: {
        ...base,
        status: "accepted",
        round: state.round,
        agreedPrice: state.agreedPrice,
        message: `We already have a deal: ${product.name} at ${formatGBP(state.agreedPrice)}. Add it to your cart whenever you're ready.`,
      },
      state,
    };
  }

  const round = state.round + 1;
  const scheduled = round >= MAX_ROUNDS ? floor : roundUpTo50p(list - (list - floor) * CONCESSION[round - 1]);
  const counter = Math.max(floor, Math.min(scheduled, state.lastCounter ?? list, list));
  const bundle = round >= 2 ? bundleOffer(product, maxDiscountPct) : undefined;
  const sweetener = bundle
    ? ` Agree a deal and I'll add ${bundle.name} for ${formatGBP(bundle.price)} (usually ${formatGBP(bundle.listPrice)}).`
    : "";

  if (offer >= counter) {
    const agreed = Math.min(list, Math.max(offer, floor));
    const withDeal = agreed < list ? bundleOffer(product, maxDiscountPct) : undefined;
    return {
      outcome: {
        ...base,
        status: "accepted",
        round,
        agreedPrice: agreed,
        bundle: withDeal,
        message:
          agreed >= list
            ? `Happy to confirm ${product.name} at the list price of ${formatGBP(list)}.`
            : `Deal: ${product.name} for ${formatGBP(agreed)}. The price is held for this session and applied at checkout.${
                withDeal ? ` ${withDeal.name} can go in for ${formatGBP(withDeal.price)} too.` : ""
              }`,
      },
      state: { round, lastCounter: counter, agreedPrice: agreed },
    };
  }

  const final = counter <= floor;
  const message = final
    ? floor >= list
      ? `Sorry, ${product.name} is fixed at ${formatGBP(list)}; it's already our best price.${sweetener}`
      : `${formatGBP(offer)} is below what we can do. Best and final: ${formatGBP(floor)} for ${product.name}.${sweetener}`
    : `Thanks for the offer. ${product.name} lists at ${formatGBP(list)}; I can do ${formatGBP(counter)}.${sweetener}`;
  return {
    outcome: { ...base, status: final ? "final" : "counter", round, counterOffer: counter, bundle, message },
    state: { round, lastCounter: counter },
  };
}

/** True when the merchant may rephrase messages with an LLM. Off by default (speed, determinism). */
export function merchantLlmEnabled(): boolean {
  return process.env.DARWIN_MERCHANT_LLM === "1" && llmAvailable();
}

/**
 * Optionally rephrase the merchant's message with an LLM. The rule-based price must survive
 * verbatim, otherwise (or on any error / timeout) the rule-based text is returned.
 */
export async function phraseMerchantMessage(outcome: NegotiationOutcome, product: Product, buyerMessage?: string): Promise<string> {
  if (!merchantLlmEnabled()) return outcome.message;
  const price = outcome.agreedPrice ?? outcome.counterOffer;
  const mustInclude = price !== undefined ? formatGBP(price) : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      generateText({
        system:
          "You are the merchant agent for PACE, a London running shoe store, negotiating with a buyer's AI agent. " +
          "Rewrite the merchant reply in 1-2 friendly, concise sentences. Keep every price exactly as written. Do not invent new offers.",
        prompt: `Product: ${product.name}\nBuyer said: ${buyerMessage ?? "(an offer)"}\nMerchant reply to rewrite: ${outcome.message}`,
        maxTokens: 200,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 4000);
      }),
    ]);
    const clean = text.trim().replace(/^"|"$/g, "");
    if (!clean || clean.length > 400) return outcome.message;
    if (mustInclude && !clean.includes(mustInclude)) return outcome.message;
    return clean;
  } catch {
    return outcome.message;
  } finally {
    clearTimeout(timer);
  }
}
