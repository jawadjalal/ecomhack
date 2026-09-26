"use client";

import type { Fees } from "@/lib/commerce";
import { gbp } from "@/lib/commerce";

/** Totals block. `showFees=false` is the Gen 0 mistake: freight and fees stay hidden until the last step. */
export function Totals({ f, showFees, threshold, highlight }: { f: Fees; showFees: boolean; threshold: number | null; highlight?: boolean }) {
  return (
    <>
      <div className="sum-row">
        <span>Subtotal ({f.pieces} pieces)</span>
        <span>{gbp(f.subtotal, { decimals: true })}</span>
      </div>
      {showFees ? (
        <div className={highlight ? "fee-shock" : undefined} data-darwin="fees" id="order-fees">
          {f.weightKg > 0 ? (
            <>
              <div className="sum-row">
                <span>Tracked freight ({f.weightKg} kg)</span>
                <span>{f.freeFreight ? "Free" : gbp(f.freight, { decimals: true })}</span>
              </div>
              <div className="sum-row">
                <span>Customs &amp; handling</span>
                <span>{f.freeFreight ? "Free" : gbp(f.handling, { decimals: true })}</span>
              </div>
            </>
          ) : (
            <div className="sum-row">
              <span>Shipping</span>
              <span>Included</span>
            </div>
          )}
          {f.protection > 0 && (
            <div className="sum-row">
              <span>Buyer protection fee</span>
              <span>{gbp(f.protection, { decimals: true })}</span>
            </div>
          )}
          {f.smallOrder > 0 && (
            <div className="sum-row">
              <span>Small order fee (under £150)</span>
              <span>{gbp(f.smallOrder, { decimals: true })}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="sum-row muted" id="order-fees-hidden">
          <span>Freight, customs &amp; fees</span>
          <span>Calculated at checkout</span>
        </div>
      )}
      <div className="sum-row total">
        <span>{showFees ? "Total" : "Subtotal"}</span>
        <span>{gbp(showFees ? f.total : f.subtotal, { decimals: true })}</span>
      </div>
      {showFees && threshold !== null && !f.freeFreight && (
        <div className="free-shipping" data-darwin="free-shipping">
          <div className="sum-note" style={{ marginBottom: 6 }}>
            Add <strong>{gbp(threshold - f.subtotal)}</strong> more for free freight &amp; customs.
          </div>
          <div className="free-bar">
            <i style={{ width: `${Math.min(100, (f.subtotal / threshold) * 100)}%` }} />
          </div>
        </div>
      )}
      {showFees && f.freeFreight && <div className="sum-note" style={{ color: "var(--ok)", fontWeight: 700 }}>You&apos;ve unlocked free freight.</div>}
    </>
  );
}
