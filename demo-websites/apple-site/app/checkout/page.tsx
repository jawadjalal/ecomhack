import type { Metadata } from "next";
import { getSpec } from "@/lib/spec";
import { CheckoutFlow } from "@/components/checkout-flow";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const { spec } = await getSpec();
  return <CheckoutFlow checkout={spec.checkout} cart={spec.cart} />;
}
