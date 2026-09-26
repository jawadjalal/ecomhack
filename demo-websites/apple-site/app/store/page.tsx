import type { Metadata } from "next";
import Link from "next/link";
import { getSpec } from "@/lib/spec";
import { PRODUCTS, getProduct } from "@/lib/catalog";
import { gbp, monthly } from "@/lib/format";
import { DeviceArt } from "@/components/device-art";
import { ProductGrid } from "@/components/product-grid";

export const metadata: Metadata = { title: "Store" };

const NAV = ["orchard-book-air", "orchard-phone-17-pro", "orchard-pad-air", "orchard-watch-11", "orchard-buds-pro", "orchard-clear-case", "orchard-35w-charger"];
const NAV_LABEL: Record<string, string> = {
  "orchard-book-air": "Book",
  "orchard-phone-17-pro": "Phone",
  "orchard-pad-air": "Pad",
  "orchard-watch-11": "Watch",
  "orchard-buds-pro": "Buds",
  "orchard-clear-case": "Accessories",
  "orchard-35w-charger": "Chargers",
};

const LATEST: { slug: string; dark?: boolean; eyebrow?: string; desc: string }[] = [
  { slug: "orchard-phone-17-pro", dark: true, eyebrow: "New", desc: "Our most capable phone yet, with a titanium frame and three 48MP cameras." },
  { slug: "orchard-phone-17", eyebrow: "New", desc: "Colour-infused glass and an all-day battery." },
  { slug: "orchard-watch-11", dark: true, eyebrow: "New", desc: "Sleep score, heart rhythm alerts and a brighter display." },
  { slug: "orchard-book-air", desc: "Fanless, silent and up to 18 hours of battery." },
  { slug: "orchard-pad-air", desc: "Laptop-class power in 11 or 13 inches." },
  { slug: "orchard-buds-pro", desc: "Twice the noise cancellation of the previous generation." },
];

export default async function StorePage() {
  const { spec } = await getSpec();
  const accessories = PRODUCTS.filter((p) => p.accessory);
  return (
    <div className="store">
      <header className="store-header">
        <h1 className="store-title">Store</h1>
        <div className="store-tagline">
          <h2>The best place to buy everything Orchard.</h2>
          <Link href="/support">Talk to a Specialist ↗</Link>
          <Link href="/support">Find an Orchard Store ↗</Link>
        </div>
      </header>

      <nav className="scroller productnav" aria-label="Shop by product" data-darwin="category-nav">
        {NAV.map((slug) => {
          const p = getProduct(slug)!;
          return (
            <Link key={slug} href={`/products/${slug}`} className="productnav-item">
              <DeviceArt kind={p.kind} colour={p.colours[0].hex} pro={slug.endsWith("-pro")} className="productnav-art" label={p.name} />
              <span>{NAV_LABEL[slug]}</span>
            </Link>
          );
        })}
      </nav>

      <section className="shelf" data-darwin="latest">
        <h2 className="shelf-header">
          The latest. <span>Fresh from the Orchard.</span>
        </h2>
        <div className="scroller">
          {LATEST.map(({ slug, dark, eyebrow, desc }) => {
            const p = getProduct(slug)!;
            return (
              <div key={slug} className={`card ${dark ? "dark" : ""}`}>
                <Link href={`/products/${slug}`} className="card-link" aria-label={p.name} />
                <div className="card-content">
                  {eyebrow && <p className="card-eyebrow">{eyebrow}</p>}
                  <h3 className="card-title">{p.name}</h3>
                  <p className="card-desc">
                    {desc}
                    <br />
                    From {gbp(p.price, { whole: true })} or {monthly(p.price)}
                  </p>
                </div>
                <div className="card-image">
                  <DeviceArt kind={p.kind} colour={p.colours[0].hex} pro={slug.endsWith("-pro")} label={p.name} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <ProductGrid spec={spec} />

      <section className="shelf" id="accessories" data-darwin="accessories">
        <h2 className="shelf-header">
          Accessories. <span>Essentials that pair perfectly with your devices.</span>
        </h2>
        <div className="scroller">
          {accessories.map((p) => (
            <div key={p.slug} className="card acc-card">
              <Link href={`/products/${p.slug}`} className="card-link" aria-label={p.name} />
              <div className="card-image">
                <DeviceArt kind={p.kind} colour={p.colours[0].hex} label={p.name} />
              </div>
              <div className="card-content">
                <h3 className="card-title">{p.name}</h3>
                <p className="card-price">{gbp(p.price)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
