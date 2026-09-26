import type { Metadata } from "next";
import { AccountView } from "@/components/store/account-view";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { getStoreContext } from "@/lib/storefront/context";
import { getWhopShowcase } from "@/lib/whop";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage(props: PageProps<"/store/account">) {
  const ctx = await getStoreContext(props.searchParams);
  const showcase = await getWhopShowcase();
  const brand = showcase?.title?.trim() || "PACE";
  return (
    <StoreShell ctx={ctx}>
      <PageView page="account" />
      <AccountView brand={brand} />
    </StoreShell>
  );
}
