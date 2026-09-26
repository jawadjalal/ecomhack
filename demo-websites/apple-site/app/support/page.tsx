import type { Metadata } from "next";
import { getSpec } from "@/lib/spec";
import { DELIVERY_FEE, RETURNS_DAYS } from "@/lib/catalog";
import { gbp } from "@/lib/format";

export const metadata: Metadata = { title: "Support" };

export default async function SupportPage() {
  const { spec } = await getSpec();
  const free = spec.cart.freeShippingThreshold;
  return (
    <div className="support">
      <h1>Orchard Support</h1>
      <section id="delivery">
        <h2>Delivery</h2>
        <p>
          Standard UK delivery is {gbp(DELIVERY_FEE)}
          {free !== null ? `, free on orders over ${gbp(free, { whole: true })}` : ""}. Order by 3pm on a working day for next-day delivery.
        </p>
      </section>
      <section id="returns">
        <h2>Returns</h2>
        <p>Return anything within {RETURNS_DAYS} days of delivery for a full refund. Returns are free.</p>
      </section>
      <section>
        <h2>About this store</h2>
        <p>Orchard is a fictional brand built to demo Darwin, the storefront that improves itself. Nothing is for sale and no payment is ever taken.</p>
      </section>
    </div>
  );
}
