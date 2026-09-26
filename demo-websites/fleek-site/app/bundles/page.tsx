import Link from "next/link";
import type { Metadata } from "next";
import { getSpec } from "@/lib/config";
import { BUNDLES, CATEGORIES, categoryById, sortBundles } from "@/lib/catalog";
import { BundleGrid } from "@/components/bundle-card";
import { SortSelect } from "@/components/sort-select";
import { ChevronDown } from "@/components/icons";

export const metadata: Metadata = { title: "All bundles" };

const SORTS = ["featured", "bestselling", "price-asc", "rating"] as const;
const FILTERS = ["Quality Score", "Department", "Bundle Type", "Brands", "Size", "Grade", "Total price", "Price per piece"];

export default async function BundlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const spec = getSpec();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const category = categoryById(one(sp.category));
  const q = one(sp.q).trim().toLowerCase();
  const sortParam = one(sp.sort);
  const sort = (SORTS as readonly string[]).includes(sortParam) ? sortParam : spec.productGrid.sort;

  let list = BUNDLES.filter((b) => !category || b.category === category.id);
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter((b) => {
      const hay = `${b.name} ${b.category} ${b.era} ${b.brands} ${b.description.join(" ")}`.toLowerCase();
      return words.every((w) => hay.includes(w.replace(/s$/, "")));
    });
  }
  list = sortBundles(list, sort);
  const title = q ? `“${q}”` : category ? category.name : "All";

  return (
    <div className="listing">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span className="sep">&gt;</span>
        <Link href="/bundles" className="here">
          Collections
        </Link>
        <span className="sep">&gt;</span>
        <span className="here">{title}</span>
      </nav>
      <h1>{title}</h1>
      <p className="intro">
        Stock your rails with <b>{category ? category.name.toLowerCase() : q || "all"}</b>. Bundles from verified suppliers, graded and counted, in mixed sizes and
        styles for every kind of reseller. {list.length} bundle{list.length === 1 ? "" : "s"}.
      </p>
      <div className="listing-body">
        <aside className="filters" aria-label="Filters">
          <div className="filter">
            Sort by <SortSelect value={sort} />
          </div>
          <div className="filter">
            On sale <span className="toggle" aria-hidden />
          </div>
          <div className="filter">
            Categories <ChevronDown style={{ width: 18, height: 18 }} />
          </div>
          <div className="filter-cats">
            <Link href="/bundles" className={!category ? "on" : ""}>
              All
            </Link>
            {CATEGORIES.map((c) => (
              <Link key={c.id} href={`/bundles?category=${c.id}`} className={category?.id === c.id ? "on" : ""}>
                {c.name}
              </Link>
            ))}
          </div>
          {FILTERS.map((f) => (
            <div key={f} className="filter">
              {f} <ChevronDown style={{ width: 18, height: 18 }} />
            </div>
          ))}
          <Link href="/bundles" className="btn btn-outline btn-block">
            Clear all
          </Link>
          <Link href={category ? `/bundles?category=${category.id}` : "/bundles"} className="btn btn-yellow btn-block" style={{ marginTop: 16 }}>
            Apply filters
          </Link>
        </aside>
        <div>
          {list.length ? (
            <BundleGrid bundles={list} list={category ? `category_${category.id}` : q ? "search" : "all"} variant="list" />
          ) : (
            <div className="empty">
              <p>No bundles match “{q}”.</p>
              <Link href="/bundles" className="btn btn-ink" style={{ marginTop: 16 }}>
                See all bundles
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
