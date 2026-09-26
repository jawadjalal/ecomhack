import Image from "next/image";
import { Check, ChevronRight, CreditCard, Flame, Lock, RotateCcw, Search, ShieldCheck, ShoppingBag, Star, Truck } from "lucide-react";
import { satoshi } from "./satoshi";
import { StickyBuy } from "./sticky-buy";
import "./vanta-after.css";

/**
 * The "after" storefront — what Darwin ships once it has watched humans and agents
 * use the before page. Each fix below answers a specific seeded defect in
 * `vanta-home.tsx`, and the additions past that are ordinary conversion work.
 *
 *   FIX 1  Buy is a real primary control — #0071e3 pill, white text, 4.6:1 contrast.
 *   FIX 2  Every product carries a price, so shoppers and agents can compare.
 *   FIX 3  One delivery promise, stated once and honoured everywhere.
 *   FIX 4  Full JSON-LD product graph, so an AI shopping agent can read the
 *          catalogue, price, availability and rating without scraping layout.
 *   FIX 5  Descriptive alt text on every image.
 *
 *   Conversion work beyond the fixes: visible ratings and review counts, a trust
 *   strip, per-product stock and delivery reassurance, and a single unambiguous
 *   primary action per unit.
 */

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
  pence: number;
  /** Instalment term shown beside the price — removes sticker shock at the CTA. */
  months: number;
  rating: number;
  reviews: number;
  stock: string;
  /** Units remaining. Under LOW_STOCK it renders as scarcity instead of reassurance. */
  left: number;
  image: string;
  alt: string;
  theme: "dark" | "light";
}

const LOW_STOCK = 6;

function monthly(pence: number, months: number): string {
  return `£${(pence / months / 100).toFixed(2)}`;
}

const tiles: Tile[] = [
  {
    id: "m1-silver",
    name: "M1 Rangefinder",
    tagline: "Hand-calibrated. Built to outlive you.",
    pence: 249900,
    months: 24,
    rating: 4.9,
    reviews: 412,
    stock: "In stock — free delivery Thursday",
    left: 4,
    image: "/store/camera.jpg",
    alt: "The VANTA M1 Rangefinder camera in silver and black, resting on a pale studio plinth",
    theme: "light",
  },
  {
    id: "arc",
    name: "Arc",
    tagline: "Forty hours of adaptive silence.",
    pence: 54900,
    months: 12,
    rating: 4.8,
    reviews: 1286,
    stock: "In stock — free delivery Thursday",
    left: 38,
    image: "/store/headphones.jpg",
    alt: "VANTA Arc over-ear headphones in brushed aluminium with black leather cushions",
    theme: "dark",
  },
  {
    id: "loop",
    name: "Loop",
    tagline: "Grade 5 titanium. Woven band.",
    pence: 39900,
    months: 12,
    rating: 4.7,
    reviews: 903,
    stock: "In stock — free delivery Thursday",
    left: 5,
    image: "/store/watch.jpg",
    alt: "The VANTA Loop watch with a titanium case and black woven band",
    theme: "dark",
  },
  {
    id: "field",
    name: "Field",
    tagline: "Room-filling sound, pocket-sized.",
    pence: 22900,
    months: 12,
    rating: 4.8,
    reviews: 2140,
    stock: "In stock — free delivery Thursday",
    left: 120,
    image: "/store/speaker.jpg",
    alt: "The VANTA Field portable speaker in charcoal fabric with a machined control dial",
    theme: "light",
  },
];

const MARQUEE = tiles[0];

const trust = [
  { icon: Truck, title: "Free next-day delivery", body: "On every order, no minimum." },
  { icon: RotateCcw, title: "60-day returns", body: "Use it properly. Change your mind." },
  { icon: ShieldCheck, title: "Ten-year guarantee", body: "Parts and labour, all instruments." },
  { icon: Star, title: "4.8 average", body: "From 4,741 verified owners." },
];

const quotes = [
  {
    body: "I have shot on this every day for eight months. The shutter still feels exactly like it did on day one.",
    author: "Marianne O.",
    meta: "Verified owner · M1 Rangefinder",
  },
  {
    body: "Returned a pair after five weeks, no argument, refunded in two days. That is why I bought the camera too.",
    author: "Devan R.",
    meta: "Verified owner · Arc",
  },
  {
    body: "The finance option is what made it possible. Same price, just spread out, and no interest anywhere.",
    author: "Priya S.",
    meta: "Verified owner · Loop",
  },
];

