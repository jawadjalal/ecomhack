"use client";

import { ArrowRight, Lock, Minus, Plus, Truck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getProduct, SHIPPING_FEE, type Product } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { addToCart, useCart } from "@/lib/storefront/cart";
import { priceCart, type CartLine, type CartTotals } from "@/lib/storefront/pricing";
import { isOneSize, sizeLabel, sizesOf } from "@/lib/storefront/products";
import { StoreLink, useStore, useTrack } from "./store-provider";
import { ProductArt } from "./ui";

/** Shown in console previews when the viewer's own bag is empty, so the page isn't blank. */
export const SAMPLE_LINES: CartLine[] = [{ productId: "p_aurora", color: "Midnight", size: "9", quantity: 1 }];

/** Lines to render: the real cart, or a sample basket inside previews. */
export function useDisplayLines() {
  const { preview } = useStore();
  const cart = useCart();
  const sample = preview && cart.hydrated && cart.lines.length === 0;
  return { ...cart, lines: sample ? SAMPLE_LINES : cart.lines, sample };
}

export function FreeShippingBar({ totals, className = "" }: { totals: CartTotals; className?: string }) {
  if (totals.threshold === null || totals.subtotal <= 0) return null;
  const pct = Math.min(100, Math.round((totals.subtotal / totals.threshold) * 100));
  return (
    <div className={`pace-card bg-(--surface) px-4 py-3.5 ${className}`} data-darwin="free-shipping-progress">
      <p className="flex items-center gap-2 text-sm">
        <Truck className="size-4 shrink-0" aria-hidden />
        {totals.qualifiesForFree ? (
          <span>
            <span className="font-semibold">You&apos;ve unlocked free delivery.</span> Nice.
          </span>
        ) : (
          <span>
            You&apos;re <span className="font-semibold">{formatGBP(totals.remainingForFree)}</span> away from free delivery
          </span>
        )}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#e7e5e4]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to free delivery">
        <div className="h-full rounded-full bg-(--accent) transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CartView() {
  const { spec } = useStore();
  const track = useTrack();
  const { lines, hydrated, setQuantity, remove, sample } = useDisplayLines();
  const totals = priceCart(lines, spec);
  const upfront = spec.cart.showShippingUpfront;
  const fired = useRef(false);

  useEffect(() => {
    if (!hydrated || fired.current) return;
    fired.current = true;
    track("cart_viewed", {
      item_count: totals.itemCount,
      value: totals.subtotal,
      product_ids: totals.lines.map((l) => l.productId),
      ...(upfront ? { shipping: totals.shipping } : {}),
    });
  }, [hydrated, track, totals, upfront]);

  if (!hydrated) {
    return <div className="min-h-[50vh]" aria-busy="true" />;
  }

  if (totals.lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <div className="pace-tile size-40 bg-(--surface)">
          {/* eslint-disable-next-line @next/next/no-img-element -- static art */}
          <img src="/products/socks.svg" alt="" className="h-full w-full object-contain p-4 opacity-80" />
        </div>
        <h1 className="pace-display mt-8 text-4xl font-bold">Your bag is empty</h1>
        <p className="mt-3 text-(--muted)">Good news: our best running shoes are one click away.</p>
        <StoreLink href="/store#collection" className="pace-btn pace-btn-primary mt-8 min-h-[52px] px-8">
          Shop the collection <ArrowRight className="size-4" aria-hidden />
        </StoreLink>
      </div>
    );
  }

  const upsell = spec.cart.upsell
    ? (["p_socks", "p_vest"].map((id) => getProduct(id)).filter(Boolean) as Product[]).filter((p) => !lines.some((l) => l.productId === p.id))
    : [];

  return (
    <div className="py-8 sm:py-12">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="pace-display text-4xl font-bold sm:text-5xl">Your bag</h1>
        <p className="text-sm text-(--muted)">
          {totals.itemCount} {totals.itemCount === 1 ? "item" : "items"}
          {sample && " · sample basket (preview)"}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
        <div>
          <FreeShippingBar totals={totals} className="mb-6" />
          <ul className="divide-y divide-(--line) border-y border-(--line)">
            {totals.lines.map((l) => (
              <li key={l.key} className="flex gap-4 py-6 sm:gap-6" data-darwin="cart-line">
                <StoreLink href={`/store/products/${l.product.slug}`} className="shrink-0">
                  <ProductArt product={l.product} color={l.color} className="size-24 sm:size-32" />
                </StoreLink>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <StoreLink href={`/store/products/${l.product.slug}`} className="font-semibold hover:underline">
                        {l.product.name}
                      </StoreLink>
                      <p className="mt-0.5 text-sm text-(--muted)">
                        {l.color} · {sizeLabel(l.size)}
                      </p>
                      <p className="mt-0.5 text-sm text-(--muted)">{formatGBP(l.unitPrice)}</p>
                    </div>
                    <p className="font-semibold">{formatGBP(l.lineTotal)}</p>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-4">
                    <div className="pace-chip inline-flex items-center border border-[#d6d3d1]">
                      <button
                        type="button"
                        className="pace-focus flex size-9 items-center justify-center disabled:opacity-40"
                        onClick={() => setQuantity(l.key, l.quantity - 1)}
                        aria-label={`Decrease quantity of ${l.product.name}`}
                        disabled={sample}
                        data-darwin="cart-qty-dec"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-7 text-center text-sm font-medium tabular-nums" aria-live="polite">
                        {l.quantity}
                      </span>
                      <button
                        type="button"
                        className="pace-focus flex size-9 items-center justify-center disabled:opacity-40"
                        onClick={() => setQuantity(l.key, l.quantity + 1)}
                        aria-label={`Increase quantity of ${l.product.name}`}
                        disabled={sample || l.quantity >= 10}
                        data-darwin="cart-qty-inc"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(l.key)}
                      disabled={sample}
                      className="pace-focus inline-flex items-center gap-1 text-sm text-(--muted) hover:text-(--ink)"
                      data-darwin="cart-remove"
                    >
                      <X className="size-3.5" aria-hidden /> Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {upsell.length > 0 && (
            <section className="mt-12" data-darwin="cart-upsell">
              <h2 className="text-lg font-semibold">Complete your kit</h2>
              <p className="mt-1 text-sm text-(--muted)">Runners who bought these shoes also added:</p>
              {/* grid-cols-1 (minmax(0,1fr)), not the implicit auto track: long names must truncate, not widen the page on phones. */}
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {upsell.map((p) => (
                  <UpsellCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="pace-card bg-(--surface) p-6">
            <h2 className="text-lg font-semibold">Order summary</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-(--muted)">Subtotal</dt>
                <dd className="font-medium">{formatGBP(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between" data-darwin="cart-shipping">
                <dt className="text-(--muted)">Delivery</dt>
                <dd className="font-medium">
                  {upfront ? (
                    totals.shipping === 0 ? (
                      <span className="text-emerald-700">Free</span>
                    ) : (
                      formatGBP(totals.shipping)
                    )
                  ) : (
                    <span className="text-(--muted)">Calculated at checkout</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between border-t border-[#d6d3d1] pt-4 text-base">
                <dt className="font-semibold">{upfront ? "Total" : "Estimated total"}</dt>
                <dd className="text-xl font-semibold">{formatGBP(upfront ? totals.total : totals.subtotal)}</dd>
              </div>
              {upfront && <p className="text-xs text-(--muted)">Including VAT and UK delivery. No surprises at checkout.</p>}
            </dl>
            <StoreLink href="/store/checkout" className="pace-btn pace-btn-primary mt-6 min-h-14 w-full text-base" data-darwin="cart-checkout">
              <Lock className="size-4" aria-hidden /> Checkout securely
            </StoreLink>
            <StoreLink href="/store#collection" className="mt-4 block text-center text-sm font-medium text-(--muted) hover:text-(--ink)">
              Continue shopping
            </StoreLink>
          </div>
          <ul className="mt-5 space-y-2 px-1 text-xs text-(--muted)">
            <li>• Standard UK delivery {formatGBP(SHIPPING_FEE)}{totals.threshold !== null ? `, free over ${formatGBP(totals.threshold)}` : ""}</li>
            <li>• Free 60-day returns on all shoes</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

function UpsellCard({ product }: { product: Product }) {
  const track = useTrack();
  const sizes = sizesOf(product).filter((s) => s.stock > 0);
  const [size, setSize] = useState(sizes[0]?.size ?? "");
  const [added, setAdded] = useState(false);
  const add = () => {
    const line = { productId: product.id, color: product.colors[0].name, size, quantity: 1 };
    addToCart(line);
    track("product_added", { product_id: product.id, price: product.price, quantity: 1, size, color: line.color, source: "cart_upsell" });
    setAdded(true);
  };
  return (
    <div className="pace-card flex items-center gap-4 border border-(--line) p-3">
      <ProductArt product={product} className="size-20 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{product.name}</p>
        <p className="text-sm text-(--muted)">{formatGBP(product.price)}</p>
        {!isOneSize(product) && (
          <div className="mt-1.5 flex gap-1">
            {sizes.map((s) => (
              <button
                key={s.size}
                type="button"
                onClick={() => setSize(s.size)}
                className={`pace-chip border px-2 py-0.5 text-[11px] font-medium ${size === s.size ? "border-(--ink) bg-(--ink) text-white" : "border-(--line)"}`}
                aria-pressed={size === s.size}
              >
                {s.size}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={add} className="pace-btn pace-btn-secondary min-h-10 shrink-0 px-4 text-sm" data-darwin="upsell-add" disabled={added}>
        {added ? "Added" : "Add"}
      </button>
    </div>
  );
}
