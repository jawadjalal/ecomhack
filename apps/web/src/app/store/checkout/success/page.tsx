import type { Metadata } from "next";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { SuccessView } from "@/components/store/success-view";
import { getStoreContext } from "@/lib/storefront/context";

export const metadata: Metadata = { title: "Order confirmed" };

export default async function SuccessPage(props: PageProps<"/store/checkout/success">) {
  const ctx = await getStoreContext(props.searchParams);
  return (
    <StoreShell ctx={ctx} chrome="checkout">
      <PageView page="order_confirmation" />
      <SuccessView orderId={ctx.query.order} />
    </StoreShell>
  );
}
