import Image from "next/image";
import { ChevronRight, RotateCcw, Search, ShieldCheck, ShoppingBag, Star, Truck } from "lucide-react";
import type { PageSpec } from "@/lib/contracts";
import { applyPatch } from "@/lib/spec/patch";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { formatGBP } from "@/lib/money";
import { satoshi } from "./satoshi";
import { StickyBuy } from "./sticky-buy";
import "./vanta.css";

/**
 * Spec-driven VANTA home. One Apple layout; Gen 0 vs the shipped page is only
 * which PageSpec fields are on. No second "after" implementation.
 *
 *   productGrid.showRatings            star ratings + review counts
 *   hero.showSocialProof               review quotes
 *   productPage.trustBadges            4-icon trust strip
 *   productPage.showDeliveryEstimate   stock / delivery line
 *   productPage.showReturnsPolicy      60-day guarantee band
 *   productPage.urgency                "Only N left" when stock is actually low
 *   cart.showShippingUpfront           hides the +£9.95 line that contradicts the promo
 *   cart.freeShippingThreshold         0 = free delivery (honest promo)
 *   agentSurface.structuredData        JSON-LD graph AND descriptive alt text
 *   productPage.ctaPosition/ctaText    grey "below-description" link vs #0071e3 pill
 *   ctaPosition === "sticky"           sticky buy bar
 */

const BRAND = "VANTA";

/** Seeded delivery surcharge (integer pence). Shown only while shipping is hidden. */
const DELIVERY_PENCE = 995;

const LOW_STOCK = 6;

const navLinks = ["Store", "Cameras", "Audio", "Watch", "Speakers", "Accessories", "Support"];

interface Tile {
  id: string;
  name: string;
  tagline: string;
  pence: number;
  rating: number;
  reviews: number;
  left: number;
  image: string;
  alt: string;
  theme: "dark" | "light";
}

const tiles: Tile[] = [
  {
    id: "m1-silver",
    name: "M1 Rangefinder",
    tagline: "Hand-calibrated. Built to outlive you.",
    pence: 249900,
    rating: 4.9,
    reviews: 412,
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
    rating: 4.8,
    reviews: 1286,
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
    rating: 4.7,
    reviews: 903,
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
    rating: 4.8,
    reviews: 2140,
    left: 120,
    image: "/store/speaker.jpg",
    alt: "The VANTA Field portable speaker in charcoal fabric with a machined control dial",
    theme: "light",
  },
];

const HERO_ALT = "The VANTA M1 Rangefinder camera lit against dark stone";

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

function shippingPence(pricePence: number, spec: PageSpec): number {
  const threshold = spec.cart.freeShippingThreshold;
  if (threshold !== null && pricePence >= threshold) return 0;
  return DELIVERY_PENCE;
}

/** Promo copy. Hidden shipping keeps the seeded "free delivery" claim that the tiles contradict. */
function promoCopy(spec: PageSpec): string {
  if (!spec.cart.showShippingUpfront) {
    return "Free engraving and next-day delivery on every order.";
  }
  if (spec.announcement.enabled && spec.announcement.text.trim()) return spec.announcement.text;
  const threshold = spec.cart.freeShippingThreshold;
  if (threshold === 0) return "Free next-day delivery on every order.";
  if (threshold !== null) return `Free next-day delivery on orders over ${formatGBP(threshold)}.`;
  return `Next-day delivery ${formatGBP(DELIVERY_PENCE)}.`;
}

function deliveryEstimate(pence: number, spec: PageSpec): string {
  const shipping = shippingPence(pence, spec);
  if (shipping === 0) return "In stock — free delivery Thursday";
  return `In stock — delivery Thursday, ${formatGBP(shipping)}`;
}

/** Descriptive alt only when agents get structured data — one knob, both readability fixes. */
function altText(spec: PageSpec, descriptive: string): string {
  return spec.agentSurface.structuredData ? descriptive : "";
}

