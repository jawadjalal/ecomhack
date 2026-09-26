"use client";

import { useState } from "react";
import { getProduct } from "@/lib/catalog";
import { useBag } from "./bag";

/** productGrid.showQuickAdd: default finish and option straight into the bag. */
export function QuickAdd({ slug }: { slug: string }) {
  const bag = useBag();
  const [added, setAdded] = useState(false);
  const p = getProduct(slug);
  if (!p) return null;
  return (
    <button
      type="button"
      className="button button-reduced"
      data-darwin="quick-add"
      onClick={() => {
        bag.add({ slug, colour: p.colours[0].name, option: p.option?.choices[0].name }, "grid-quick-add");
        setAdded(true);
        setTimeout(() => setAdded(false), 1800);
      }}
    >
      {added ? "Added" : "Add to Bag"}
    </button>
  );
}
