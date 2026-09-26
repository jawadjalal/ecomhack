"use client";

/**
 * A live mini storefront rendered from a PageSpec: the page the change touches (bag, product page,
 * checkout, homepage) or, for agent-only changes, the store API's product response. Mirrors the
 * rules in src/components/store/* (cart-view, product-detail, checkout-view) and the agent surface
 * in lib/agent-commerce/surface.ts, so A and B look exactly as different as the spec makes them.
 *
 * Anything that differs from `other` is marked: dashed outline on A ("this changes"), ink on B.
 */
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Lock, Star, Truck, RotateCcw, ShieldCheck, Ruler } from "lucide-react";
import type { PageSpec } from "@/lib/contracts";
import { getProduct, SHIPPING_FEE } from "@/lib/catalog/products";
import { priceCart, shippingFor } from "@/lib/storefront/pricing";
import { formatGBP } from "@/lib/money";
import { cn } from "@/components/ui/cn";
import type { MockPage } from "./model";

const RADIUS: Record<PageSpec["theme"]["radius"], string> = { none: "2px", md: "8px", full: "999px" };
const BASKET = [
  { productId: "p_aurora", color: "Midnight", size: "9", quantity: 1 },
  { productId: "p_socks", color: "Black", size: "One size", quantity: 2 },
];

function get(spec: PageSpec, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), spec);
}

function useDiff(spec: PageSpec, other: PageSpec) {
  return (...paths: string[]) => paths.some((p) => JSON.stringify(get(spec, p)) !== JSON.stringify(get(other, p)));
}

/** Wraps a row that differs between A and B. */
function Mark({ on, arm, children, className, pad = true }: { on: boolean; arm: "A" | "B"; children: ReactNode; className?: string; pad?: boolean }) {
  if (!on) return <div className={cn(pad && "px-2", className)}>{children}</div>;
  if (arm === "A") {
    return <div className={cn("rounded-[8px] border-[1.5px] border-dashed border-dw-ink/80", pad ? "px-2 py-1" : "", className)}>{children}</div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26, delay: 0.25 }}
      className={cn("rounded-[8px] bg-dw-ink text-white shadow-[0_6px_16px_-8px_rgba(20,20,19,0.6)] [&_.mk-tint]:text-white", pad ? "px-2 py-1" : "", className)}
    >
      {children}
    </motion.div>
  );
}

