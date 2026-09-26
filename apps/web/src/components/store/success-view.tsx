"use client";

import { ArrowRight, Check, Package } from "lucide-react";
import { useEffect } from "react";
import { getProduct } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { markOrderTracked, useStoredOrder } from "@/lib/storefront/cart";
import { sizeLabel } from "@/lib/storefront/products";
import { StoreLink, useStore, useTrack } from "./store-provider";
import { ProductArt } from "./ui";

export function SuccessView({ orderId }: { orderId?: string }) {
  const { analytics } = useStore();
  const track = useTrack();
  const { hydrated, order } = useStoredOrder(orderId);

  // order_completed exactly once per order (per browser), never from previews.
  useEffect(() => {
    if (!order || !analytics.enabled) return;
    if (!markOrderTracked(order.id)) return;
    track("order_completed", {
      order_id: order.id,
      revenue: order.total,
      subtotal: order.subtotal,
      shipping: order.shipping,
      ...(order.discount ? { discount: order.discount, coupon: order.coupon } : {}),
      currency: "GBP",
      item_count: order.lines.reduce((s, l) => s + l.quantity, 0),
      items: order.lines.map((l) => ({
        product_id: l.productId,
        quantity: l.quantity,
        size: l.size,
        color: l.color,
        price: getProduct(l.productId)?.price ?? 0,
      })),
      express: Boolean(order.express),
    });
  }, [order, analytics.enabled, track]);

  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />;

  if (!order) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="pace-display text-4xl font-bold">Thanks for shopping with PACE</h1>
        <p className="mt-3 text-(--muted)">We couldn&apos;t find that order in this browser, but if you placed one, it&apos;s on its way.</p>
        <StoreLink href="/store" className="pace-btn pace-btn-primary mt-8 min-h-[52px] px-8">
          Back to the store
        </StoreLink>
      </div>
    );
  }

  const ref = `PACE-${order.id.replace(/^ord_/, "").slice(0, 6).toUpperCase()}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="pace-rise flex flex-col items-center text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_12px_30px_-10px_rgba(5,150,105,0.7)]">
          <Check className="size-7" strokeWidth={3} aria-hidden />
        </span>
        <p className="pace-eyebrow mt-6 text-(--muted)">Order {ref} confirmed</p>
        <h1 className="pace-display mt-3 text-4xl font-extrabold sm:text-5xl">Thanks, {order.firstName}. You&apos;re all set.</h1>
        <p className="mt-4 max-w-md text-(--muted)">
          Confirmation for <span className="font-medium text-(--ink)">{order.email}</span> (a demo store, so no email is sent). Your order arrives{" "}
          <span className="font-medium text-(--ink)">{order.deliveryDate ?? "in 2–3 days"}</span>.
        </p>
      </div>

      <div className="pace-card mt-10 border border-(--line) p-6" data-darwin="order-summary">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Package className="size-4" aria-hidden /> Your order
        </div>
        <ul className="mt-5 space-y-4">
          {order.lines.map((l) => {
            const p = getProduct(l.productId);
            if (!p) return null;
            return (
              <li key={`${l.productId}-${l.size}-${l.color}`} className="flex items-center gap-4">
                <ProductArt product={p} color={l.color} className="size-16 shrink-0" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-(--muted)">
                    {l.color} · {sizeLabel(l.size)} · Qty {l.quantity}
                  </p>
                </div>
                <p className="text-sm font-medium">{formatGBP(p.price * l.quantity)}</p>
              </li>
            );
          })}
        </ul>
        <dl className="mt-6 space-y-2 border-t border-(--line) pt-5 text-sm">
          <div className="flex justify-between">
            <dt className="text-(--muted)">Subtotal</dt>
            <dd>{formatGBP(order.subtotal)}</dd>
          </div>
          {order.discount ? (
            <div className="flex justify-between text-emerald-700">
              <dt>Discount{order.coupon ? ` (${order.coupon})` : ""}</dt>
              <dd>−{formatGBP(order.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-(--muted)">Delivery</dt>
            <dd>{order.shipping === 0 ? "Free" : formatGBP(order.shipping)}</dd>
          </div>
          <div className="flex justify-between pt-2 text-base font-semibold">
            <dt>Total paid</dt>
            <dd>{formatGBP(order.total)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-(--muted)">Demo store — no payment was taken.</p>
      </div>

      <div className="mt-8 flex justify-center">
        <StoreLink href="/store" className="pace-btn pace-btn-primary min-h-[52px] px-8" data-darwin="continue-shopping">
          Continue shopping <ArrowRight className="size-4" aria-hidden />
        </StoreLink>
      </div>
    </div>
  );
}
