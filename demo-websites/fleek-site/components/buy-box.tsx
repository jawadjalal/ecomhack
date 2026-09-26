"use client";

import { useState } from "react";
import type { Bundle } from "@/lib/catalog";
import { gbp } from "@/lib/commerce";
import { track, EVENTS } from "@/lib/track";
import { CartIcon, CheckIcon, ShieldIcon } from "./icons";
import { useCart, useSpec } from "./providers";

function useAdd(bundle: Bundle) {
  const cart = useCart();
  return (qty: number, source: string) => {
    cart.add(bundle.id, qty);
    cart.showToast(`Added ${qty} × “${bundle.name}”`);
    track(EVENTS.productAdded, { product_id: bundle.id, price: bundle.price, quantity: qty, source });
  };
}

/** Quantity + Add to cart. Where it renders on the page is the `productPage.ctaPosition` knob. */
export function BuyBox({ bundle }: { bundle: Bundle }) {
  const spec = useSpec();
  const add = useAdd(bundle);
  const [qty, setQty] = useState(1);
  const pp = spec.productPage;
  return (
    <div className="buy" id="buy-box" data-darwin="buy-box">
      {/* Gen 0 hides availability entirely; `productPage.urgency: "low-stock"` shows the real stock count. */}
      {pp.urgency === "low-stock" && (
        <div className="urgency" data-darwin="urgency">
          {bundle.stock <= 9
            ? `Only ${bundle.stock} bundle${bundle.stock === 1 ? "" : "s"} left from this supplier`
            : `In stock: ${bundle.stock} bundles ready to ship`}
        </div>
      )}
      <div className="qty-line">
        Quantity: <span className="qty-chip">{bundle.pieces}pcs</span>
        <span style={{ marginLeft: "auto" }}>Bundles</span>
        <span className="qty-step">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer bundles">
            −
          </button>
          <span>{qty}</span>
          <button type="button" onClick={() => setQty((q) => Math.min(bundle.stock, q + 1))} aria-label="More bundles">
            +
          </button>
        </span>
      </div>
      <button type="button" className="btn btn-accent atc add-to-cart" id="add-to-cart" data-darwin="add-to-cart" onClick={() => add(qty, "pdp")}>
        <CartIcon /> {pp.ctaText}
        {qty > 1 ? ` · ${gbp(bundle.price * qty)}` : ""}
      </button>
      {pp.trustBadges && (
        <div className="trust-row trust-badges" id="trust-badges" data-darwin="trust-badges">
          <span>
            <ShieldIcon /> Buyer protection
          </span>
          <span>
            <CheckIcon /> Verified supplier
          </span>
          <span>
            <CheckIcon /> Graded before dispatch
          </span>
          <span>
            <CheckIcon /> Secure checkout
          </span>
        </div>
      )}
    </div>
  );
}

/** ctaPosition "sticky": the add button stays pinned to the bottom of the screen. */
export function StickyBuy({ bundle }: { bundle: Bundle }) {
  const spec = useSpec();
  const add = useAdd(bundle);
  return (
    <div className="sticky-buy" data-darwin="sticky-buy">
      <div className="in">
        <div className="name">
          <strong>{bundle.name}</strong>
          <span>
            {gbp(bundle.price)} · {bundle.pieces} pieces
          </span>
        </div>
        <button type="button" className="btn btn-accent add-to-cart" onClick={() => add(1, "sticky")} data-darwin="sticky-add-to-cart">
          <CartIcon style={{ width: 20, height: 20 }} /> {spec.productPage.ctaText}
        </button>
      </div>
    </div>
  );
}
