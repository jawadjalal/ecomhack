import type { Metadata } from "next";
import { CartView } from "@/components/store/cart-view";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { Container } from "@/components/store/ui";
import { getStoreContext } from "@/lib/storefront/context";

export const metadata: Metadata = { title: "Your bag" };

export default async function CartPage(props: PageProps<"/store/cart">) {
  const ctx = await getStoreContext(props.searchParams);
  return (
    <StoreShell ctx={ctx}>
      <PageView page="cart" />
      <Container className="pb-16">
        <CartView />
      </Container>
    </StoreShell>
  );
}
