"use client";

import { Lock, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import { useState } from "react";
import { SHIPPING_FEE } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { useCart } from "@/lib/storefront/cart";
import { CATEGORIES } from "@/lib/storefront/products";
import { BrandWordmark } from "./logo";
import { SearchForm } from "./search-form";
import { StoreLink, useStore } from "./store-provider";

export function StoreHeader({ chrome, brand }: { chrome: "full" | "checkout"; brand: string }) {
  const { count, hydrated } = useCart();
  const { spec } = useStore();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const promo = spec.announcement.enabled ? spec.announcement.text.trim() : "";

  if (chrome === "checkout") {
    return (
      <header className="border-b border-black/10 bg-[#f6f4f1]">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <StoreLink href="/store" className="pace-focus" aria-label={`${brand} home`}>
            <BrandWordmark brand={brand} />
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
    <header className="sticky top-0 z-40 bg-[#f6f4f1]">
      <div className="flex h-8 items-center justify-between bg-black px-4 text-[10px] font-medium uppercase tracking-[0.16em] text-white sm:px-6 lg:px-10">
        <p data-darwin={promo ? "announcement" : undefined}>{promo || `UK delivery from ${formatGBP(SHIPPING_FEE)}`}</p>
        <nav className="hidden items-center gap-4 sm:flex" aria-label="Utility">
          <StoreLink href="/store/help/delivery" className="pace-focus hover:text-white/70">
            Delivery
          </StoreLink>
          <StoreLink href="/store/help/returns" className="pace-focus hover:text-white/70">
            Returns
          </StoreLink>
          <StoreLink href="/store/help/delivery" className="pace-focus hover:text-white/70">
            Help
          </StoreLink>
        </nav>
      </div>
      <div className="mx-auto grid h-[68px] max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:px-10">
        <nav className="flex items-center gap-1" aria-label="Main">
          <button
            type="button"
            className="pace-focus -ml-2 inline-flex size-10 items-center justify-center lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setSearching(false);
            }}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="hidden items-center gap-7 text-[12px] font-medium uppercase tracking-[0.16em] lg:flex">
            {CATEGORIES.map((c) => (
              <StoreLink key={c.key} href={`/store?category=${c.key}#collection`} className="pace-focus text-black/80 transition-colors hover:text-black">
                {c.label}
              </StoreLink>
            ))}
          </div>
        </nav>
        <StoreLink href="/store" className="pace-focus justify-self-center" aria-label={`${brand} home`}>
          <BrandWordmark brand={brand} />
        </StoreLink>
        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            className="pace-focus inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em]"
            aria-label={searching ? "Close search" : "Search products"}
            aria-expanded={searching}
            aria-controls="pace-search"
            data-darwin="nav-search"
            onClick={() => {
              setSearching((v) => !v);
              setOpen(false);
            }}
          >
            {searching ? <X className="size-[15px]" /> : <Search className="size-[15px]" />}
            <span className="hidden md:inline">Search</span>
          </button>
          <StoreLink
            href="/store/account"
            className="pace-focus hidden items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] sm:inline-flex"
            aria-label="Account and orders"
            data-darwin="nav-account"
          >
            <User className="size-[15px]" />
            <span className="hidden md:inline">Account</span>
          </StoreLink>
          <StoreLink
            href="/store/cart"
            className="pace-focus inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em]"
            aria-label={`Cart, ${hydrated ? count : 0} items`}
            data-darwin="nav-cart"
          >
            <ShoppingBag className="size-[15px]" />
            <span className="hidden sm:inline">Cart ({hydrated ? count : 0})</span>
          </StoreLink>
        </div>
      </div>
      {searching && (
        <div id="pace-search" className="border-t border-black/10 bg-[#f6f4f1]">
          <div className="mx-auto max-w-[720px] px-4 py-3 sm:px-6">
            <SearchForm autoFocus onDone={() => setSearching(false)} />
          </div>
        </div>
      )}
      {open && (
        <div className="border-t border-black/10 bg-[#f6f4f1] lg:hidden">
          <nav className="mx-auto flex max-w-[1440px] flex-col px-4 py-2 sm:px-6" aria-label="Mobile">
            <StoreLink href="/store#collection" className="py-3 text-[13px] font-medium uppercase tracking-[0.16em]" onClick={() => setOpen(false)}>
              Shop all
            </StoreLink>
            {CATEGORIES.map((c) => (
              <StoreLink
                key={c.key}
                href={`/store?category=${c.key}#collection`}
                className="border-t border-black/10 py-3 text-[13px] font-medium uppercase tracking-[0.16em]"
                onClick={() => setOpen(false)}
              >
                {c.label}
              </StoreLink>
            ))}
            <StoreLink
              href="/store/account"
              className="border-t border-black/10 py-3 text-[13px] font-medium uppercase tracking-[0.16em]"
              onClick={() => setOpen(false)}
            >
              Account &amp; orders
            </StoreLink>
          </nav>
        </div>
      )}
    </header>
  );
}
