"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { Product } from "@/lib/catalog/products";
import { addToCart, announceAdded } from "@/lib/storefront/cart";
import { isOneSize, sizeLabel, sizesOf } from "@/lib/storefront/products";
import { StoreLink, useStore, useTrack } from "./store-provider";
import { Price, ProductArt, Stars } from "./ui";

export function ProductCard({ product, position, eager = false }: { product: Product; position: number; eager?: boolean }) {
  const { spec } = useStore();
  const track = useTrack();
  const { showRatings, showQuickAdd } = spec.productGrid;
  const [picking, setPicking] = useState(false);
  const color = product.colors[0].name;
  const href = `/store/products/${product.slug}`;
  const badge =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? `Save ${Math.round((1 - product.price / product.compareAtPrice) * 100)}%`
      : product.bestsellerRank <= 2
        ? "Bestseller"
        : null;

  const quickAdd = (size: string) => {
    const line = { productId: product.id, color, size, quantity: 1 };
    addToCart(line);
    announceAdded(line);
    track("product_added", {
      product_id: product.id,
      price: product.price,
      quantity: 1,
      size,
      color,
      source: "quick_add",
      list_position: position,
    });
    setPicking(false);
  };

  const onQuick = () => {
    if (isOneSize(product)) quickAdd(Object.keys(product.stock)[0]);
    else setPicking(true);
  };

  return (
    <article className="group relative flex flex-col" data-darwin="product-card" data-product-id={product.id}>
      <div className="relative">
        <StoreLink href={href} className="pace-focus block" aria-label={product.name} tabIndex={-1}>
          <ProductArt
            product={product}
            className="aspect-square w-full"
            imgClassName="scale-[1.04] p-[5%] transition-transform duration-500 ease-out group-hover:-rotate-2 group-hover:scale-[1.1]"
            priority={eager}
          />
        </StoreLink>
        {badge && (
          <span className="pace-chip pointer-events-none absolute left-3 top-3 bg-white/90 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-(--ink) shadow-sm">
            {badge}
          </span>
        )}
        {showQuickAdd && !picking && (
          <button
            type="button"
            onClick={onQuick}
            className="pace-btn pace-btn-primary absolute bottom-2.5 right-2.5 min-h-10 px-3 text-[13px] shadow-lg sm:bottom-3 sm:right-3 sm:px-4 transition-all duration-200 lg:translate-y-2 lg:opacity-0 lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100 lg:group-hover:translate-y-0 lg:group-hover:opacity-100"
            data-darwin="quick-add"
            aria-label={`Quick add ${product.name}`}
          >
            <Plus className="size-4" aria-hidden />
            <span className="max-sm:sr-only">Quick add</span>
          </button>
        )}
        {showQuickAdd && picking && (
          <div className="pace-rise pace-card absolute inset-x-2 bottom-2 bg-white/95 p-3 shadow-xl backdrop-blur" role="group" aria-label="Choose a size">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold">
              <span>Select size</span>
              <button type="button" onClick={() => setPicking(false)} className="pace-focus rounded-full p-0.5 text-(--muted) hover:text-(--ink)" aria-label="Close size picker">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {sizesOf(product).map(({ size, stock }) => (
                <button
                  key={size}
                  type="button"
                  disabled={stock <= 0}
                  onClick={() => quickAdd(size)}
                  className="pace-chip pace-focus min-h-9 border border-(--line) text-xs font-medium transition hover:border-(--ink) disabled:cursor-not-allowed disabled:text-[#c4c0bb] disabled:line-through"
                  data-darwin="size-option"
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <StoreLink href={href} className="pace-focus mt-4 flex flex-1 flex-col" data-darwin="product-link">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <h3 className="text-[15px] font-semibold leading-snug">{product.name}</h3>
          <Price price={product.price} compareAt={product.compareAtPrice} className="shrink-0 text-[15px] font-semibold" />
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] text-(--muted) sm:text-sm">{product.tagline}</p>
        {showRatings && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-(--muted)" data-darwin="card-rating">
            <Stars rating={product.rating} size={13} />
            <span className="font-medium text-(--ink)">{product.rating.toFixed(1)}</span>
            <span>({product.reviewCount.toLocaleString("en-GB")})</span>
          </div>
        )}
        <div className="mt-3 flex items-center gap-1.5">
          {product.colors.map((c) => (
            <span key={c.name} className="size-3.5 rounded-full border border-black/10" style={{ background: c.hex }} title={c.name} />
          ))}
          <span className="ml-1 text-xs text-(--muted)">
            {product.colors.length > 1 ? `${product.colors.length} colours` : product.colors[0].name}
            {!isOneSize(product) && ` · ${sizeLabel(sizesOf(product)[0].size)}–${sizesOf(product).at(-1)?.size}`}
          </span>
        </div>
      </StoreLink>
    </article>
  );
}
