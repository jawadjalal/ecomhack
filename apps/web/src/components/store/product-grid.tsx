import type { PageSpec } from "@/lib/contracts";
import { CATEGORIES, SORT_LABELS, isCategory, storeProducts } from "@/lib/storefront/products";
import { normalizeQuery, searchProducts } from "@/lib/storefront/search";
import { ProductCard } from "./product-card";
import { SearchForm } from "./search-form";
import { StoreLink, TrackEvent } from "./store-provider";
import { Container } from "./ui";

const GRID_COLS: Record<PageSpec["productGrid"]["columns"], string> = {
  2: "grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-12 lg:gap-x-10",
  3: "grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-10 sm:gap-x-6",
  4: "grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-10 sm:gap-x-5",
};

export function ProductGrid({ spec, category, query }: { spec: PageSpec; category?: string; query?: string }) {
  const active = isCategory(category) ? category : undefined;
  const q = normalizeQuery(query);
  const sorted = storeProducts(spec.productGrid.sort, active);
  const products = q ? searchProducts(q, sorted) : sorted;
  const title = q ? `Results for “${q}”` : active ? CATEGORIES.find((c) => c.key === active)?.label : "The collection";

  return (
    <section id="collection" className="scroll-mt-20 py-14 sm:py-20" data-darwin="product-grid" data-columns={spec.productGrid.columns}>
      {q && (
        <TrackEvent
          key={`${q}|${active ?? ""}`}
          event="search_performed"
          props={{ query: q, results: products.length, result_ids: products.slice(0, 8).map((p) => p.id), ...(active ? { category: active } : {}) }}
        />
      )}
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="pace-eyebrow text-(--muted)">{q ? "Search" : "Shop"}</p>
            <h2 className="pace-display mt-2 text-4xl font-bold break-words sm:text-5xl">{title}</h2>
          </div>
          <p className="text-sm text-(--muted)">
            {products.length} {products.length === 1 ? "product" : "products"}
            {q ? (
              <>
                {" · "}
                <StoreLink href={active ? `/store?category=${active}#collection` : "/store#collection"} scroll={false} className="pace-link font-medium text-(--ink)">
                  Clear search
                </StoreLink>
              </>
            ) : (
              <>
                {" "}
                · Sorted by <span className="font-medium text-(--ink)">{SORT_LABELS[spec.productGrid.sort]}</span>
              </>
            )}
          </p>
        </div>
        {q && <SearchForm key={q} defaultValue={q} className="mt-6 max-w-xl" />}
        <nav className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Categories">
          {[{ key: undefined, label: "All" }, ...CATEGORIES].map((c) => {
            const on = c.key === active;
            return (
              <StoreLink
                key={c.label}
                href={c.key ? `/store?category=${c.key}#collection` : "/store#collection"}
                scroll={false}
                className={`pace-chip pace-focus shrink-0 border px-4 py-2 text-sm font-medium transition ${
                  on ? "border-(--ink) bg-(--ink) text-white" : "border-(--line) bg-white hover:border-(--ink)"
                }`}
                aria-current={on ? "page" : undefined}
              >
                {c.label}
              </StoreLink>
            );
          })}
        </nav>
        {q && products.length === 0 ? (
          <div className="pace-card mt-10 border border-dashed border-(--line) px-6 py-12 text-center" data-darwin="search-empty">
            <p className="text-lg font-semibold">Nothing matches “{q}”</p>
            <p className="mt-2 text-sm text-(--muted)">Try a product name, or a category like road, trail, racing or socks.</p>
            <StoreLink href="/store#collection" scroll={false} className="pace-btn pace-btn-secondary mt-6">
              Shop all products
            </StoreLink>
          </div>
        ) : (
          <div className={`mt-10 grid ${GRID_COLS[spec.productGrid.columns]}`}>
            {products.map((p, i) => (
              <ProductCard key={p.id} product={p} position={i + 1} eager={i < 4} />
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}
