import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSpec } from "@/lib/config";
import { BUNDLES, bundleById, categoryById, discountPct, perPiece, supplierById, type Bundle } from "@/lib/catalog";
import { deliveryWindow, gbp, landedPrice, RETURNS_POLICY, shippingNote } from "@/lib/commerce";
import { BundleArt } from "@/components/bundle-art";
import { BuyBox, StickyBuy } from "@/components/buy-box";
import { BundleGrid } from "@/components/bundle-card";
import { TrackView } from "@/components/track-view";
import { BoxIcon, ChatIcon, CreditIcon, DownloadIcon, ShieldIcon, Stars, TagIcon, TruckIcon } from "@/components/icons";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const b = bundleById((await params).id);
  return b ? { title: b.name, description: `${b.pieces}-piece wholesale bundle, grade ${b.grade}. ${b.description[0].slice(0, 120)}` } : {};
}

const MARKS = ["#7a1f1f", "#1f4aa8", "#12805c", "#8a5a2b", "#5b2a86"];

function department(b: Bundle) {
  return b.category === "accessories" ? "Accessories" : /women|skirt|bag/i.test(b.name) ? "Womenswear" : "Unisex";
}

export default async function BundlePage({ params }: Params) {
  const { id } = await params;
  const bundle = bundleById(id);
  if (!bundle) notFound();
  const spec = getSpec();
  const pp = spec.productPage;
  const supplier = supplierById(bundle.supplier)!;
  const category = categoryById(bundle.category)!;
  const off = discountPct(bundle);
  const delivery = deliveryWindow(bundle);
  const ship = shippingNote(bundle, spec);
  const more = BUNDLES.filter((b) => b.id !== bundle.id).sort((a, b) => Number(b.supplier === bundle.supplier) - Number(a.supplier === bundle.supplier)).slice(0, 5);
  const agent = spec.agentSurface;
  const buyHigh = pp.ctaPosition === "above-fold" || pp.ctaPosition === "sticky";

  const jsonLd = agent.structuredData
    ? {
        "@context": "https://schema.org",
        "@type": "Product",
        name: bundle.name,
        sku: bundle.id,
        category: category.name,
        description: bundle.description.join(" "),
        brand: { "@type": "Brand", name: supplier.name },
        aggregateRating: { "@type": "AggregateRating", ratingValue: bundle.rating, reviewCount: bundle.reviewCount },
        offers: {
          "@type": "Offer",
          priceCurrency: "GBP",
          price: (bundle.price / 100).toFixed(2),
          availability: bundle.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          ...(agent.exposeStock ? { inventoryLevel: { "@type": "QuantitativeValue", value: bundle.stock } } : {}),
          ...(agent.exposeLandedPrice
            ? { priceSpecification: { "@type": "PriceSpecification", price: (landedPrice(bundle, spec.cart.freeShippingThreshold) / 100).toFixed(2), priceCurrency: "GBP", name: "Landed price incl. shipping and handling" } }
            : {}),
          ...(agent.exposeDeliveryEta
            ? { shippingDetails: { "@type": "OfferShippingDetails", deliveryTime: { "@type": "ShippingDeliveryTime", transitTime: { "@type": "QuantitativeValue", minValue: supplier.dispatchDays[0] + 2, maxValue: supplier.dispatchDays[1] + 3, unitCode: "DAY" } } } }
            : {}),
          ...(agent.exposeReturnPolicy
            ? { hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", merchantReturnDays: 7, returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", description: RETURNS_POLICY } }
            : {}),
        },
      }
    : null;

  const buyBox = <BuyBox bundle={bundle} />;

  return (
    <div className={pp.ctaPosition === "sticky" ? "has-sticky" : undefined}>
      <TrackView event="product_viewed" props={{ product_id: bundle.id, price: bundle.price, category: bundle.category, supplier: bundle.supplier, pieces: bundle.pieces }} />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <div className="pdp-wrap">
        <nav className="crumbs pdp-crumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span className="sep">&gt;</span>
          <Link href={`/bundles?category=${category.id}`}>{category.name}</Link>
          <span className="sep">&gt;</span>
          <span className="here">{bundle.name}</span>
        </nav>

        <div className="pdp">
          <div className="gallery">
            <div className="thumbs">
              {bundle.garments.slice(0, 4).map((g, i) => (
                <div key={i}>
                  <BundleArt garments={[g]} colors={[bundle.colors[i % bundle.colors.length]]} bg="#ffffff" seed={`${bundle.id}-${i}`} single label={`Piece ${i + 1}`} />
                </div>
              ))}
            </div>
            <div className="gallery-main">
              <BundleArt garments={bundle.garments} colors={bundle.colors} bg={bundle.bg} seed={bundle.id} label={`${bundle.name}: ${bundle.pieces}-piece bundle`} />
            </div>
          </div>

          <div className="pdp-info">
            <h1 className="pdp-title product-title" id="product-title" data-darwin="product-title">
              {bundle.name}
            </h1>
            {off > 0 && <span className="pill-sale">{off}% Discount</span>}
            <div className="pdp-price">
              <span className="price" id="product-price">
                {gbp(perPiece(bundle), { decimals: true })}
                <span className="pc">/pc</span> ({gbp(bundle.price, { decimals: true })})
              </span>
              {bundle.was ? <s>{gbp(bundle.was, { decimals: true })}</s> : null}
              {ship && (
                <span className="chip-ship" data-darwin="pdp-shipping">
                  {ship}
                </span>
              )}
            </div>

            <div className="app-box">
              <span className="ic">
                <DownloadIcon style={{ width: 24, height: 24 }} />
              </span>
              <div>
                <strong>Save £15 on your first app order</strong>
                <span>Download now and use code FIRSTRACK.</span>
              </div>
              <Link href="/#closer" className="btn">
                Download the app
              </Link>
            </div>

            {buyHigh && buyBox}

            <dl className="attrs">
              <div>
                <dt>Department</dt>
                <dd>{department(bundle)}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>
                  <Link href={`/bundles?category=${category.id}`}>{category.name}</Link>
                </dd>
              </div>
              <div>
                <dt>Brands</dt>
                <dd>{bundle.brands}</dd>
              </div>
              <div>
                <dt>Grade</dt>
                <dd>{bundle.grade}</dd>
              </div>
              {pp.showSizeGuide && (
                <div data-darwin="size-guide" id="size-guide">
                  <dt>Sizes</dt>
                  <dd>{bundle.sizes}</dd>
                </div>
              )}
            </dl>

            <div className="offer-row">
              <button type="button">
                <TagIcon /> Make an offer
              </button>
              <button type="button">
                <ChatIcon /> Message the seller
              </button>
            </div>

            <div className="pdp-desc product-description" id="product-description">
              <p>The pictures show a representative mix: every bundle is packed to the grade, count and size range listed here.</p>
              <p>
                Grade: {bundle.grade}
                <br />
                Category: {category.name}
                <br />
                Size: {bundle.sizes}
                <br />
                Pieces count: {bundle.pieces}
                <br />
                Weight: {bundle.weightKg} kg
                <br />
                Era: {bundle.era}
              </p>
              {bundle.description.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>

            {pp.ctaPosition === "below-description" && buyBox}

            <div className="seller">
              <div className="seller-top">
                <i style={{ background: MARKS[supplier.name.length % MARKS.length] }}>
                  {supplier.name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")}
                </i>
                <div>
                  <strong>{supplier.name}</strong>
                  {pp.showReviews ? (
                    <span className="q" data-darwin="seller-rating">
                      <Stars rating={supplier.rating} /> {supplier.rating.toFixed(1)} / 5 Quality Score
                    </span>
                  ) : (
                    <span className="q">{supplier.city}</span>
                  )}
                </div>
                <button type="button" className="follow">
                  follow
                </button>
              </div>
              <div className="seller-stats">
                {pp.showDeliveryEstimate && (
                  <div data-darwin="dispatch-time">
                    <strong>
                      {supplier.dispatchDays[0]}–{supplier.dispatchDays[1]} day(s)
                    </strong>
                    <span>Dispatch time</span>
                  </div>
                )}
                {pp.showReviews && (
                  <div>
                    <strong>{supplier.rating.toFixed(1)}/5</strong>
                    <span>Quality score</span>
                  </div>
                )}
                <div>
                  <strong>{supplier.repeatBuyers.toLocaleString("en-GB")}</strong>
                  <span>Repeat buyers</span>
                </div>
              </div>
            </div>

            {(pp.showDeliveryEstimate || pp.showReturnsPolicy) && (
              <div className="accordions">
                {pp.showDeliveryEstimate && (
                  <details className="acc delivery-estimate" id="delivery-estimate" data-darwin="delivery-estimate" open>
                    <summary>
                      <BoxIcon /> Shipping &amp; Customs
                    </summary>
                    <div className="acc-body delivery-line">
                      <TruckIcon style={{ width: 16, height: 16, display: "inline", verticalAlign: "-3px", marginRight: 6 }} />
                      Get it <strong>{delivery.label}</strong>. Dispatched in {delivery.dispatch}, then tracked delivery. Customs handled for UK and EU addresses.
                    </div>
                  </details>
                )}
                {pp.showReturnsPolicy && (
                  <details className="acc returns-policy" id="returns-policy" data-darwin="returns-policy" open>
                    <summary>
                      <ShieldIcon /> Rackd buyer protection
                    </summary>
                    <div className="acc-body">{RETURNS_POLICY}</div>
                  </details>
                )}
                {pp.showReturnsPolicy && (
                  <details className="acc">
                    <summary>
                      <CreditIcon /> Pay later with Rackd Credit
                    </summary>
                    <div className="acc-body">Split orders over £200 into three payments (demo: not available).</div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>

        {pp.showReviews && (
          <section className="reviews" id="reviews" data-darwin="reviews">
            <div className="reviews-head">
              <div>
                <h2>What buyers are saying</h2>
                <p>
                  <Stars rating={bundle.rating} /> {bundle.rating.toFixed(1)} · based on {bundle.reviewCount} verified purchases
                </p>
              </div>
              <a href="#reviews">See all reviews ({bundle.reviewCount})</a>
            </div>
            <div className="review-list">
              {bundle.reviews.slice(0, 3).map((r) => (
                <figure key={r.author + r.date} className="review">
                  <header>
                    <strong>{r.author}</strong>
                    <span>{new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </header>
                  <div className="from">
                    {r.platform} · <Stars rating={r.rating} />
                  </div>
                  <p>{r.text}</p>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className="more">
          <div className="sec-head">
            <h2 style={{ fontSize: 21 }}>More {supplier.name} bundles</h2>
            <Link href="/bundles" className="link-arrow">
              View All →
            </Link>
          </div>
          <BundleGrid bundles={more} list="related" columns={5} variant="list" />
        </section>
      </div>

      {pp.ctaPosition === "sticky" && <StickyBuy bundle={bundle} />}
    </div>
  );
}