function productGraph(spec: PageSpec) {
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
        ...(spec.productGrid.showRatings
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: tile.rating,
                reviewCount: tile.reviews,
              },
            }
          : {}),
        offers: {
          "@type": "Offer",
          price: (tile.pence / 100).toFixed(2),
          priceCurrency: "GBP",
          availability: "https://schema.org/InStock",
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingRate: {
              "@type": "MonetaryAmount",
              value: (shippingPence(tile.pence, spec) / 100).toFixed(2),
              currency: "GBP",
            },
          },
          ...(spec.productPage.showReturnsPolicy
            ? {
                hasMerchantReturnPolicy: {
                  "@type": "MerchantReturnPolicy",
                  merchantReturnDays: 60,
                  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
                },
              }
            : {}),
        },
      },
    })),
  };
}

function Rating({ rating, reviews }: { rating: number; reviews: number }) {
  return (
    <p className="v-rating" data-darwin="card-rating">
      <Star size={14} strokeWidth={0} className="v-star" aria-hidden="true" />
      <span>
        {rating.toFixed(1)} · {reviews.toLocaleString("en-GB")} reviews
      </span>
    </p>
  );
}

/** Grey link while the CTA sits below the description; filled pill once it is sticky or above the fold. */
function BuyCta({ spec, href, darwin, large = false }: { spec: PageSpec; href: string; darwin: string; large?: boolean }) {
  const label = spec.productPage.ctaText;
  if (spec.productPage.ctaPosition === "below-description") {
    return (
      <a className="v-link v-buy" href={href} data-darwin={darwin}>
        {label} <ChevronRight size={large ? 14 : 13} strokeWidth={2.6} />
      </a>
    );
  }
  return (
    <a className={`v-btn${large ? " v-btn-lg" : ""}`} href={href} data-darwin={darwin}>
      {label}
    </a>
  );
}

function ProductMeta({ tile, spec, hero = false }: { tile: Tile; spec: PageSpec; hero?: boolean }) {
  const low = spec.productPage.urgency === "low-stock" && tile.left <= LOW_STOCK;
  return (
    <>
      {spec.productGrid.showRatings && <Rating rating={tile.rating} reviews={tile.reviews} />}
      <div className="v-links">
        <a className="v-link" href={`#${tile.id}`}>
          Learn more <ChevronRight size={hero ? 14 : 13} strokeWidth={2.6} />
        </a>
        <BuyCta spec={spec} href={`#${tile.id}`} darwin={hero ? "hero-cta" : "cta-add-to-cart"} large={hero} />
        <span className="v-from">From {formatGBP(tile.pence)}</span>
      </div>
      {!spec.cart.showShippingUpfront && (
        <p className="v-delivery">+{formatGBP(DELIVERY_PENCE)} delivery</p>
      )}
      {spec.productPage.showDeliveryEstimate && (
        <p className="v-stock" data-darwin="delivery-estimate">
          {deliveryEstimate(tile.pence, spec)}
        </p>
      )}
      {low && (
        <p className="v-stock v-stock-low" data-darwin="urgency">
          Only {tile.left} left — order today for delivery Thursday
        </p>
      )}
    </>
  );
}

function trustItems(spec: PageSpec) {
  const threshold = spec.cart.freeShippingThreshold;
  const allFree = tiles.every((tile) => shippingPence(tile.pence, spec) === 0);
  const delivery = !spec.cart.showShippingUpfront
    ? { title: "Next-day delivery", body: "Charged at checkout." }
    : allFree && threshold === 0
      ? { title: "Free next-day delivery", body: "On every order, no minimum." }
      : threshold !== null
        ? { title: "Free next-day delivery", body: `On orders over ${formatGBP(threshold)}.` }
        : { title: "Tracked next-day delivery", body: formatGBP(DELIVERY_PENCE) };
  return [
    { icon: Truck, ...delivery },
    { icon: RotateCcw, title: "60-day returns", body: "Use it properly. Change your mind." },
    { icon: ShieldCheck, title: "Ten-year guarantee", body: "Parts and labour, all instruments." },
    { icon: Star, title: "4.8 average", body: "From 4,741 verified owners." },
  ];
}

