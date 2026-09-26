/**
 * Plain words for the storefront elements shoppers interact with. Friction events carry a raw element
 * description such as `/store/products/[id] button[data-darwin="size-option"][disabled] "UK 12"`; insight
 * titles are read by merchants, so we name the element ("sold-out size UK 12") instead of the selector.
 * Pure and dependency-free: the optimizer uses it when writing insights, the console when showing old ones.
 */

const ELEMENT_NAMES: Record<string, string> = {
  "size-option": "size",
  "color-option": "colour",
  "cta-add-to-cart": "Add to bag button",
  "sticky-cta-bar": "sticky Add to bag bar",
  "quick-add": "quick-add button",
  "hero-cta": "main banner button",
  "hero-secondary": "second banner button",
  "cart-checkout": "Checkout button",
  "cart-qty-inc": "quantity + button",
  "cart-qty-dec": "quantity − button",
  "cart-remove": "Remove button",
  "cart-upsell": "bag upsell",
  "upsell-add": "upsell Add button",
  "express-pay": "express pay button",
  "express-pay-apple": "Apple Pay button",
  "express-pay-google": "Google Pay button",
  "checkout-autofill": "autofill button",
  "coupon-apply": "coupon Apply button",
  "coupon-input": "coupon box",
  "nav-cart": "bag icon",
  "nav-search": "search icon",
  "nav-account": "account icon",
  "search-submit": "search button",
  "search-input": "search box",
  "size-guide-open": "size guide link",
  "reviews-link": "reviews link",
  "product-card": "product card",
  "product-link": "product link",
  "newsletter-join": "newsletter sign-up",
  "continue-shopping": "Continue shopping link",
  "toast-checkout": "checkout pop-up",
};

export interface ElementInfo {
  /** "size", "Add to bag button" … */
  label: string;
  /** Visible text on the element, e.g. "UK 12". */
  text?: string;
  /** The element was disabled (sold out / unavailable) when clicked. */
  disabled: boolean;
  /** The data-darwin name, e.g. "size-option". */
  name: string;
}

/** Parse a raw element description; undefined when it doesn't name a data-darwin element. */
export function describeElement(raw: string): ElementInfo | undefined {
  const m = /data-darwin=["']?([a-z0-9-]+)/i.exec(raw);
  if (!m) return undefined;
  const name = m[1].toLowerCase();
  const disabled = /\[disabled\]|:disabled|aria-disabled=["']?true/i.test(raw);
  // Trailing quoted text after the selector: … [disabled] "UK 12"
  const text = /\]\s*["“]([^"”]+)["”]\s*$/.exec(raw)?.[1]?.trim();
  const label = ELEMENT_NAMES[name] ?? name.replace(/-/g, " ");
  return { label, text: text || undefined, disabled, name };
}

/** "sold-out size UK 12", "Add to bag button", "unavailable colour Black" … Falls back to the raw text. */
export function elementPhrase(raw: string): string {
  const el = describeElement(raw);
  if (!el) return raw;
  if (el.disabled) {
    const kind = el.name === "size-option" || el.name === "color-option" ? "sold-out" : "unavailable";
    return `${kind} ${el.label}${el.text ? ` ${el.text}` : ""}`;
  }
  if (el.name === "size-option" || el.name === "color-option") return `${el.label} ${el.text ?? ""}`.trim();
  return el.text && !el.label.toLowerCase().includes(el.text.toLowerCase()) ? `${el.label} “${el.text}”` : el.label;
}

/** Title for a rage-click insight: "134 shoppers kept tapping sold-out size UK 12". */
export function rageClickTitle(count: string, raw: string): string {
  const el = describeElement(raw);
  if (!el) return `${count} shoppers rage-clicked "${raw}"`;
  return el.disabled ? `${count} shoppers kept tapping ${elementPhrase(raw)}` : `${count} shoppers rage-clicked the ${elementPhrase(raw)}`;
}

/** Detail sentence tail for taps on a sold-out / unavailable element. */
export const UNAVAILABLE = (what: string) =>
  `tapped ${what} again and again: they want it, but it's unavailable and the page offers no way forward (notify me, stock levels or an alternative).`;

const RAGE_TITLE = /^([\d,.]+) shoppers rage-clicked "(.*)"$/;
const HAMMERED = /hammered "(.+?)" \((.+?)\) repeatedly/;

/** Rewrite insight text written before titles were humanised (older loop state). No-op otherwise. */
export function humanizeInsightText(text: string): string {
  if (!text.includes("data-darwin")) return text;
  const t = RAGE_TITLE.exec(text);
  if (t) return rageClickTitle(t[1], t[2]);
  const h = HAMMERED.exec(text);
  if (h) {
    const el = describeElement(h[1]);
    const head = text.slice(0, h.index);
    return el?.disabled
      ? `${head}${UNAVAILABLE(`the ${elementPhrase(h[1])}`)}`
      : text.replace(HAMMERED, `hammered the ${elementPhrase(h[1])} repeatedly`);
  }
  return elementPhrase(text);
}
