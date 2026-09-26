"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label="Sort by"
      value={value}
      onChange={(e) => {
        const u = new URLSearchParams(params.toString());
        u.set("sort", e.target.value);
        router.push(`${pathname}?${u.toString()}`);
      }}
    >
      <option value="featured">Featured</option>
      <option value="bestselling">Bestselling</option>
      <option value="price-asc">Price: low to high</option>
      <option value="rating">Top rated</option>
    </select>
  );
}
