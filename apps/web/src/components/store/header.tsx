"use client";

import { Lock, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/lib/storefront/cart";
import { CATEGORIES } from "@/lib/storefront/products";
import { PaceLogo } from "./logo";
import { StoreLink } from "./store-provider";

export function StoreHeader({ chrome }: { chrome: "full" | "checkout" }) {
  const { count, hydrated } = useCart();
  const [open, setOpen] = useState(false);

  if (chrome === "checkout") {
    return (
      <header className="border-b border-(--line) bg-white">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <StoreLink href="/store" className="pace-focus" aria-label="PACE home">
            <PaceLogo />
          </StoreLink>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden items-center gap-1.5 text-(--muted) sm:inline-flex">
              <Lock className="size-3.5" aria-hidden /> Secure checkout
            </span>
            <StoreLink href="/store/cart" className="pace-focus inline-flex items-center gap-1.5 font-medium" data-darwin="nav-cart">
              <ShoppingBag className="size-4" aria-hidden />
              Bag{hydrated && count > 0 ? ` (${count})` : ""}
            </StoreLink>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-40 border-b border-(--line) bg-white/90 backdrop-blur-md">
      <div className="mx-auto grid h-16 max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:px-10">
        <nav className="flex items-center gap-1" aria-label="Main">
          <button
            type="button"
            className="pace-focus -ml-2 inline-flex size-10 items-center justify-center rounded-full hover:bg-(--surface) lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="hidden items-center gap-7 text-[14px] font-medium lg:flex">
            {CATEGORIES.map((c) => (
              <StoreLink key={c.key} href={`/store?category=${c.key}#collection`} className="pace-focus text-(--ink)/80 transition-colors hover:text-(--ink)">
                {c.label}
              </StoreLink>
            ))}
          </div>
        </nav>
        <StoreLink href="/store" className="pace-focus justify-self-center" aria-label="PACE home">
          <PaceLogo />
        </StoreLink>
        <div className="flex items-center justify-end gap-1">
          <button type="button" className="pace-focus hidden size-10 items-center justify-center rounded-full hover:bg-(--surface) sm:inline-flex" aria-label="Search">
            <Search className="size-[18px]" />
          </button>
          <button type="button" className="pace-focus hidden size-10 items-center justify-center rounded-full hover:bg-(--surface) sm:inline-flex" aria-label="Account">
            <User className="size-[18px]" />
          </button>
          <StoreLink
            href="/store/cart"
            className="pace-focus relative -mr-2 inline-flex size-10 items-center justify-center rounded-full hover:bg-(--surface)"
            aria-label={`Bag, ${hydrated ? count : 0} items`}
            data-darwin="nav-cart"
          >
            <ShoppingBag className="size-[19px]" />
            {hydrated && count > 0 && (
              <span className="absolute right-0.5 top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-(--accent) px-1 text-[10px] font-bold leading-[18px] text-(--accent-fg)">
                {count}
              </span>
            )}
          </StoreLink>
        </div>
      </div>
      {open && (
        <div className="border-t border-(--line) bg-white lg:hidden">
          <nav className="mx-auto flex max-w-[1400px] flex-col px-4 py-2 sm:px-6" aria-label="Mobile">
            <StoreLink href="/store#collection" className="py-3 text-lg font-medium" onClick={() => setOpen(false)}>
              Shop all
            </StoreLink>
            {CATEGORIES.map((c) => (
              <StoreLink
                key={c.key}
                href={`/store?category=${c.key}#collection`}
                className="border-t border-(--line) py-3 text-lg font-medium"
                onClick={() => setOpen(false)}
              >
                {c.label}
              </StoreLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