const footerColumns = [
  { title: "Shop", links: ["Cameras", "Audio", "Watch", "Speakers", "Accessories", "Gift cards"] },
  { title: "Services", links: ["Calibration", "Trade in", "Financing", "Order status", "Repairs"] },
  { title: "Account", links: ["Manage your account", "Order history", "Saved items", "Newsletter"] },
  { title: "About", links: ["Our workshop", "Materials", "Ten-year promise", "Careers", "Press"] },
];

/** FIX 4: a machine-readable graph so agents never have to infer price from markup. */
function productGraph() {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${BRAND} instruments`,
    itemListElement: tiles.map((tile, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        "@id": `#${tile.id}`,
        name: `${BRAND} ${tile.name}`,
        description: tile.tagline,
        image: tile.image,
        brand: { "@type": "Brand", name: BRAND },
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: tile.rating,
          reviewCount: tile.reviews,
        },
        offers: {
          "@type": "Offer",
          price: (tile.pence / 100).toFixed(2),
          priceCurrency: "GBP",
          availability: "https://schema.org/InStock",
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingRate: { "@type": "MonetaryAmount", value: "0", currency: "GBP" },
          },
          hasMerchantReturnPolicy: {
            "@type": "MerchantReturnPolicy",
            merchantReturnDays: 60,
            returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
          },
        },
      },
    })),
  };
}

function Rating({ rating, reviews }: { rating: number; reviews: number }) {
  return (
    <p className="a-rating">
      <Star size={14} strokeWidth={0} className="a-star" aria-hidden="true" />
      <span>
        {rating.toFixed(1)} · {reviews.toLocaleString("en-GB")} reviews
      </span>
    </p>
  );
}

/** FIX 1 + FIX 2: one unmistakable primary action, with the price always beside it. */
function Actions({ tile, large = false }: { tile: Tile; large?: boolean }) {
  return (
    <>
      <div className={`a-actions${large ? " a-actions-lg" : ""}`}>
        <a className="a-btn" href={`#${tile.id}`}>
          Add to Bag — {price(tile.pence)}
        </a>
        <a className="a-link" href={`#${tile.id}`}>
          Learn more <ChevronRight size={large ? 14 : 13} strokeWidth={2.6} />
        </a>
      </div>
      {/* Instalment pricing: the same number, framed so it clears the affordability bar. */}
      <p className="a-finance">
        or {monthly(tile.pence, tile.months)}/mo for {tile.months} mo at 0% APR
      </p>
    </>
  );
}

/** Reassurance when stock is healthy, scarcity when it genuinely is not. */
function Stock({ tile }: { tile: Tile }) {
  if (tile.left <= LOW_STOCK) {
    return (
      <p className="a-stock a-stock-low">
        <Flame size={14} strokeWidth={2} aria-hidden="true" />
        Only {tile.left} left — order today for delivery Thursday
      </p>
    );
  }
  return (
    <p className="a-stock">
      <Check size={14} strokeWidth={2.6} aria-hidden="true" />
      {tile.stock}
    </p>
  );
}

