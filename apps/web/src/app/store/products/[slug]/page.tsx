import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/store/product-card";
import { Breadcrumbs, ProductDetail } from "@/components/store/product-detail";
import { Reviews } from "@/components/store/reviews";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { Container } from "@/components/store/ui";
import { getProduct, inStock, PRODUCTS, SHIPPING_FEE, type Product } from "@/lib/catalog/products";
import type { PageSpec } from "@/lib/contracts";
import { getStoreContext } from "@/lib/storefront/context";
import { deliveryEstimate } from "@/lib/storefront/delivery";

function findProduct(slug: string) {
  const p = getProduct(decodeURIComponent(slug));
  return p && (p.slug === slug || p.id === slug) ? p : undefined;
}

export async function generateMetadata(props: PageProps<"/store/products/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const product = findProduct(slug);
  return product ? { title: product.name, description: product.description } : { title: "Not found" };
}

/** schema.org Product, rendered when `agentSurface.structuredData` is on. */
function productJsonLd(product: Product, spec: PageSpec) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    sku: product.id,
    name: product.name,
    description: product.description,
    image: product.image,
    category: product.category,
    brand: { "@type": "Brand", name: "PACE" },
    color: product.colors.map((c) => c.name).join(", "),
    aggregateRating: { "@type": "AggregateRating", ratingValue: product.rating, reviewCount: product.reviewCount },
    review: product.reviews.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      name: r.title,
      reviewBody: r.body,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
    })),
    offers: {
      "@type": "Offer",
      url: `/store/products/${product.slug}`,
      price: (product.price / 100).toFixed(2),
      priceCurrency: "GBP",
      availability: inStock(product) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: (SHIPPING_FEE / 100).toFixed(2), currency: "GBP" },
        ...(spec.cart.freeShippingThreshold !== null
          ? { freeShippingThreshold: { "@type": "MonetaryAmount", value: (spec.cart.freeShippingThreshold / 100).toFixed(2), currency: "GBP" } }
          : {}),
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "GB" },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          transitTime: { "@type": "QuantitativeValue", minValue: product.deliveryDays, maxValue: product.deliveryDays + 1, unitCode: "DAY" },
        },
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "GB",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: product.returnDays,
        returnFees: product.freeReturns ? "https://schema.org/FreeReturn" : "https://schema.org/ReturnShippingFees",
      },
    },
  };
}

export default async function ProductPage(props: PageProps<"/store/products/[slug]">) {
  const { slug } = await props.params;
  const product = findProduct(slug);
  if (!product) notFound();

  const ctx = await getStoreContext(props.searchParams);
  const { spec } = ctx;
  const delivery = deliveryEstimate(new Date(), product.deliveryDays);
  const related = [
    ...PRODUCTS.filter((p) => p.id !== product.id && p.category === product.category),
    ...PRODUCTS.filter((p) => p.id !== product.id && p.category !== product.category).sort((a, b) => a.bestsellerRank - b.bestsellerRank),
  ].slice(0, 4);

  return (
    <StoreShell ctx={ctx} bottomInset={spec.productPage.ctaPosition === "sticky"}>
      {spec.agentSurface.structuredData && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product, spec)).replace(/</g, "\\u003c") }}
        />
      )}
      <PageView
        page="product"
        events={[{ event: "product_viewed", props: { product_id: product.id, price: product.price, category: product.category } }]}
      />
      <Container className="pb-16 pt-5 sm:pt-6">
        <Breadcrumbs product={product} />
        <div className="mt-5">
          <ProductDetail product={product} delivery={{ message: delivery.message, date: delivery.date }} />
        </div>
      </Container>
      {spec.productPage.showReviews && <Reviews product={product} />}
      <section className="border-t border-(--line) py-16 sm:py-20">
        <Container>
          <h2 className="pace-display text-3xl font-bold sm:text-4xl">Complete your run</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {related.map((p, i) => (
              <ProductCard key={p.id} product={p} position={i + 1} />
            ))}
          </div>
        </Container>
      </section>
    </StoreShell>
  );
}
