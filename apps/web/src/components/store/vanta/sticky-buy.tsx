"use client";

import { useEffect, useState } from "react";

/**
 * Persistent buy bar. Appears once the hero unit — and with it the primary CTA —
 * has scrolled out of view, so the action is never more than one glance away.
 * Watches the hero rather than a top-of-document sentinel, which would report
 * "out of view" immediately and show the bar before the user has scrolled.
 */
export function StickyBuy({ watch, name, price, months, monthly }: {
  /** id of the element whose exit reveals the bar. */
  watch: string;
  name: string;
  price: string;
  months: number;
  monthly: string;
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
    <div className={`a-sticky${shown ? " a-sticky-on" : ""}`} aria-hidden={!shown}>
      <div className="a-sticky-inner">
        <div className="a-sticky-copy">
          <strong>{name}</strong>
          <span>
            {price} or {monthly}/mo for {months} mo at 0% APR
          </span>
        </div>
        <a className="a-btn" href="#bag" tabIndex={shown ? undefined : -1}>Add to Bag</a>
      </div>
    </div>
  );
}
