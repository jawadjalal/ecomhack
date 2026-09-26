import Link from "next/link";
import { getSpec } from "@/lib/config";
import { BUNDLES, CATEGORIES, SUPPLIERS, sortBundles, type Garment } from "@/lib/catalog";
import { Hero } from "@/components/hero";
import { BundleGrid } from "@/components/bundle-card";
import { BundleArt } from "@/components/bundle-art";
import { Placeholder, type Tone } from "@/components/placeholder";
import { PhoneIcon, Stars } from "@/components/icons";

/** Style tiles ("popular brands" row): generic label groups, drawn, not photographed. */
const STYLES: { name: string; garment: Garment; colors: string[]; q: string }[] = [
  { name: "Heritage polos", garment: "tee", colors: ["#1d2d5a"], q: "rugby" },
  { name: "Sport crews", garment: "knit", colors: ["#7d93ad"], q: "sweatshirts" },
  { name: "US workwear", garment: "jacket", colors: ["#5b6b3a"], q: "workwear" },
  { name: "Athleisure", garment: "shorts", colors: ["#3a2a22"], q: "denim" },
  { name: "Designer denim", garment: "jeans", colors: ["#3b5a85"], q: "jeans" },
  { name: "Y2K flares", garment: "jeans", colors: ["#6d8fb8"], q: "y2k" },
];

const FEATURED: { kicker: string; title: string; cta: string; href: string; tone: Tone; tag?: string }[] = [
  { kicker: "This week's biggest drop", title: "Up to 50% off", cta: "Shop sale", href: "/bundles?sort=price-asc", tone: "dark" },
  { kicker: "AW26 trend notes", title: "What resells this autumn", cta: "Read notes", href: "/bundles?category=knitwear", tone: "denim", tag: "New report" },
  { kicker: "New collection", title: "Knitwear is back", cta: "Shop trending", href: "/bundles?category=knitwear", tone: "warm" },
];

const SUPPLIER_TONES: Tone[] = ["denim", "dark", "rose", "warm", "olive"];

const QUOTES = [
  { name: "Rhea D.", role: "Full-time reseller · eBay & Vinted", text: "I used to spend every weekend at car boots. Now I order two bundles on a Monday and list all week. The margins finally work.", mark: ["#0d2bff", "#fff"] },
  { name: "Callum P.", role: "Vintage reseller · Vinted", text: "The grading is honest. When a bundle says A/B I know exactly what I'm getting, and it arrives when they say it will.", mark: ["#e8e8e8", "#0f0f0f"] },
  { name: "Maja S.", role: "Full-time reseller · Depop", text: "Knitwear bundles sell out every autumn. Being able to reorder the same supplier's stock is what grew my shop.", mark: ["#0f0f0f", "#fff"] },
];