export function VantaHome({ spec }: { spec: PageSpec }) {
  const hero = tiles[0];
  const sticky = spec.productPage.ctaPosition === "sticky";
  const readable = spec.agentSurface.structuredData;

  return (
    <div className={`v ${satoshi.variable}${sticky ? " v-has-sticky" : ""}`} data-spec-version={spec.version}>
      {readable && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productGraph(spec)).replace(/</g, "\\u003c") }}
        />
      )}

      {sticky && (
        <StickyBuy
          watch="top"
          name={`${BRAND} ${hero.name}`}
          price={formatGBP(hero.pence)}
          label={spec.productPage.ctaText}
        />
      )}

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
        {promoCopy(spec)}{" "}
        <a href="#delivery">Learn more <ChevronRight size={11} strokeWidth={2.6} /></a>
      </p>

      <main id="main">
        <section className="v-unit v-marquee" id="top" aria-labelledby="v-marquee-title" data-darwin="hero">
          <div className="v-copy">
            <p className="v-eyebrow">New</p>
            <h1 id="v-marquee-title">{hero.name}</h1>
            <p className="v-subhead">Light, captured.</p>
            <ProductMeta tile={hero} spec={spec} hero />
          </div>
          <div className="v-art">
            <Image src="/store/camera-hero.jpg" alt={altText(spec, HERO_ALT)} fill preload sizes="100vw" />
          </div>
        </section>

        {spec.productPage.trustBadges && (
          <section className="v-trust" aria-label="Why buy from us" data-darwin="trust-badges">
            {trustItems(spec).map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            ))}
          </section>
        )}

        <div className="v-grid" data-darwin="product-grid">
          {tiles.map((tile) => (
            <section
              key={tile.id}
              id={tile.id}
              className={`v-unit v-tile v-${tile.theme}`}
              aria-labelledby={`v-${tile.id}-title`}
              data-darwin="product-card"
            >
              <div className="v-copy">
                <h2 id={`v-${tile.id}-title`}>{tile.name}</h2>
                <p className="v-subhead">{tile.tagline}</p>
                <ProductMeta tile={tile} spec={spec} />
              </div>
              <div className="v-art">
                <Image src={tile.image} alt={altText(spec, tile.alt)} fill sizes="(max-width: 734px) 100vw, 50vw" />
              </div>
            </section>
          ))}
        </div>

        {spec.hero.showSocialProof && (
          <section className="v-quotes" aria-labelledby="v-quotes-title">
            <h2 id="v-quotes-title">4,741 owners. 4.8 average.</h2>
            <div className="v-quote-grid">
              {quotes.map((quote) => (
                <figure key={quote.author}>
                  <div className="v-quote-stars" aria-label="5 out of 5 stars">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Star key={i} size={14} strokeWidth={0} className="v-star" aria-hidden="true" />
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
        )}

        {spec.productPage.showReturnsPolicy && (
          <section className="v-guarantee" aria-labelledby="v-guarantee-title" data-darwin="returns-policy">
            <ShieldCheck size={30} strokeWidth={1.5} aria-hidden="true" />
            <h2 id="v-guarantee-title">Sixty days to change your mind.</h2>
            <p>
              Use it properly. If it is not right, send it back for a full refund — we pay the postage.
              Every instrument is guaranteed for ten years, parts and labour.
            </p>
          </section>
        )}
      </main>

      <footer className="v-footer">
        <div className="v-footer-inner">
          <p className="v-fine">
            {spec.cart.showShippingUpfront && spec.cart.freeShippingThreshold === 0
              ? `Prices include VAT and free next-day delivery. Ten-year parts guarantee applies to all ${BRAND} instruments purchased directly.`
              : `Prices shown include VAT. Ten-year parts guarantee applies to all ${BRAND} instruments purchased directly.`}
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

/**
 * Static polished reference for /vanta/after. The live demo flips /vanta via the
 * shipped spec, not this route.
 */
export const VANTA_AFTER_SPEC: PageSpec = applyPatch(DEFAULT_SPEC, {
  hero: { showSocialProof: true },
  productGrid: { showRatings: true },
  productPage: {
    ctaText: "Add to Bag",
    ctaPosition: "sticky",
    showDeliveryEstimate: true,
    showReturnsPolicy: true,
    urgency: "low-stock",
    trustBadges: true,
  },
  cart: { showShippingUpfront: true, freeShippingThreshold: 0 },
  agentSurface: { structuredData: true },
});
