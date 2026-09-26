"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { PageSpec } from "@/lib/page-spec";
import { getProduct, UPSELL_SLUGS, unitPrice } from "@/lib/catalog";
import { deliveryDate, deliveryFee, gbp } from "@/lib/format";
import { track } from "@/lib/track";
import { lineTotal, useBag } from "./bag";
import { DeviceArt } from "./device-art";

/** The bag. Knobs: cart.showShippingUpfront / freeShippingThreshold / upsell. */
export function BagView({ cart }: { cart: PageSpec["cart"] }) {
  const bag = useBag();
  const { lines, subtotal, ready } = bag;
  const shipping = deliveryFee(subtotal, cart.freeShippingThreshold);
  const total = subtotal + (cart.showShippingUpfront ? shipping : 0);
  const viewed = useRef(false);

  useEffect(() => {
    if (!ready || viewed.current) return;
    viewed.current = true;
    track("cart_viewed", { value: subtotal, items: bag.count });
    if (cart.showShippingUpfront && subtotal > 0) track("shipping_cost_revealed", { shipping, subtotal, where: "bag" });
  }, [ready, subtotal, shipping, bag.count, cart.showShippingUpfront]);

  if (!ready) return <div className="bag" aria-busy="true" />;

  if (!lines.length) {
    return (
      <div className="bag">
        <header className="bag-header" style={{ borderBottom: 0 }}>
          <h1>Your bag is empty.</h1>
          <p>Sign in to see if you have any saved items.</p>
          <Link href="/store" className="button button-elevated">
            Continue Shopping
          </Link>
        </header>
      </div>
    );
  }

  const toFree = cart.freeShippingThreshold !== null ? cart.freeShippingThreshold - subtotal : null;
  const upsell = UPSELL_SLUGS.map((s) => getProduct(s)!).filter((p) => !lines.some((l) => l.slug === p.slug));

  return (
    <div className="bag" data-darwin="bag">
      <header className="bag-header">
        <h1>Your bag total is {gbp(total)}.</h1>
        {cart.showShippingUpfront ? (
          <p data-darwin="bag-delivery-line">
            {shipping === 0 ? "Free delivery" : `Delivery ${gbp(shipping)}`} and free returns.
            {toFree !== null && toFree > 0 && <span className="free-progress"> Add {gbp(toFree)} more for free delivery.</span>}
          </p>
        ) : (
          <p className="grey">Delivery is calculated at checkout.</p>
        )}
        <Link href="/checkout" className="button button-elevated" data-darwin="checkout-button">
          Check Out
        </Link>
      </header>

      <ul>
        {lines.map((l, i) => {
          const p = getProduct(l.slug)!;
          const hex = p.colours.find((c) => c.name === l.colour)?.hex ?? p.colours[0].hex;
          return (
            <li key={`${l.slug}-${l.colour}-${l.option}`} className="bag-item">
              <DeviceArt kind={p.kind} colour={hex} pro={p.slug.endsWith("-pro")} className="bag-item-art" label={p.name} />
              <div>
                <div className="bag-item-top">
                  <h2 className="bag-item-name">
                    <Link href={`/products/${p.slug}`}>
                      {p.name}
                      {l.option ? ` ${l.option}` : ""} – {l.colour}
                    </Link>
                  </h2>
                  <select className="bag-item-qty" aria-label="Quantity" value={l.qty} onChange={(e) => bag.setQty(i, Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <p className="bag-item-price">{gbp(lineTotal(l))}</p>
                </div>
                <button type="button" className="link-button bag-item-remove" onClick={() => bag.setQty(i, 0)}>
                  Remove
                </button>
                {cart.showShippingUpfront && (
                  <p className="bag-item-meta">
                    Order today, delivers {deliveryDate()} – {shipping === 0 ? "Free" : gbp(shipping)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {cart.upsell && upsell.length > 0 && (
        <section className="upsell" data-darwin="upsell">
          <h2>Complete your setup.</h2>
          <ul>
            {upsell.map((p) => (
              <li key={p.slug}>
                <DeviceArt kind={p.kind} colour={p.colours[0].hex} className="upsell-art" label={p.name} />
                <span>
                  {p.name}
                  <br />
                  <span className="grey">{gbp(unitPrice(p))}</span>
                </span>
                <button type="button" className="button button-reduced button-secondary" onClick={() => bag.add({ slug: p.slug, colour: p.colours[0].name }, "bag-upsell")}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bag-summary" data-darwin="bag-summary">
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{gbp(subtotal)}</span>
        </div>
        <div className="summary-row" data-darwin="shipping-row">
          <span>Delivery</span>
          {cart.showShippingUpfront ? <span>{shipping === 0 ? "FREE" : gbp(shipping)}</span> : <span className="grey">Calculated at checkout</span>}
        </div>
        <div className="summary-row total">
          <span>{cart.showShippingUpfront ? "Total" : "Estimated total"}</span>
          <span>{gbp(total)}</span>
        </div>
        <Link href="/checkout" className="button button-elevated button-block" data-darwin="checkout-button-bottom">
          Check Out
        </Link>
      </section>
    </div>
  );
}
