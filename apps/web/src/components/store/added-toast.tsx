"use client";

import { Check, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { getProduct } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { dismissAdded, useCart, useLastAdded } from "@/lib/storefront/cart";
import { sizeLabel } from "@/lib/storefront/products";
import { ProductArt } from "./ui";
import { StoreLink } from "./store-provider";

/** "Added to bag" confirmation that drops in under the header after any add-to-cart. */
export function AddedToast() {
  const added = useLastAdded();
  const { count } = useCart();
  const pathname = usePathname();

  // Navigating away (e.g. to the bag) closes the toast.
  useEffect(() => dismissAdded, [pathname]);

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(dismissAdded, 4500);
    return () => clearTimeout(t);
  }, [added]);

  if (!added) return null;
  const product = getProduct(added.line.productId);
  if (!product) return null;

  return (
    <div
      key={added.at}
      className="pace-rise pace-card fixed right-3 top-[72px] z-50 w-[calc(100%-24px)] max-w-sm border border-(--line) bg-white p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] sm:right-6"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          Added to your bag
        </p>
        <button type="button" onClick={dismissAdded} className="pace-focus -mr-1 rounded-full p-1 text-(--muted) hover:bg-(--surface)" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex gap-3">
        <ProductArt product={product} color={added.line.color} className="size-16 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="truncate font-medium">{product.name}</p>
          <p className="text-(--muted)">
            {added.line.color} · {sizeLabel(added.line.size)}
          </p>
          <p className="mt-0.5 font-medium">{formatGBP(product.price)}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StoreLink href="/store/cart" className="pace-btn pace-btn-secondary min-h-11 text-sm" onClick={dismissAdded}>
          View bag ({count})
        </StoreLink>
        <StoreLink href="/store/checkout" className="pace-btn pace-btn-primary min-h-11 text-sm" onClick={dismissAdded} data-darwin="toast-checkout">
          Checkout
        </StoreLink>
      </div>
    </div>
  );
}
