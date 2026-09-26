"use client";

import { useEffect, useState } from "react";

/**
 * Persistent buy bar. Appears once the hero unit — and with it the primary CTA —
 * has scrolled out of view. Rendered only when productPage.ctaPosition === "sticky".
 */
export function StickyBuy({ watch, name, price, label }: {
  /** id of the element whose exit reveals the bar. */
  watch: string;
  name: string;
  price: string;
  label: string;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(watch);
    if (!hero) return;
    const io = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(hero);
    return () => io.disconnect();
  }, [watch]);

  return (
    <div className={`v-sticky${shown ? " v-sticky-on" : ""}`} data-darwin="sticky-cta-bar" aria-hidden={!shown}>
      <div className="v-sticky-inner">
        <div className="v-sticky-copy">
          <strong>{name}</strong>
          <span>{price}</span>
        </div>
        <a className="v-btn" href="#bag" data-darwin="cta-add-to-cart" tabIndex={shown ? undefined : -1}>{label}</a>
      </div>
    </div>
  );
}
