import type { Metadata } from "next";
import { AccountView } from "@/components/store/account-view";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { getStoreContext, type SearchParams } from "@/lib/storefront/context";
import { getStoreBranding } from "@/lib/storefront/showcase";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage(props: { searchParams: Promise<SearchParams> }) {
  const ctx = await getStoreContext(props.searchParams);
  const { brand } = await getStoreBranding();
  return (
    <StoreShell ctx={ctx}>
      <PageView page="account" />
      <AccountView brand={brand} />
    </StoreShell>
  );
}