export default function Home() {
  const spec = getSpec();
  const drop = sortBundles(BUNDLES, spec.productGrid.sort).slice(0, 10);
  const social = spec.hero.showSocialProof;
  return (
    <div className="home">
      <Hero spec={spec} />

      {social && (
        <section className="seen" id="as-seen-in" data-darwin="as-seen-in">
          <div className="seen-label">As seen in</div>
          <div className="seen-row" aria-label="Press mentions (fictional)">
            <span className="serif">THE RESALE REVIEW</span>
            <span className="caps">SOURCING WEEKLY</span>
            <span className="serif">Circular Times</span>
            <span className="caps">THRIFT TECH</span>
            <span className="serif">Second Hand Journal</span>
            <span className="caps">VINTAGE TRADE</span>
          </div>
        </section>
      )}

      <section className="featured wrap" id="featured">
        <div className="sec-head">
          <h2>Featured</h2>
          <div className="arrows" aria-hidden>
            <button type="button">‹</button>
            <button type="button">›</button>
          </div>
        </div>
        <div className="feat-track">
          {FEATURED.map((f) => (
            <Link key={f.title} href={f.href} className="feat-card">
              <Placeholder tone={f.tone} label={f.title} />
              {f.tag && <span className="feat-tag">{f.tag}</span>}
              <div className="feat-body">
                <div>
                  <div className="feat-kicker">{f.kicker}</div>
                  <div className="feat-title">{f.title}</div>
                </div>
                <span className="feat-btn">{f.cta}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="tiles-block wrap" id="popular-styles">
        <div className="sec-head">
          <h2>Popular brands</h2>
        </div>
        <div className="tiles">
          {STYLES.map((s) => (
            <Link key={s.name} href={`/bundles?q=${encodeURIComponent(s.q)}`} className="tile">
              <div className="art">
                <BundleArt garments={[s.garment]} colors={s.colors} bg="#e3e3e3" seed={s.name} single label={s.name} />
              </div>
              <strong>{s.name}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="tiles-block wrap" id="categories">
        <div className="sec-head">
          <h2>Shop by category</h2>
        </div>
        <div className="tiles">
          {CATEGORIES.map((c) => (
            <Link key={c.id} href={`/bundles?category=${c.id}`} className="tile" data-darwin={`category-${c.id}`}>
              <div className="art">
                <BundleArt garments={[c.garment]} colors={c.colors} bg="#e3e3e3" seed={c.id} single label={c.name} />
              </div>
              <strong>{c.name}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="band" id="built-for-resellers">
        <div className="wrap band-inner">
          <div>
            <h2>
              <span className="y">
                Built for
                <br />
                resellers at
              </span>
              <br />
              <u>every stage</u>
            </h2>
            <p>From your first test bundle to a full-time shop, Rackd has the supply, the grading and the tools to keep your rails full.</p>
            <Link href="/bundles" className="btn btn-yellow">
              Browse bundles
            </Link>
          </div>
          <div className="band-cards">
            <div className="band-card">
              <strong>Bundles for every niche</strong>
              <span>Denim, knitwear, sportswear, tees and accessories, sorted by era and style.</span>
            </div>
            <div className="band-card">
              <strong>Know your cost per piece</strong>
              <span>Every listing shows the price per piece, so you can price for profit.</span>
            </div>
            <div className="band-card">
              <strong>Graded before dispatch</strong>
              <span>Grades A, A/B and B are defined on every bundle page.</span>
            </div>
            <div className="band-card">
              <strong>Reorder what sells</strong>
              <span>Follow a supplier and restock the styles that fly.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-white" id="the-drop">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2>The Rackd Drop</h2>
              <p>Up to 50% off across hundreds of bundles</p>
            </div>
            <Link href="/bundles" className="link-arrow">
              View all →
            </Link>
          </div>
          <BundleGrid bundles={drop} list="home_drop" columns={5} />
        </div>
      </section>

      <section className="section section-cream" id="suppliers">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="eyebrow">Verified suppliers</div>
              <h2>Top rated suppliers</h2>
            </div>
            <Link href="/bundles" className="link-arrow">
              View all suppliers →
            </Link>
          </div>
          <div className="suppliers">
            {SUPPLIERS.map((s, i) => (
              <div key={s.id} className="supplier">
                <Placeholder tone={SUPPLIER_TONES[i % SUPPLIER_TONES.length]} label={`${s.name} warehouse`} />
                <div className="supplier-body">
                  <strong>{s.name}</strong>
                  {spec.productGrid.showRatings && (
                    <div className="rating" data-darwin="supplier-rating">
                      <Stars rating={s.rating} /> {s.rating.toFixed(1)}
                    </div>
                  )}
                  <div className="meta">
                    {s.city.split(", ")[1]} · {s.repeatBuyers.toLocaleString("en-GB")} Repeat Buyers
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="split" id="join">
        <div className="wrap split-inner">
          <div>
            <div className="eyebrow">The sourcing platform for modern resellers</div>
            <h2>
              Join Rackd. The wholesale marketplace <u>made for resellers</u>
            </h2>
            <p>Skip the early mornings at car boot sales. Rackd connects you with vetted vintage suppliers, and every bundle is listed with its piece count, grade and price per piece.</p>
            <ul className="checks">
              <li>
                <i>✓</i> New bundles listed every day
              </li>
              <li>
                <i>✓</i> Bigger bundles, lower price per piece
              </li>
              <li>
                <i>✓</i> Tracked delivery across the UK and EU
              </li>
            </ul>
            <Link href="/account?mode=signup" className="btn btn-ink">
              Open an account
            </Link>
          </div>
        </div>
        <Placeholder tone="gray" label="A reseller holding a vacuum-packed bundle" className="split-photo" />
      </section>

      <section className="section section-cream" id="how-it-works">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="eyebrow">Join Rackd today</div>
              <h2>Start reselling in 3 steps</h2>
            </div>
          </div>
          <div className="steps">
            <div className="step">
              <b>1.</b>
              <strong>Open an account</strong>
              <span>Tell us where you sell and what you like to stock.</span>
            </div>
            <div className="step">
              <b>2.</b>
              <strong>Choose a bundle</strong>
              <span>Browse by category (denim, tees, knitwear) and place your order.</span>
            </div>
            <div className="step">
              <b>3.</b>
              <strong>List for resale</strong>
              <span>Photograph your pieces, list them in your shop and start selling.</span>
            </div>
          </div>
        </div>
      </section>

      {social && (
        <section className="section section-white" id="testimonials" data-darwin="testimonials">
          <div className="wrap">
            <div className="sec-head">
              <div>
                <div className="eyebrow">Real resellers. Real results.</div>
                <h2>What our community says</h2>
              </div>
            </div>
            <div className="quotes">
              {QUOTES.map((q) => (
                <figure key={q.name} className="quote">
                  <div className="qs">★★★★★</div>
                  <p>{q.text}</p>
                  <footer>
                    <i style={{ background: q.mark[0], color: q.mark[1] }}>{q.name[0]}</i>
                    <div>
                      <strong>{q.name}</strong>
                      <span>{q.role}</span>
                    </div>
                  </footer>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="closer" id="closer">
        <div className="wrap">
          <h2>
            Your next bundle is
            <br />
            <u>one order away</u>
          </h2>
          <div className="stores">
            <Link href="/bundles" className="store-btn">
              <PhoneIcon />
              <span>
                <small>Download on the</small>
                <strong>iPhone app</strong>
              </span>
            </Link>
            <Link href="/bundles" className="store-btn">
              <PhoneIcon />
              <span>
                <small>Download on</small>
                <strong>Android</strong>
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
