import Link from "next/link";
import type { PageSpec } from "@/lib/page-spec";
import { GRID_PRODUCTS, sortProducts } from "@/lib/catalog";
import { gbp, monthly } from "@/lib/format";
import { DeviceArt } from "./device-art";
import { QuickAdd } from "./quick-add";
import { Stars } from "./stars";

/** "All models" shop cards. Knobs: productGrid.columns / showRatings / showQuickAdd / sort. */
export function ProductGrid({ spec }: { spec: PageSpec }) {
  const g = spec.productGrid;
  const products = sortProducts(GRID_PRODUCTS.filter((p) => !p.accessory), g.sort);
  return (
    <section className="shelf" data-darwin="product-grid" id="all-models">
      <h2 className="shelf-header">
        All models. <span>Take your pick.</span>
      </h2>
      <ul className={`shop-grid cols-${g.columns}`} data-sort={g.sort}>
        {products.map((p) => (
          <li key={p.slug} className="card shop-card" data-darwin="product-card" data-product={p.slug}>
            <Link href={`/products/${p.slug}`} className="card-link" aria-label={p.name} />
            <div className="card-content">
              {p.isNew && <p className="card-eyebrow">New</p>}
              <h3 className="card-title">{p.name}</h3>
            </div>
            <div className="card-image">
              <DeviceArt kind={p.kind} colour={p.colours[0].hex} pro={p.slug.endsWith("-pro")} label={p.name} />
            </div>
            <div className="swatches" aria-label={`Available in ${p.colours.length} finishes`}>
              {p.colours.map((c) => (
                <span key={c.name} style={{ background: c.hex }} title={c.name} />
              ))}
            </div>
            <div className="shop-card-foot">
              <div className="shop-card-price">
                From {gbp(p.price, { whole: true })} or {monthly(p.price)}
                {g.showRatings && (
                  <div>
                    <Stars rating={p.rating} count={p.reviews} small />
                  </div>
                )}
              </div>
              {g.showQuickAdd ? (
                <QuickAdd slug={p.slug} />
              ) : (
                <Link href={`/products/${p.slug}#buy`} className="button button-reduced">
                  Buy
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
