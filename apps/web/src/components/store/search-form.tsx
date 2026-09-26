"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { MAX_QUERY_LENGTH, normalizeQuery } from "@/lib/storefront/search";
import { useStoreHref } from "./store-provider";

/**
 * Product search box → `/store?q=…#collection` (results render server-side from the query and are
 * tracked there as `search_performed`). Works without JS as a plain GET form.
 */
export function SearchForm({
  defaultValue = "",
  autoFocus,
  onDone,
  className = "",
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  /** Called after a search is submitted (e.g. to close the header panel). */
  onDone?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const href = useStoreHref();
  const id = useId();
  const [value, setValue] = useState(defaultValue);

  return (
    <form
      role="search"
      action="/store"
      method="get"
      className={`flex min-w-0 items-center gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        const q = normalizeQuery(value);
        if (!q) return;
        router.push(href(`/store?q=${encodeURIComponent(q)}#collection`));
        onDone?.();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Search products
      </label>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-(--muted)" aria-hidden />
        <input
          id={id}
          name="q"
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={MAX_QUERY_LENGTH}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search shoes, trail, socks…"
          className="pace-input w-full bg-white text-sm"
          style={{ paddingLeft: "2.5rem" }}
          data-darwin="search-input"
        />
      </div>
      <button type="submit" className="pace-btn pace-btn-primary min-h-11 shrink-0 px-5 text-sm" data-darwin="search-submit">
        Search
      </button>
    </form>
  );
}
