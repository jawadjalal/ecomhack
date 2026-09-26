import type { Metadata } from "next";
import { PageView, StoreProvider } from "@/components/store/store-provider";
import { VantaHome } from "@/components/store/vanta/vanta-home";
import { getStoreContext } from "@/lib/storefront/context";

export const metadata: Metadata = {
  title: "VANTA — Instruments for people who look closely",
  description: "Cameras, audio and wearables machined from titanium, aluminium and glass.",
};

/**
 * Live VANTA. getStoreContext resolves the visitor's spec (getLiveSpec, or the
 * running experiment arm) and honours ?previewSpec= the same way /store does.
 */
export default async function VantaPage(props: PageProps<"/vanta">) {
  const ctx = await getStoreContext(props.searchParams);
  return (
    <StoreProvider
      value={{
        spec: ctx.spec,
        persist: ctx.persist,
        preview: ctx.preview,
        variantLabel: ctx.variantLabel,
        analytics: ctx.analytics,
      }}
    >
      <PageView page="home" />
      <VantaHome spec={ctx.spec} />
    </StoreProvider>
  );
}
