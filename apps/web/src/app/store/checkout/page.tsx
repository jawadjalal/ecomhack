import type { Metadata } from "next";
import { CheckoutView } from "@/components/store/checkout-view";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { getStoreContext } from "@/lib/storefront/context";
import { deliveryEstimate } from "@/lib/storefront/delivery";

export const metadata: Metadata = { title: "Checkout" };

export default async function CheckoutPage(props: PageProps<"/store/checkout">) {
  const ctx = await getStoreContext(props.searchParams);
  const now = new Date();
  const deliveryDates: Record<number, string> = {};
  for (let d = 1; d <= 5; d++) deliveryDates[d] = deliveryEstimate(now, d).date;
  return (
    <StoreShell ctx={ctx} chrome="checkout">
      <PageView page="checkout" />
      <CheckoutView deliveryDates={deliveryDates} />
    </StoreShell>
  );
}
