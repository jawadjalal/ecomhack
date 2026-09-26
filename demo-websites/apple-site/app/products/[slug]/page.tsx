import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSpec } from "@/lib/spec";
import { getProduct, PRODUCTS, REVIEW_SNIPPETS } from "@/lib/catalog";
import { productJsonLd } from "@/lib/agent-view";
import { gbp } from "@/lib/format";
import { BuyFlow } from "@/components/buy-flow";
import { DeviceArt } from "@/components/device-art";
import { Stars } from "@/components/stars";
import { TrackOnMount } from "@/components/track-on-mount";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = getProduct(slug);
  return p ? { title: `Buy ${p.name}`, description: `${p.name}. ${p.tagline} From ${gbp(p.price, { whole: true })}.` } : {};
}

const COMPARE = ["orchard-phone-17-pro", "orchard-phone-17", "orchard-book-air", "orchard-pad-air", "orchard-watch-11", "orchard-buds-pro"];

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const p = getProduct(slug);
  if (!p) notFound();
  const { spec } = await getSpec();
  const pp = spec.productPage;
  const family = COMPARE.map((s) => getProduct(s)!).filter((x) => x.kind === p.kind && x.slug !== p.slug);
  const compare = [p, ...family, ...COMPARE.map((s) => getProduct(s)!).filter((x) => x.kind !== p.kind)].slice(0, 3);

  return (
    <article className="buy-page" data-darwin="product-page" data-product={p.slug} data-cta-position={pp.ctaPosition}>
      <TrackOnMount event="product_viewed" props={{ product_id: p.slug, name: p.name, price: p.price, cta_position: pp.ctaPosition }} />
      {spec.agentSurface.structuredData && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(p, spec)).replace(/</g, "\\u003c") }} />
      )}
      <BuyFlow slug={p.slug} pp={pp} freeShippingThreshold={spec.cart.freeShippingThreshold}>
        <div id="overview" data-darwin="product-description">
          {!p.accessory && (
            <section className="witb">
              <h2>What&apos;s in the Box</h2>
              <div className="witb-stage">
                <DeviceArt kind={p.kind} colour={p.colours[0].hex} pro={p.slug.endsWith("-pro")} label={p.name} />
                <DeviceArt kind="cable" colour="#f4f4f4" label="USB-C cable" />
              </div>
              <div className="witb-labels">
                <span>{p.name}</span>
                <span>USB-C Charge Cable</span>
              </div>
            </section>
          )}

          <section className="setup">
            <h2>{p.tagline}</h2>
            {p.features.map((f) => (
              <p key={f.title}>
                <strong>{f.title}</strong> {f.body}
              </p>
            ))}
          </section>

          <section className="compare" data-darwin="compare">
            <h2>Which Orchard is right for you?</h2>
            <div className="compare-grid">
              {compare.map((c) => (
                <div key={c.slug} className="compare-col">
                  <DeviceArt kind={c.kind} colour={c.colours[0].hex} pro={c.slug.endsWith("-pro")} label={c.name} />
                  {c.isNew && <p className="buy-eyebrow">New</p>}
                  <h3>{c.name}</h3>
                  <p>{c.tagline}</p>
                  <p>From {gbp(c.price, { whole: true })}</p>
                  <dl>
                    {c.specs.slice(0, 4).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </section>

          {pp.showReviews && (
            <section className="reviews" id="reviews" data-darwin="reviews">
              <h2>Customer reviews.</h2>
              <div className="reviews-summary">
                <span className="reviews-score">{p.rating.toFixed(1)}</span>
                <Stars rating={p.rating} count={p.reviews} />
              </div>
              <ul className="review-list">
                {REVIEW_SNIPPETS.map((r) => (
                  <li key={r.author}>
                    <Stars rating={r.rating} small />
                    <h3>{r.title}</h3>
                    <p>{r.body}</p>
                    <span>{r.author}</span>
                  </li>
                ))}
              </ul>
              <p className="fine">Orchard is fictional: these reviews are sample copy.</p>
            </section>
          )}

          <section className="env">
            <strong>Our environmental goals.</strong>
            {p.name} ships without a power adapter to cut packaging and waste. Any USB-C power adapter works.
          </section>
        </div>
      </BuyFlow>
    </article>
  );
}
