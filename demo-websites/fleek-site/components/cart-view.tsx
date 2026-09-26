"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { BUNDLES, perPiece } from "@/lib/catalog";
import { fees, gbp, priceLines } from "@/lib/commerce";
import { track, EVENTS } from "@/lib/track";
import { ProductVisual } from "./bundle-art";
import { BundleGrid } from "./bundle-card";
import { Totals } from "./order-summary";
import { useCart, useSpec } from "./providers";

export function CartView() {
  const spec = useSpec();
  const cart = useCart();
  const lines = priceLines(cart.lines);
  const f = fees(lines, spec.cart.freeShippingThreshold);
  const sent = useRef(false);

  useEffect(() => {
    if (!cart.ready || sent.current) return;
    sent.current = true;
    track(EVENTS.cartViewed, { value: f.subtotal, items: cart.count });
    if (spec.cart.showShippingUpfront && lines.length) {
      track(EVENTS.shippingRevealed, { shipping: f.total - f.subtotal, stage: "cart", upfront: true });
    }
  }, [cart.ready, cart.count, f.subtotal, f.total, lines.length, spec.cart.showShippingUpfront]);

  if (!cart.ready) return <div className="page" style={{ minHeight: "50vh" }} />;

  if (!lines.length) {
    return (
      <div className="page empty">
        <h1 className="page-title">Your cart is empty</h1>
        <Link href="/bundles" className="btn btn-ink">
          Browse bundles
        </Link>
      </div>
    );
  }

  const upsell = BUNDLES.filter((b) => !cart.lines.some((l) => l.id === b.id))
    .sort((a, b) => b.sold30d - a.sold30d)
    .slice(0, 3);

  return (
    <div className="page">
      <h1 className="page-title">Your cart</h1>
      <div className="cart-grid">
        <div>
          {lines.map(({ bundle, qty, total }) => (
            <div key={bundle.id} className="line" data-darwin="cart-line">
              <a href={bundle.url ?? `/bundles/${bundle.id}`} className="line-art">
                <ProductVisual bundle={bundle} />
              </a>
              <div>
                <a href={bundle.url ?? `/bundles/${bundle.id}`} className="line-title">
                  {bundle.name}
                </a>
                <div className="line-meta">
                  {bundle.pieces}pcs · Grade {bundle.grade} · {gbp(perPiece(bundle), { decimals: true })}/pc
                </div>
                <div className="line-actions">
                  <span className="qty-step">
                    <button type="button" onClick={() => cart.setQty(bundle.id, qty - 1)} aria-label="Fewer">
                      −
                    </button>
                    <span>{qty}</span>
                    <button type="button" onClick={() => cart.setQty(bundle.id, Math.min(bundle.stock, qty + 1))} aria-label="More">
                      +
                    </button>
                  </span>
                  <button type="button" className="line-remove" onClick={() => cart.remove(bundle.id)}>
                    Remove
                  </button>
                </div>
              </div>
              <strong className="line-total">{gbp(total)}</strong>
            </div>
          ))}

          {spec.cart.upsell && (
            <div className="upsell" data-darwin="cart-upsell">
              <h2>Resellers also stocked</h2>
              <BundleGrid bundles={upsell} list="cart_upsell" columns={3} />
            </div>
          )}
        </div>

        <aside className="summary" id="cart-summary" data-darwin="cart-summary">
          <h2>Order summary</h2>
          <Totals f={f} showFees={spec.cart.showShippingUpfront} threshold={spec.cart.freeShippingThreshold} />
          <Link href="/checkout" className="btn btn-accent btn-block checkout-button" id="checkout" data-darwin="checkout">
            Checkout
          </Link>
          <Link href="/bundles" className="sum-note" style={{ textAlign: "center", textDecoration: "underline" }}>
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
