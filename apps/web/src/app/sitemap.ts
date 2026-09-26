import type { MetadataRoute } from "next";
import { PRODUCTS } from "@/lib/catalog/products";

/** /sitemap.xml for the demo store, so agents can find every product without crawling. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.DARWIN_PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  return [
    { url: `${base}/store`, changeFrequency: "daily", priority: 1 },
    ...PRODUCTS.map((p) => ({ url: `${base}/store/products/${p.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    { url: `${base}/store/help/delivery`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/store/help/returns`, changeFrequency: "monthly", priority: 0.3 },
  ];
}
