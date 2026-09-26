"use client";

import Link from "next/link";
import { discountPct, perPiece, supplierById, type Bundle } from "@/lib/catalog";
import { gbp, shippingNote } from "@/lib/commerce";
import { track, EVENTS } from "@/lib/track";
import { BundleArt } from "./bundle-art";
import { HeartIcon, Stars } from "./icons";
import { useCart, useSpec } from "./providers";

export function BundleCard({ bundle, list, variant = "home" }: { bundle: Bundle; list: string; variant?: "home" | "list" }) {
  const spec = useSpec();
  const cart = useCart();
  const off = discountPct(bundle);
  const lowStock = spec.productPage.urgency === "low-stock" && bundle.stock <= 5;
  const ship = shippingNote(bundle, spec);
  const quickAdd = () => {
    cart.add(bundle.id);
    cart.showToast(`Added “${bundle.name}”`);
    track(EVENTS.productAdded, { product_id: bundle.id, price: bundle.price, quantity: 1, source: "quick_add", list });
  };
  return (
    <article className="card product-card" data-darwin="product-card" data-product-id={bundle.id}>
      <Link href={`/bundles/${bundle.id}`} className="card-img" aria-label={bundle.name}>
        <BundleArt garments={bundle.garments} colors={bundle.colors} bg={bundle.bg} seed={bundle.id} label={`${bundle.name}: ${bundle.pieces}-piece bundle`} />
        {off > 0 && <span className="badge-sale">{off}% Discount</span>}
        {lowStock && <span className="badge-low">Only {bundle.stock} left</span>}
        {variant === "list" && (
          <span className="heart" aria-hidden>
            <HeartIcon />
          </span>
        )}
      </Link>
      <div className="card-body">
        <Link href={`/bundles/${bundle.id}`} className="card-title">
          {bundle.name}
        </Link>
        {spec.productGrid.showRatings && (
          <div className="card-rating rating" data-darwin="card-rating">
            <Stars rating={bundle.rating} /> {bundle.rating.toFixed(1)} · {supplierById(bundle.supplier)?.name}
          </div>
        )}
        <div className="card-price">
          <strong className="price">{gbp(bundle.price)}</strong>
          {variant === "home" ? <span className="per-pc">{gbp(perPiece(bundle), { decimals: true })}/pc</span> : bundle.was ? <s>{gbp(bundle.was)}</s> : null}
        </div>
        {variant === "list" && <span className="per-pc">{gbp(perPiece(bundle), { decimals: true })}/pc</span>}
        {ship && (
          <span className={variant === "list" ? "chip-ship" : "ship-note"} data-darwin="card-shipping">
            {ship}
          </span>
        )}
        {spec.productGrid.showQuickAdd && (
          <button type="button" className="btn btn-accent quick-add add-to-cart" onClick={quickAdd} data-darwin="quick-add">
            Quick add
          </button>
        )}
      </div>
    </article>
  );
}

export function BundleGrid({ bundles, list, columns, variant = "home" }: { bundles: Bundle[]; list: string; columns?: number; variant?: "home" | "list" }) {
  const spec = useSpec();
  const cols = columns ?? spec.productGrid.columns;
  return (
    <div className={`grid product-grid ${variant === "list" ? "grid-list" : ""}`} data-cols={cols} style={{ ["--cols" as string]: cols }} data-darwin="product-grid">
      {bundles.map((b) => (
        <BundleCard key={b.id} bundle={b} list={list} variant={variant} />
      ))}
    </div>
  );
}
