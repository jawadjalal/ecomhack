import Link from "next/link";
import { getSpec } from "@/lib/spec";
import { getProduct } from "@/lib/catalog";
import { DeviceArt } from "@/components/device-art";
import { Stars } from "@/components/stars";

const FLAGSHIP = "orchard-phone-17-pro";
const buyish = (text: string) => /\b(buy|shop|order|get|bag|add)\b/i.test(text);

/** A home tile: headline, subhead, two pill buttons, product image below. */
function Tile({
  title,
  sub,
  callout,
  href,
  dark,
  image,
  bottom,
  darwin,
  primary = "Learn more",
  secondary = "Buy",
}: {
  title: string;
  sub: string;
  callout?: string;
  href: string;
  dark?: boolean;
  image: React.ReactNode;
  bottom?: boolean;
  darwin: string;
  primary?: string;
  secondary?: string | null;
}) {
  return (
    <section className={`tile ${dark ? "dark" : ""} ${bottom ? "tile-bottom" : ""}`} data-darwin={darwin}>
      <div className="tile-content">
        <h3 className="tile-headline">{title}</h3>
        <p className="tile-subhead">{sub}</p>
        {callout && <p className="tile-callout">{callout}</p>}
        <div className="tile-ctas">
          <Link href={href} className="button button-reduced">
            {primary}
          </Link>
          {secondary && (
            <Link href={`${href}#buy`} className="button button-reduced button-secondary">
              {secondary}
            </Link>
          )}
        </div>
      </div>
      <div className="tile-image">{image}</div>
    </section>
  );
}

export default async function Home() {
  const { spec } = await getSpec();
  const hero = spec.hero;
  const flagship = getProduct(FLAGSHIP)!;
  const primaryBuys = buyish(hero.ctaText);
  return (
    <div className="homepage">
      {/* Hero: every hero.* knob renders here */}
      <section className={`tile tile-hero dark layout-${hero.layout}`} data-darwin="hero" id="hero">
        <div className="tile-content">
          <h2 className="tile-headline" data-darwin="hero-title">
            {hero.headline}
          </h2>
          {hero.subheadline && (
            <p className="tile-subhead" data-darwin="hero-subtitle">
              {hero.subheadline}
            </p>
          )}
          <div className="tile-ctas">
            <Link href={`/products/${FLAGSHIP}${primaryBuys ? "#buy" : "#overview"}`} className="button" data-darwin="hero-cta">
              {hero.ctaText}
            </Link>
            <Link href={`/products/${FLAGSHIP}${primaryBuys ? "#overview" : "#buy"}`} className="button button-secondary" data-darwin="hero-cta-secondary">
              {primaryBuys ? "Learn more" : "Buy"}
            </Link>
          </div>
          {hero.showSocialProof && (
            <p className="social-proof" data-darwin="social-proof">
              <Stars rating={flagship.rating} count={flagship.reviews} /> Rated {flagship.rating} by Orchard owners
            </p>
          )}
        </div>
        <div className="tile-image">
          <DeviceArt kind="phone" colour={flagship.colours[0].hex} pro label="Orchard Phone 17 Pro in Ember" />
        </div>
      </section>

      <section className="tile tile-wide" data-darwin="tile-book">
        <div className="tile-content">
          <h2 className="tile-headline">Orchard Book Air</h2>
          <p className="tile-subhead">Featherweight. Heavyweight speed.</p>
          <div className="tile-ctas">
            <Link href="/products/orchard-book-air" className="button">
              Learn more
            </Link>
            <Link href="/products/orchard-book-air#buy" className="button button-secondary">
              Buy
            </Link>
          </div>
        </div>
        <div className="tile-image">
          <DeviceArt kind="laptop" colour="#b7cbe0" label="Orchard Book Air in Sky" />
        </div>
      </section>

      <section className="tile tile-wide" data-darwin="tile-pad">
        <div className="tile-content">
          <h2 className="tile-headline">Orchard Pad Air</h2>
          <p className="tile-subhead">Big screen. Small bag.</p>
          <div className="tile-ctas">
            <Link href="/products/orchard-pad-air" className="button">
              Learn more
            </Link>
            <Link href="/products/orchard-pad-air#buy" className="button button-secondary">
              Buy
            </Link>
          </div>
        </div>
        <div className="tile-image">
          <DeviceArt kind="tablet" colour="#a6bbd3" label="Orchard Pad Air in Blue" />
        </div>
      </section>

      <div className="promo-grid">
        <Tile
          title="Orchard Phone 17"
          sub="Bright colours. Brilliant everything."
          callout="Available in four finishes"
          href="/products/orchard-phone-17"
          darwin="tile-phone"
          image={<DeviceArt kind="phone" colour="#a9bf9c" label="Orchard Phone 17 in Sage" />}
        />
        <Tile
          title="Watch Series 11"
          sub="Your health, right on your wrist."
          href="/products/orchard-watch-11"
          dark
          bottom
          darwin="tile-watch"
          image={<DeviceArt kind="watch" colour="#e3bcb6" label="Orchard Watch Series 11 in Rose" />}
        />
        <Tile
          title="Orchard Watch Series 11"
          sub="Now in Jet."
          href="/products/orchard-watch-11"
          dark
          darwin="tile-watch-jet"
          image={<DeviceArt kind="watch" colour="#3a3b3f" label="Orchard Watch Series 11 in Jet" />}
        />
        <section className="tile dark tile-bottom" data-darwin="tile-buds">
          <div className="photo warm" aria-hidden="true" />
          <div className="tile-content">
            <h3 className="tile-headline">Buds Pro 3</h3>
            <p className="tile-subhead">Quiet the world. Hear the music.</p>
            <div className="tile-ctas">
              <Link href="/products/orchard-buds-pro" className="button button-reduced">
                Learn more
              </Link>
              <Link href="/products/orchard-buds-pro#buy" className="button button-reduced button-secondary">
                Buy
              </Link>
            </div>
          </div>
        </section>
        <section className="tile" data-darwin="tile-education">
          <div className="photo people" aria-hidden="true" />
          <div className="tile-content">
            <h3 className="tile-headline">Back to study.</h3>
            <p className="tile-subhead">Save on Book and Pad with education pricing.</p>
            <div className="tile-ctas">
              <Link href="/store" className="button button-reduced">
                Shop
              </Link>
            </div>
          </div>
        </section>
        <section className="tile" data-darwin="tile-trade-in">
          <div className="photo soft" aria-hidden="true" />
          <div className="tile-content">
            <h3 className="tile-headline">Orchard Trade In</h3>
            <p className="tile-subhead">Swap your old phone for credit towards a new one.</p>
            <div className="tile-ctas">
              <Link href="/store" className="button button-reduced">
                Get your estimate
              </Link>
            </div>
          </div>
          <div className="tile-image">
            <DeviceArt kind="phone" colour="#d6d6d3" pro label="" />
          </div>
        </section>
      </div>

      <section className="gallery" aria-label="Orchard TV+" data-darwin="tv-gallery">
        <div className="gallery-track">
          {[
            ["Drama", "A quiet village. A loud secret."],
            ["Comedy", "The office party that never ended."],
            ["Sci-Fi", "Home is a long way from here."],
          ].map(([genre, line]) => (
            <div key={genre} className="gallery-slide">
              <div className="gallery-caption">
                <span className="button button-reduced">Stream now</span>
                <p>
                  <b>{genre}</b>
                  {line}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="gallery-dots" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>
    </div>
  );
}