function Chrome({ spec, bagCount, children }: { spec: PageSpec; bagCount?: number; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[292px] flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_0_0_1px_#EFE8DA]">
      {spec.announcement.enabled && spec.announcement.text && (
        <div className="flex h-[26px] shrink-0 items-center justify-center px-3 text-center text-[12px] font-semibold text-white" style={{ background: "#E8590C" }}>
          <span className="truncate">{spec.announcement.text}</span>
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#F2ECDF] px-4 text-[12px] text-[#7A7468]">
        <span className="max-sm:hidden">Road · Trail · Racing</span>
        <span className="font-bold tracking-[0.04em] text-dw-ink">{"// PACE"}</span>
        <span>Bag{bagCount ? ` (${bagCount})` : ""}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Button({ spec, children, className }: { spec: PageSpec; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn("flex h-[34px] items-center justify-center gap-1.5 px-3 text-center text-[13px] font-semibold text-white", className)}
      style={{ background: spec.theme.accent, borderRadius: RADIUS[spec.theme.radius] }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ pages */

function CartMock({ spec, other, arm }: MockProps) {
  const changed = useDiff(spec, other);
  const t = priceCart(BASKET, spec);
  const upfront = spec.cart.showShippingUpfront;
  const vest = getProduct("p_vest");
  return (
    <Chrome spec={spec} bagCount={t.itemCount}>
      <div className="grid h-full gap-4 p-4 sm:grid-cols-[1.3fr_1fr]">
        <div className="flex min-w-0 flex-col gap-2.5">
          <span className="text-[22px] font-semibold tracking-[-0.02em]">Your bag</span>
          {(spec.cart.freeShippingThreshold !== null || changed("cart.freeShippingThreshold")) && (
            <Mark on={changed("cart.freeShippingThreshold")} arm={arm} className="text-[12.5px]">
              <span className="flex items-center gap-1.5 py-0.5">
                <Truck className="size-3.5 shrink-0" aria-hidden />
                {t.threshold === null ? "Delivery always £4.95" : t.qualifiesForFree ? `Free delivery unlocked (over ${formatGBP(t.threshold)})` : `${formatGBP(t.remainingForFree)} away from free delivery`}
              </span>
            </Mark>
          )}
          {t.lines.map((l, i) => (
            <div key={l.key} className={cn("flex justify-between gap-3 px-2 text-[13.5px]", i < t.lines.length - 1 && "border-b border-[#F2ECDF] pb-2.5")}>
              <span className="truncate">
                {l.product.name.replace(/ \(3-pack\)/, "")}
                {l.quantity > 1 ? ` ×${l.quantity}` : ""}
              </span>
              <span className="num font-semibold">{formatGBP(l.lineTotal)}</span>
            </div>
          ))}
          {(spec.cart.upsell || changed("cart.upsell")) && vest && (
            <Mark on={changed("cart.upsell")} arm={arm} className="mt-auto text-[12.5px]">
              {spec.cart.upsell ? (
                <span className="flex items-center justify-between gap-2 py-0.5">
                  <span className="truncate">Complete your kit: {vest.name}</span>
                  <span className="shrink-0 font-semibold">+ Add</span>
                </span>
              ) : (
                <span className="block py-0.5 opacity-60">No suggestions</span>
              )}
            </Mark>
          )}
        </div>
        <div className="flex flex-col gap-2.5 rounded-[12px] bg-[#F7F4EE] p-3.5 text-[13.5px]">
          <div className="flex justify-between px-2">
            <span>Subtotal</span>
            <span className="num">{formatGBP(t.subtotal)}</span>
          </div>
          <Mark on={changed("cart.showShippingUpfront", "cart.freeShippingThreshold")} arm={arm}>
            <div className="flex justify-between gap-2">
              <span>Delivery</span>
              {upfront ? (
                <span className="num font-semibold">{t.shipping === 0 ? "Free" : formatGBP(t.shipping)}</span>
              ) : (
                <span className={arm === "B" && changed("cart.showShippingUpfront") ? "text-white/70" : "text-[#7A7468]"}>At checkout</span>
              )}
            </div>
          </Mark>
          <div className="flex justify-between px-2 font-semibold">
            <span>{upfront ? "Total" : "Estimated total"}</span>
            <span className="num">{formatGBP(upfront ? t.total : t.subtotal)}</span>
          </div>
          <div className={cn(changed("theme.accent", "theme.radius") && (arm === "A" ? "rounded-[10px] outline-[1.5px] outline-offset-2 outline-dw-ink outline-dashed" : ""))}>
            <Button spec={spec} className="mt-1">
              <Lock className="size-3.5" aria-hidden /> Checkout securely
            </Button>
          </div>
        </div>
      </div>
    </Chrome>
  );
}

function ProductMock({ spec, other, arm }: MockProps) {
  const changed = useDiff(spec, other);
  const p = getProduct("p_aurora")!;
  const pp = spec.productPage;
  const low = Object.entries(p.stock)
    .filter(([, n]) => n > 0 && n <= 5)
    .sort((a, b) => a[1] - b[1])[0];
  const ctaChanged = changed("productPage.ctaText", "productPage.ctaPosition", "theme.accent", "theme.radius");
  const cta = (
    <Mark on={ctaChanged} arm={arm} pad={false} className={cn(arm === "B" && ctaChanged && "bg-transparent p-1 shadow-none ring-2 ring-dw-ink ring-offset-1")}>
      <Button spec={spec}>
        <span className="truncate">{pp.ctaText}</span>
        <span className="font-normal opacity-70">· {formatGBP(p.price)}</span>
      </Button>
    </Mark>
  );
  const row = (path: string, show: boolean, node: ReactNode, empty: string) =>
    (show || changed(path)) && (
      <Mark on={changed(path)} arm={arm} className="text-[12.5px]">
        {show ? node : <span className="block py-0.5 opacity-55">{empty}</span>}
      </Mark>
    );
  return (
    <Chrome spec={spec}>
      <div className="relative grid h-full gap-4 p-4 sm:grid-cols-[0.85fr_1.15fr]">
        <div className="grid place-items-center rounded-[12px] bg-[#F4F1EA] max-sm:h-28">
          {/* eslint-disable-next-line @next/next/no-img-element -- static product art */}
          <img src={p.image} alt="" className="h-full max-h-40 w-full object-contain p-3" />
        </div>
        <div className="flex min-w-0 flex-col gap-2 pb-10">
          <div className="px-2">
            <div className="text-[17px] leading-tight font-semibold">{p.name}</div>
            <div className="num mt-0.5 text-[13.5px]">
              {formatGBP(p.price)} {p.compareAtPrice && <span className="text-[#9A9488] line-through">{formatGBP(p.compareAtPrice)}</span>}
            </div>
          </div>
          {row(
            "productPage.showReviews",
            pp.showReviews,
            <span className="flex items-center gap-1 py-0.5">
              <Star className="size-3.5 fill-current" aria-hidden /> {p.rating} · {p.reviewCount.toLocaleString("en-GB")} reviews
            </span>,
            "No reviews",
          )}
          {pp.ctaPosition === "above-fold" && cta}
          <div className="flex flex-wrap items-center gap-1 px-2">
            {["7", "8", "9", "10", "11"].map((s) => (
              <span key={s} className={cn("rounded-[6px] border px-1.5 py-0.5 text-[11px]", s === "9" ? "border-dw-ink bg-dw-ink text-white" : "border-[#E6E0D3]")}>
                {s}
              </span>
            ))}
          </div>
          {row(
            "productPage.urgency",
            pp.urgency === "low-stock" && Boolean(low),
            <span className="mk-tint block py-0.5 font-semibold text-[#c2410c]">{low ? `Only ${low[1]} left in UK ${low[0]}` : ""}</span>,
            "No stock message",
          )}
          {row(
            "productPage.showSizeGuide",
            pp.showSizeGuide,
            <span className="flex items-center gap-1 py-0.5 underline underline-offset-2">
              <Ruler className="size-3.5" aria-hidden /> Size guide
            </span>,
            "No size guide",
          )}
          {pp.ctaPosition !== "above-fold" && (
            <div className="space-y-1 px-2" aria-hidden>
              <div className="h-1.5 w-full rounded-full bg-[#EFEAE0]" />
              <div className="h-1.5 w-11/12 rounded-full bg-[#EFEAE0]" />
              <div className="h-1.5 w-3/4 rounded-full bg-[#EFEAE0]" />
            </div>
          )}
          {pp.ctaPosition === "below-description" && cta}
          {row(
            "productPage.showDeliveryEstimate",
            pp.showDeliveryEstimate,
            <span className="flex items-center gap-1 py-0.5">
              <Truck className="size-3.5" aria-hidden /> Arrives in {p.deliveryDays} days
            </span>,
            "No delivery date",
          )}
          {row(
            "productPage.showReturnsPolicy",
            pp.showReturnsPolicy,
            <span className="flex items-center gap-1 py-0.5">
              <RotateCcw className="size-3.5" aria-hidden /> Free {p.returnDays}-day returns
            </span>,
            "No returns info",
          )}
          {row(
            "productPage.trustBadges",
            pp.trustBadges,
            <span className="flex items-center gap-1 py-0.5">
              <ShieldCheck className="size-3.5" aria-hidden /> Secure checkout · 2-year warranty
            </span>,
            "No trust badges",
          )}
        </div>
        {pp.ctaPosition === "sticky" && <div className="absolute inset-x-3 bottom-3 rounded-[10px] bg-white/90 p-1 backdrop-blur">{cta}</div>}
      </div>
    </Chrome>
  );
}

function CheckoutMock({ spec, other, arm }: MockProps) {
  const changed = useDiff(spec, other);
  const t = priceCart(BASKET, spec);
  const c = spec.checkout;
  return (
    <Chrome spec={spec}>
      <div className="grid h-full gap-4 p-4 sm:grid-cols-[1.3fr_1fr]">
        <div className="flex min-w-0 flex-col gap-2.5 text-[13px]">
          <span className="px-2 text-[20px] font-semibold tracking-[-0.02em]">Checkout</span>
          <Mark on={changed("checkout.steps")} arm={arm}>
            {c.steps === 1 ? (
              <span className="block py-0.5">Everything on one page</span>
            ) : (
              <span className="flex flex-wrap items-center gap-1 py-0.5">
                {["Details", "Delivery", "Payment"].slice(0, c.steps).map((s, i) => (
                  <span key={s} className="whitespace-nowrap">
                    {i + 1} {s}
                    {i < c.steps - 1 ? " ›" : ""}
                  </span>
                ))}
              </span>
            )}
          </Mark>
          {(c.expressPay || changed("checkout.expressPay")) && (
            <Mark on={changed("checkout.expressPay")} arm={arm}>
              {c.expressPay ? (
                <span className="grid grid-cols-2 gap-1.5 py-1">
                  <span className="rounded-[7px] bg-black py-1.5 text-center text-[12px] font-semibold text-white ring-1 ring-white/20"> Pay</span>
                  <span className="rounded-[7px] bg-black py-1.5 text-center text-[12px] font-semibold text-white ring-1 ring-white/20">G Pay</span>
                </span>
              ) : (
                <span className="block py-0.5 opacity-55">No express pay</span>
              )}
            </Mark>
          )}
          <Mark on={changed("checkout.guestCheckout")} arm={arm}>
            <span className="block py-0.5">{c.guestCheckout ? "Checking out as a guest, no account needed" : "Sign in or create an account to continue"}</span>
          </Mark>
          <div className="space-y-1.5 px-2" aria-hidden>
            <div className="h-7 rounded-[7px] border border-[#E6E0D3]" />
            {!c.guestCheckout && <div className="h-7 rounded-[7px] border border-[#E6E0D3]" />}
          </div>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[12px] bg-[#F7F4EE] p-3.5 text-[13.5px]">
          <div className="flex justify-between px-2">
            <span>Subtotal</span>
            <span className="num">{formatGBP(t.subtotal)}</span>
          </div>
          <div className="flex justify-between px-2">
            <span>Delivery</span>
            <span className="num">{c.steps > 1 && !spec.cart.showShippingUpfront ? "Next step" : t.shipping === 0 ? "Free" : formatGBP(t.shipping)}</span>
          </div>
          <Button spec={spec} className="mt-auto">
            {c.steps === 1 ? `Pay ${formatGBP(t.total)}` : "Continue"}
          </Button>
        </div>
      </div>
    </Chrome>
  );
}

function HomeMock({ spec, other, arm }: MockProps) {
  const changed = useDiff(spec, other);
  const h = spec.hero;
  const g = spec.productGrid;
  const tiles = ["p_aurora", "p_ridge", "p_velocity", "p_tempo"].slice(0, g.columns).map((id) => getProduct(id)!);
  return (
    <Chrome spec={spec}>
      <div className="flex h-full flex-col gap-3 p-4">
        <div className={cn("flex flex-col gap-1.5", h.layout === "centered" ? "items-center text-center" : "items-start")}>
          <Mark on={changed("hero.headline", "hero.layout")} arm={arm}>
            <span className="block text-[19px] leading-tight font-semibold tracking-[-0.02em]">{h.headline}</span>
          </Mark>
          <Mark on={changed("hero.subheadline")} arm={arm} className="text-[12.5px]">
            <span className={arm === "B" && changed("hero.subheadline") ? "" : "text-[#7A7468]"}>{h.subheadline || " "}</span>
          </Mark>
          <Mark on={changed("hero.ctaText", "theme.accent", "theme.radius")} arm={arm} pad={false} className="p-0.5">
            <Button spec={spec} className="px-4">
              {h.ctaText}
            </Button>
          </Mark>
          {(h.showSocialProof || changed("hero.showSocialProof")) && (
            <Mark on={changed("hero.showSocialProof")} arm={arm} className="text-[12px]">
              {h.showSocialProof ? (
                <span className="flex items-center gap-1 py-0.5">
                  <Star className="size-3 fill-current" aria-hidden /> 4.8 from 12,000 runners
                </span>
              ) : (
                <span className="block py-0.5 opacity-55">No ratings strip</span>
              )}
            </Mark>
          )}
        </div>
        <Mark on={changed("productGrid.columns", "productGrid.showRatings", "productGrid.showQuickAdd", "productGrid.sort")} arm={arm} pad={false} className="mt-auto p-1">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
            {tiles.map((p) => (
              <div key={p.id} className="relative rounded-[10px] bg-[#F4F1EA] p-1.5 text-dw-ink">
                {/* eslint-disable-next-line @next/next/no-img-element -- static product art */}
                <img src={p.image} alt="" className="h-12 w-full object-contain" />
                <div className="truncate text-[11px] font-medium">{p.name}</div>
                <div className="num flex items-center justify-between text-[11px]">
                  {formatGBP(p.price).replace(/\.00$/, "")}
                  {g.showRatings && <span className="text-[10px]">★ {p.rating}</span>}
                </div>
                {g.showQuickAdd && <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-dw-ink text-[12px] text-white">+</span>}
              </div>
            ))}
          </div>
        </Mark>
      </div>
    </Chrome>
  );
}

/** The store API's product response, as an AI shopper sees it. */
function AgentMock({ spec, other, arm }: MockProps) {
  const changed = useDiff(spec, other);
  const p = getProduct("p_aurora")!;
  const s = spec.agentSurface;
  const ship = shippingFor(p.price, spec);
  const fields: { path: string; show: boolean; key: string; value: string }[] = [
    { path: "agentSurface.exposeStock", show: s.exposeStock, key: "sizes", value: `[{ "size": "9", "inStock": true, "quantity": ${p.stock["9"]} }, …]` },
    { path: "agentSurface.exposeDeliveryEta", show: s.exposeDeliveryEta, key: "deliveryEtaDays", value: String(p.deliveryDays) },
    { path: "agentSurface.exposeReturnPolicy", show: s.exposeReturnPolicy, key: "returnPolicy", value: `{ "days": ${p.returnDays}, "free": ${p.freeReturns} }` },
    { path: "agentSurface.exposeLandedPrice", show: s.exposeLandedPrice, key: "landedPrice", value: `{ "amount": ${p.price + ship}, "shipping": ${ship} }` },
    {
      path: "agentSurface.negotiation",
      show: s.negotiation.enabled,
      key: "negotiation",
      value: `{ "enabled": true, "maxDiscountPct": ${s.negotiation.maxDiscountPct} }`,
    },
    { path: "agentSurface.structuredData", show: s.structuredData, key: "jsonLd", value: `"schema.org/Product"` },
  ];
  const visible = fields.filter((f) => f.show || changed(f.path));
  return (
    <div className="flex h-full min-h-[292px] flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_0_0_1px_#EFE8DA]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#F2ECDF] px-4 font-dwmono text-[11.5px] text-[#7A7468]">
        <span className="rounded-full bg-dw-ink px-1.5 py-px text-[10px] font-medium text-white">GET</span>
        <span className="truncate">/api/agent/products/{p.id}</span>
        <span className="ml-auto shrink-0 text-dw-win">200</span>
      </div>
      <div className="flex-1 overflow-hidden p-3 font-dwmono text-[12px] leading-[1.7]">
        <div className="px-2 text-[#8A8478]">{"{"}</div>
        <div className="px-2 pl-5">&quot;name&quot;: &quot;{p.name}&quot;,</div>
        <div className="px-2 pl-5">&quot;price&quot;: {`{ "amount": ${p.price}, "currency": "GBP" }`},</div>
        {visible.map((f) =>
          f.show ? (
            <Mark key={f.key} on={changed(f.path)} arm={arm} className="my-0.5 pl-5">
              <span className="block truncate">
                &quot;{f.key}&quot;: {f.value},
              </span>
            </Mark>
          ) : (
            <div key={f.key} className="my-0.5 truncate rounded-[8px] border-[1.5px] border-dashed border-dw-hot/80 bg-dw-pink/20 px-2 py-0.5 pl-5 text-[#8A2F5E]">
              &quot;{f.key}&quot;: not shared
            </div>
          ),
        )}
        {!visible.length && <div className="px-2 pl-5 text-[#8A8478]">{"// stock, delivery, returns: not shared"}</div>}
        <div className="px-2 text-[#8A8478]">{"}"}</div>
        {!s.exposeLandedPrice && <div className="mt-1 px-2 text-[11px] text-[#8A8478]">{`// delivery (£${(SHIPPING_FEE / 100).toFixed(2)}) is revealed at checkout`}</div>}
      </div>
    </div>
  );
}

interface MockProps {
  spec: PageSpec;
  other: PageSpec;
  arm: "A" | "B";
}

export function SpecMock({ spec, other, arm, page }: MockProps & { page: MockPage }) {
  switch (page) {
    case "product":
      return <ProductMock spec={spec} other={other} arm={arm} />;
    case "checkout":
      return <CheckoutMock spec={spec} other={other} arm={arm} />;
    case "home":
      return <HomeMock spec={spec} other={other} arm={arm} />;
    case "agent":
      return <AgentMock spec={spec} other={other} arm={arm} />;
    default:
      return <CartMock spec={spec} other={other} arm={arm} />;
  }
}
