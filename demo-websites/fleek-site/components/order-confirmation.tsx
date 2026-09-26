"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { gbp, priceLines, type CartLine } from "@/lib/commerce";

interface SavedOrder {
  orderId: string;
  lines: CartLine[];
  total: number;
  subtotal: number;
  shipping: number;
  pieces: number;
  express: string | null;
}

export function OrderConfirmation({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<SavedOrder | null | undefined>(undefined);
  useEffect(() => {
    let saved: SavedOrder | null = null;
    try {
      const raw = sessionStorage.getItem(`rackd_order_${orderId}`);
      saved = raw ? (JSON.parse(raw) as SavedOrder) : null;
    } catch {
      saved = null;
    }
    setOrder(saved);
  }, [orderId]);

  if (order === undefined) return <div className="page" style={{ minHeight: "50vh" }} />;

  return (
    <div className="confirm" id="order-confirmation" data-darwin="order-confirmation">
      <div className="tick">✓</div>
      <h1 className="page-title" style={{ padding: 0 }}>
        Order {orderId} confirmed
      </h1>
      <p className="muted" style={{ marginTop: 10 }}>
        Thanks for stocking up. This is a demo store, so nothing was charged and nothing will ship.
      </p>
      {order && (
        <div className="summary" style={{ marginTop: 28, textAlign: "left", position: "static" }}>
          {priceLines(order.lines).map(({ bundle, qty, total }) => (
            <div key={bundle.id} className="sum-row">
              <span>
                {qty} × {bundle.name}
              </span>
              <span>{gbp(total)}</span>
            </div>
          ))}
          <div className="sum-row">
            <span>Freight, customs &amp; fees</span>
            <span>{order.shipping ? gbp(order.shipping, { decimals: true }) : "Free"}</span>
          </div>
          <div className="sum-row total">
            <span>Total paid{order.express ? ` (${order.express.replace(/_/g, " ")})` : ""}</span>
            <span>{gbp(order.total, { decimals: true })}</span>
          </div>
          <div className="sum-note">{order.pieces} pieces to list. We&apos;ll email tracking when your supplier dispatches.</div>
        </div>
      )}
      <Link href="/bundles" className="btn btn-ink " style={{ marginTop: 28 }}>
        Keep shopping
      </Link>
    </div>
  );
}
