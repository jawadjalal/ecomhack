import Image from "next/image";
import { ChevronRight, Search, ShoppingBag } from "lucide-react";
import { satoshi } from "./satoshi";
import "./vanta.css";

/**
 * SEEDED FLAWS — this page is the "before" state for the Darwin demo.
 * Every one of these is a real, detectable defect, not a mock. Remove them in the
 * "after" pass and the loop has something honest to show.
 *
 *   FLAW 1 (obvious)  Primary "Buy" CTA is near-invisible — #d2d2d7 on white,
 *                     ~1.3:1 contrast. Fails WCAG AA and reads as disabled.
 *   FLAW 2 (obvious)  Two of four products ship with no price at all, so neither a
 *                     shopper nor an agent can compare or decide.
 *   FLAW 3 (obvious)  The promo bar promises free next-day delivery while the tiles
 *                     charge £9.95 for it. A flat contradiction on one screen.
 *   FLAW 4 (subtle)   No JSON-LD / structured data anywhere on the page, so an AI
 *                     shopping agent cannot read the catalogue, price or stock.
 *                     Invisible to humans, fatal for agents.
 *   FLAW 5 (subtle)   Every product image has empty alt text, so screen readers and
 *                     agents see four unlabelled boxes where the products should be.
 */

/** Brand name. Single source of truth — change here and the storefront follows. */
const BRAND = "VANTA";

/** Money is integer pence everywhere in Darwin. */
function price(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB")}`;
}

const navLinks = ["Store", "Cameras", "Audio", "Watch", "Speakers", "Accessories", "Support"];

interface Tile {
  id: string;
  name: string;
  tagline: string;
  /** FLAW 2: absent on two products, so there is nothing to compare or decide on. */
  pence?: number;
  image: string;
  theme: "dark" | "light";
}

const tiles: Tile[] = [
  {
    id: "m1-silver",
    name: "M1 Rangefinder",
    tagline: "Hand-calibrated. Built to outlive you.",
    pence: 249900,
    image: "/store/camera.jpg",
    theme: "light",
  },
  {
    id: "arc",
    name: "Arc",
    tagline: "Forty hours of adaptive silence.",
    image: "/store/headphones.jpg",
    theme: "dark",
  },
  {
    id: "loop",
    name: "Loop",
    tagline: "Grade 5 titanium. Woven band.",
    pence: 39900,
    image: "/store/watch.jpg",
    theme: "dark",
  },
  {
    id: "field",
    name: "Field",
    tagline: "Room-filling sound, pocket-sized.",
    image: "/store/speaker.jpg",
    theme: "light",
  },
];

const footerColumns = [
  { title: "Shop", links: ["Cameras", "Audio", "Watch", "Speakers", "Accessories", "Gift cards"] },
  { title: "Services", links: ["Calibration", "Trade in", "Financing", "Order status", "Repairs"] },
  { title: "Account", links: ["Manage your account", "Order history", "Saved items", "Newsletter"] },
  { title: "About", links: ["Our workshop", "Materials", "Ten-year promise", "Careers", "Press"] },
];

function Links({ id, pence }: { id: string; pence?: number }) {
  return (
    <div className="v-links">
      <a className="v-link" href={`#${id}`}>
        Learn more <ChevronRight size={13} strokeWidth={2.6} />
      </a>
      {/* FLAW 1: the buy CTA is styled at ~1.3:1 contrast and reads as disabled. */}
      <a className="v-link v-buy" href={`#${id}`}>
        Buy <ChevronRight size={13} strokeWidth={2.6} />
      </a>
      {pence === undefined ? null : <span className="v-from">From {price(pence)}</span>}
    </div>
  );
}

export function VantaHome() {
  return (
    <div className={`v ${satoshi.variable}`}>
      <a className="v-skip" href="#main">Skip to content</a>

      <header className="v-nav-bar">
        <nav className="v-nav" aria-label="Global">
          <a className="v-wordmark" href="#top" aria-label={`${BRAND} home`}>{BRAND}</a>
          {navLinks.map((label) => (
            <a key={label} href={`#${label.toLowerCase()}`}>{label}</a>
          ))}
          <a href="#search" aria-label="Search"><Search size={15} strokeWidth={1.9} /></a>
          <a href="#bag" aria-label="Bag"><ShoppingBag size={15} strokeWidth={1.9} /></a>
        </nav>
      </header>

      <p className="v-promo">
        Free engraving and next-day delivery on every order. <a href="#delivery">Learn more <ChevronRight size={11} strokeWidth={2.6} /></a>
      </p>

      <main id="main">
        {/* Marquee ------------------------------------------------------- */}
        <section className="v-unit v-marquee" id="top" aria-labelledby="v-marquee-title">
          <div className="v-copy">
            <p className="v-eyebrow">New</p>
            <h1 id="v-marquee-title">M1 Rangefinder</h1>
            <p className="v-subhead">Light, captured.</p>
            <Links id="m1-silver" pence={249900} />
          </div>
          <div className="v-art">
            {/* FLAW 5: empty alt — agents and screen readers get an unlabelled box. */}
            <Image src="/store/camera-hero.jpg" alt="" fill preload sizes="100vw" />
          </div>
        </section>

        {/* Tile grid ------------------------------------------------------ */}
        <div className="v-grid">
          {tiles.map((tile) => (
            <section
              key={tile.id}
              id={tile.id}
              className={`v-unit v-tile v-${tile.theme}`}
              aria-labelledby={`v-${tile.id}-title`}
            >
              <div className="v-copy">
                <h2 id={`v-${tile.id}-title`}>{tile.name}</h2>
                <p className="v-subhead">{tile.tagline}</p>
                <Links id={tile.id} pence={tile.pence} />
                {/* FLAW 3: directly contradicts the free-delivery promise in the promo bar. */}
                <p className="v-delivery">+ £9.95 delivery</p>
              </div>
              <div className="v-art">
                {/* FLAW 5: empty alt — agents and screen readers get an unlabelled box. */}
                <Image src={tile.image} alt="" fill sizes="(max-width: 734px) 100vw, 50vw" />
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="v-footer">
        <div className="v-footer-inner">
          <p className="v-fine">
            Prices shown include VAT. Ten-year parts guarantee applies to all {BRAND} instruments purchased directly.
          </p>
          <div className="v-footer-cols">
            {footerColumns.map((col) => (
              <div key={col.title}>
                <h3>{col.title}</h3>
                <ul>
                  {col.links.map((link) => (
                    <li key={link}><a href="#top">{link}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="v-footer-legal">
            <span>Copyright © 2026 {BRAND} Instruments Ltd. All rights reserved.</span>
            <nav aria-label="Legal">
              <a href="#top">Privacy Policy</a>
              <a href="#top">Terms of Use</a>
              <a href="#top">Sales and Refunds</a>
              <a href="#top">Site Map</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
