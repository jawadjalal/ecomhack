"use client";

import { ArrowRight, Package } from "lucide-react";
import { getProduct } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { useStoredOrders } from "@/lib/storefront/cart";
import { StoreLink, useStore } from "./store-provider";

const orderRef = (id: string) => `PACE-${id.replace(/^ord_/, "").slice(0, 6).toUpperCase()}`;

function orderDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * The store's account page: how checkout works here (guest or account-at-checkout, per the PageSpec)
 * and every order placed in this browser, each linking to its order page (items, total, delivery date).
 */
export function AccountView({ brand }: { brand: string }) {
  const { spec } = useStore();
  const { hydrated, orders } = useStoredOrders();
  const guest = spec.checkout.guestCheckout;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16" data-darwin="account">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-black/55">Account</p>
      <h1 className="pace-display mt-3 text-4xl sm:text-5xl">Your orders</h1>

      <section className="mt-8 border border-black/10 bg-white p-5 text-sm leading-relaxed" data-darwin="account-checkout-info">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em]">{guest ? "No account needed" : "Your account is made at checkout"}</h2>
        <p className="mt-2 text-black/70">
          {guest
            ? `${brand} checks out as a guest, so there's no password to remember. Orders you place in this browser are listed below: open one to see what's in it and when it arrives.`
            : `You create your ${brand} account with your first order at checkout. Signing in on another device isn't part of this demo store, so the orders placed in this browser are listed below.`}
        </p>
        <p className="mt-2 text-black/50">
          This is a demo store: no payment is taken and no emails are sent.{" "}
          <StoreLink href="/store/help/delivery" className="pace-link text-black">
            Delivery & returns help
          </StoreLink>
        </p>
      </section>

      <section className="mt-10" aria-labelledby="account-orders">
        <h2 id="account-orders" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em]">
          <Package className="size-4" aria-hidden /> Orders from this browser
        </h2>
        {!hydrated ? (
          <div className="mt-4 h-24 animate-pulse bg-black/[0.04]" aria-busy="true" />
        ) : orders.length === 0 ? (
          <div className="mt-4 border border-dashed border-black/15 px-5 py-10 text-center text-sm" data-darwin="account-no-orders">
            <p className="font-medium">No orders from this browser yet.</p>
            <StoreLink
              href="/store#collection"
              className="pace-focus mt-5 inline-flex h-11 items-center bg-black px-6 text-[12px] font-medium uppercase tracking-[0.16em] text-white"
            >
              Shop the collection
            </StoreLink>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-black/10 border-y border-black/10" data-darwin="account-orders">
            {orders.map((o) => {
              const items = o.lines.reduce((s, l) => s + l.quantity, 0);
              const names = o.lines.map((l) => getProduct(l.productId)?.name).filter(Boolean);
              return (
                <li key={o.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {orderRef(o.id)} <span className="font-normal text-black/50">· {orderDate(o.createdAt)}</span>
                    </p>
                    <p className="truncate text-sm text-black/60">
                      {items} {items === 1 ? "item" : "items"}
                      {names.length ? `: ${names.join(", ")}` : ""}
                    </p>
                    {o.deliveryDate && <p className="text-sm text-black/60">Arrives {o.deliveryDate}</p>}
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-5 sm:justify-end">
                    <span className="font-medium tabular-nums">{formatGBP(o.total)}</span>
                    <StoreLink
                      href={`/store/checkout/success?order=${encodeURIComponent(o.id)}`}
                      className="pace-focus inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] underline underline-offset-4"
                    >
                      View order <ArrowRight className="size-3.5" aria-hidden />
                    </StoreLink>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