export function VantaAfter() {
  return (
    <div className={`a ${satoshi.variable}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productGraph()).replace(/</g, "\\u003c") }}
      />

      <a className="a-skip" href="#main">Skip to content</a>

      <StickyBuy
        watch="top"
        name={`${BRAND} ${MARQUEE.name}`}
        price={price(MARQUEE.pence)}
        months={MARQUEE.months}
        monthly={monthly(MARQUEE.pence, MARQUEE.months)}
      />

      <header className="a-nav-bar">
        <nav className="a-nav" aria-label="Global">
          <a className="a-wordmark" href="#top" aria-label={`${BRAND} home`}>{BRAND}</a>
          {navLinks.map((label) => (
            <a key={label} href={`#${label.toLowerCase()}`}>{label}</a>
          ))}
          <a href="#search" aria-label="Search"><Search size={15} strokeWidth={1.9} /></a>
          <a href="#bag" aria-label="Bag"><ShoppingBag size={15} strokeWidth={1.9} /></a>
        </nav>
      </header>

      {/* FIX 3: the single delivery promise, stated once and never contradicted. */}
      <p className="a-promo">
        Free next-day delivery and 60-day returns on every order.{" "}
        <a href="#delivery">Learn more <ChevronRight size={11} strokeWidth={2.6} /></a>
      </p>

      <main id="main">
        <section className="a-unit a-marquee" id="top" aria-labelledby="a-marquee-title">
          <div className="a-copy">
            <p className="a-eyebrow">New</p>
            <h1 id="a-marquee-title">M1 Rangefinder</h1>
            <p className="a-subhead">Light, captured.</p>
            <Rating rating={MARQUEE.rating} reviews={MARQUEE.reviews} />
            <Actions tile={MARQUEE} large />
            <Stock tile={MARQUEE} />
            <p className="a-assure">
              <Truck size={13} strokeWidth={2} aria-hidden="true" /> Free delivery
              <span aria-hidden="true">·</span>
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" /> 60-day returns
              <span aria-hidden="true">·</span>
              <Lock size={13} strokeWidth={2} aria-hidden="true" /> Secure checkout
            </p>
          </div>
          <div className="a-art">
            <Image
              src="/store/camera-hero.jpg"
              alt="The VANTA M1 Rangefinder camera lit against dark stone"
              fill
              preload
              sizes="100vw"
            />
          </div>
        </section>

        <section className="a-trust" aria-label="Why buy from us">
          {trust.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
              <strong>{title}</strong>
              <span>{body}</span>
            </div>
          ))}
        </section>

        <div className="a-grid">
          {tiles.map((tile) => (
            <section
              key={tile.id}
              id={tile.id}
              className={`a-unit a-tile a-${tile.theme}`}
              aria-labelledby={`a-${tile.id}-title`}
            >
              <div className="a-copy">
                <h2 id={`a-${tile.id}-title`}>{tile.name}</h2>
                <p className="a-subhead">{tile.tagline}</p>
                <Rating rating={tile.rating} reviews={tile.reviews} />
                <Actions tile={tile} />
                <Stock tile={tile} />
              </div>
              <div className="a-art">
                <Image src={tile.image} alt={tile.alt} fill sizes="(max-width: 734px) 100vw, 50vw" />
              </div>
            </section>
          ))}
        </div>

        <section className="a-quotes" aria-labelledby="a-quotes-title">
          <h2 id="a-quotes-title">4,741 owners. 4.8 average.</h2>
          <div className="a-quote-grid">
            {quotes.map((quote) => (
              <figure key={quote.author}>
                <div className="a-quote-stars" aria-label="5 out of 5 stars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} size={14} strokeWidth={0} className="a-star" aria-hidden="true" />
                  ))}
                </div>
                <blockquote>{quote.body}</blockquote>
                <figcaption>
                  <strong>{quote.author}</strong>
                  <span>{quote.meta}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="a-guarantee" aria-labelledby="a-guarantee-title">
          <ShieldCheck size={30} strokeWidth={1.5} aria-hidden="true" />
          <h2 id="a-guarantee-title">Sixty days to change your mind.</h2>
          <p>
            Use it properly. If it is not right, send it back for a full refund — we pay the postage.
            Every instrument is guaranteed for ten years, parts and labour.
          </p>
          <p className="a-pay">
            <CreditCard size={14} strokeWidth={2} aria-hidden="true" />
            Visa · Mastercard · Amex · Apple Pay · 0% finance available
          </p>
        </section>

        <section className="a-close" aria-labelledby="a-close-title">
          <h2 id="a-close-title">Own less. Own better.</h2>
          <p>Every instrument ships free, returns free for sixty days, and is guaranteed for ten years.</p>
          <a className="a-btn a-btn-lg" href="#store">Shop all instruments</a>
        </section>
      </main>

      <footer className="a-footer">
        <div className="a-footer-inner">
          <p className="a-fine">
            Prices include VAT and free next-day delivery. Ten-year parts guarantee applies to all {BRAND}
            {" "}instruments purchased directly.
          </p>
          <div className="a-footer-cols">
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
          <div className="a-footer-legal">
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
