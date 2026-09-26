/** Catalog helpers for the storefront (sorting, filtering, images, labels). Pure. */
import { PRODUCTS, type Product } from "@/lib/catalog/products";
import type { PageSpec } from "@/lib/contracts";

export type SortKey = PageSpec["productGrid"]["sort"];
export type Category = Product["category"];

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "road", label: "Road" },
  { key: "trail", label: "Trail" },
  { key: "racing", label: "Racing" },
  { key: "accessories", label: "Accessories" },
];

export const SORT_LABELS: Record<SortKey, string> = {
  featured: "Featured",
  bestselling: "Bestselling",
  "price-asc": "Price: low to high",
  rating: "Top rated",
};

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const list = [...products];
  switch (sort) {
    case "bestselling":
      return list.sort((a, b) => a.bestsellerRank - b.bestsellerRank);
    case "price-asc":
      return list.sort((a, b) => a.price - b.price);
    case "rating":
      return list.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    default:
      return list;
  }
}

export function storeProducts(sort: SortKey, category?: string | null): Product[] {
  const filtered = category ? PRODUCTS.filter((p) => p.category === category) : PRODUCTS;
  return sortProducts(filtered, sort);
}

export function isCategory(v: unknown): v is Category {
  return CATEGORIES.some((c) => c.key === v);
}

export function colorSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Art for a product in a given colourway (falls back to the default image). */
export function productImage(product: Product, colorName?: string): string {
  if (!colorName || product.colors.length < 2 || !product.image.startsWith("/products/")) return product.image;
  if (!product.colors.some((c) => c.name === colorName)) return product.image;
  return product.image.replace(/\.svg$/, `--${colorSlug(colorName)}.svg`);
}

export function categoryLabel(c: Category) {
  return CATEGORIES.find((x) => x.key === c)?.label ?? c;
}

/** Sizes in display order (numeric UK sizes ascending, then others). */
export function sizesOf(product: Product): { size: string; stock: number }[] {
  return Object.entries(product.stock)
    .map(([size, stock]) => ({ size, stock }))
    .sort((a, b) => {
      const na = Number(a.size);
      const nb = Number(b.size);
      if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
      return na - nb;
    });
}

export const isOneSize = (product: Product) => Object.keys(product.stock).length === 1;

export const sizeLabel = (size: string) => (/^\d+(\.\d+)?$/.test(size) ? `UK ${size}` : size);

export const LOW_STOCK = 5;

/** The size to call out for "Only N left", preferring the selected one. */
export function lowStockCallout(product: Product, selected?: string | null): { size: string; stock: number } | null {
  if (selected) {
    const n = product.stock[selected] ?? 0;
    return n > 0 && n <= LOW_STOCK ? { size: selected, stock: n } : null;
  }
  const candidates = sizesOf(product).filter((s) => s.stock > 0 && s.stock <= LOW_STOCK);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => a.stock - b.stock)[0];
}

/** Plausible 5→1 star distribution (percentages) for a given average rating. */
export function ratingDistribution(rating: number): number[] {
  const five = Math.round(Math.min(92, Math.max(40, (rating - 3.6) * 60 + 20)));
  const four = Math.round(Math.min(40, (100 - five) * 0.62));
  const three = Math.round((100 - five - four) * 0.55);
  const two = Math.round((100 - five - four - three) * 0.6);
  const one = Math.max(0, 100 - five - four - three - two);
  return [five, four, three, two, one];
}
