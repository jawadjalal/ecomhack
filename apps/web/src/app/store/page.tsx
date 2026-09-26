import { EditorialHome } from "@/components/store/editorial-home";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { getStoreContext } from "@/lib/storefront/context";
import { getWhopShowcase } from "@/lib/whop";

export default async function StoreHome(props: PageProps<"/store">) {
  const ctx = await getStoreContext(props.searchParams);
  const showcase = await getWhopShowcase();
  const { spec } = ctx;
  const brand = showcase?.title?.trim() || "PACE";
  return (
    <StoreShell ctx={ctx}>
      {spec.agentSurface.structuredData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "OnlineStore",
                name: brand,
                url: "/store",
                description: spec.hero.subheadline || "Performance running shoes designed in London.",
              },
              {
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: brand,
                url: "/store",
                potentialAction: {
                  "@type": "SearchAction",
                  target: "/store?q={search_term_string}",
                  "query-input": "required name=search_term_string",
                },
              },
            ]).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <PageView page="home" />
      <EditorialHome spec={spec} brand={brand} category={ctx.query.category} query={ctx.query.q} showcase={showcase} />
    </StoreShell>
  );
}
