"use client";

import Link from "next/link";
import { useState } from "react";
import { useBag } from "./bag";

export const NAV_LINKS: [string, string][] = [
  ["Store", "/store"],
  ["Book", "/products/orchard-book-air"],
  ["Pad", "/products/orchard-pad-air"],
  ["Phone", "/products/orchard-phone-17-pro"],
  ["Watch", "/products/orchard-watch-11"],
  ["Buds", "/products/orchard-buds-pro"],
  ["TV & Home", "/store"],
  ["Entertainment", "/"],
  ["Accessories", "/store#accessories"],
  ["Support", "/support"],
];

/** The Orchard mark: an original tree glyph (three canopies on a trunk). */
export function Logo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.15)} viewBox="0 0 24 27.6" aria-hidden="true">
      <circle cx="7.5" cy="10.5" r="6" fill="currentColor" />
      <circle cx="16.5" cy="10.5" r="6" fill="currentColor" />
      <circle cx="12" cy="6.5" r="6" fill="currentColor" />
      <rect x="10.6" y="13" width="2.8" height="13" rx="1.4" fill="currentColor" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="44" viewBox="0 0 15 44" aria-hidden="true">
      <circle cx="6.4" cy="20.4" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.4 24.4 14.2 28.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="14" height="44" viewBox="0 0 14 44" aria-hidden="true">
      <path d="M1.5 17.2h11v10.3a1.8 1.8 0 0 1-1.8 1.8H3.3a1.8 1.8 0 0 1-1.8-1.8z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.3 17.2v-1.3a2.7 2.7 0 0 1 5.4 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function GlobalNav() {
  const { count } = useBag();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <nav className={`globalnav ${open ? "open" : ""}`} aria-label="Global" data-darwin="global-nav">
      <div className="globalnav-content">
        <ul className="globalnav-list">
          <li className="gn-logo">
            <Link href="/" className="globalnav-link globalnav-icon" aria-label="Orchard" onClick={close}>
              <Logo />
            </Link>
          </li>
          {NAV_LINKS.map(([label, href]) => (
            <li key={label} className="gn-link">
              <Link href={href} className="globalnav-link" onClick={close}>
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/store" className="globalnav-link globalnav-icon" aria-label="Search orchard.example">
              <SearchIcon />
            </Link>
          </li>
          <li>
            <Link href="/bag" className="globalnav-link globalnav-icon globalnav-bag" aria-label={`Shopping bag, ${count} item${count === 1 ? "" : "s"}`} data-darwin="nav-bag" onClick={close}>
              <BagIcon />
              {count > 0 && <span className="globalnav-bag-badge">{count}</span>}
            </Link>
          </li>
          <li>
            <button type="button" className="globalnav-menu" aria-label={open ? "Close" : "Menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <span />
              <span />
            </button>
          </li>
        </ul>
      </div>
      <div className="globalnav-flyout">
        {NAV_LINKS.map(([label, href]) => (
          <Link key={label} href={href} onClick={close}>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
