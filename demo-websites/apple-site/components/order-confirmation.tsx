"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { gbp } from "@/lib/format";
import type { CompletedOrder } from "./checkout-flow";

const noop = () => () => {};

export function OrderConfirmation({ id }: { id: string }) {
  const raw = useSyncExternalStore(
    noop,
    () => {
      try {
        return sessionStorage.getItem(`orchard_order_${id}`);
      } catch {
        return null;
      }
    },
    () => undefined,
  );
  if (raw === undefined) return <div className="confirm" aria-busy="true" />;
  const order = raw ? (JSON.parse(raw) as CompletedOrder) : null;

  return (
    <div className="confirm" data-darwin="order-confirmation">
      <h1>Thank you. Your order has been placed.</h1>
      <p className="confirm-id">
        Order number <strong>{id}</strong>
      </p>
      {order ? (
        <>
          <p>
            We&apos;ll email a receipt to {order.email}. Estimated delivery: <strong>{order.delivery}</strong>.
          </p>
          <div className="confirm-box">
            <ul>
              {order.lines.map((l) => (
                <li key={l.name}>
                  <span>
                    {l.name} × {l.qty}
                  </span>
                  <span>{gbp(l.total)}</span>
                </li>
              ))}
            </ul>
            <div className="summary-row">
              <span>Delivery</span>
              <span>{order.shipping ? gbp(order.shipping) : "FREE"}</span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span>{gbp(order.total)}</span>
            </div>
          </div>
          {order.express && <p className="fine">Paid with express checkout.</p>}
        </>
      ) : (
        <p>Your order details are no longer in this tab.</p>
      )}
      <p className="fine">Orchard is a demo store: nothing ships and no money was taken.</p>
      <Link href="/" className="button button-elevated">
        Continue shopping
      </Link>
    </div>
  );
}
