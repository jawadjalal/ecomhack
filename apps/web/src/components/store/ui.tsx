/* Small presentational building blocks shared by store pages (server- and client-safe). */
import { Star } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { Product } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { tint } from "@/lib/storefront/art/color";
import { productImage } from "@/lib/storefront/products";

export function Stars({ rating, size = 14, className = "" }: { rating: number; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[1px] ${className}`} aria-label={`${rating.toFixed(1)} out of 5 stars`} role="img">
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star className="absolute inset-0 text-[#d6d3d1]" style={{ width: size, height: size }} fill="currentColor" strokeWidth={0} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="text-[#f59e0b]" style={{ width: size, height: size }} fill="currentColor" strokeWidth={0} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function Price({ price, compareAt, className = "" }: { price: number; compareAt?: number; className?: string }) {
  const onSale = compareAt !== undefined && compareAt > price;
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className={onSale ? "text-[#b91c1c]" : undefined}>{formatGBP(price)}</span>
      {onSale && <span className="text-[0.85em] font-normal text-(--muted) line-through">{formatGBP(compareAt)}</span>}
    </span>
  );
}

/** Soft background tinted from the product's colourway. */
export function tileBackground(hex: string): CSSProperties {
  return {
    backgroundImage: `radial-gradient(120% 90% at 70% 20%, ${tint(hex, 0.93)} 0%, ${tint(hex, 0.86)} 55%, ${tint(hex, 0.8)} 100%)`,
  };
}

export function ProductArt({
  product,
  color,
  className = "",
  imgClassName = "",
  priority = false,
  style,
}: {
  product: Product;
  color?: string;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
  style?: CSSProperties;
}) {
  const c = product.colors.find((x) => x.name === color) ?? product.colors[0];
  return (
    <div className={`pace-tile relative ${className}`} style={{ ...tileBackground(c.hex), ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG art, no optimisation needed */}
      <img
        src={productImage(product, c.name)}
        alt={`${product.name} in ${c.name}`}
        className={`absolute inset-0 h-full w-full object-contain ${imgClassName}`}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
      />
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-10 ${className}`}>{children}</div>;
}
