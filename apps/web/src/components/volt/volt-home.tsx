import Image from "next/image";
import localFont from "next/font/local";
import { ArrowDown, ArrowRight, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import "./volt.css";

const satoshi = localFont({
  src: [
    { path: "../../app/store/fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../app/store/fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../app/store/fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-volt-satoshi",
  display: "swap",
});

const categories = [
  { name: "Phones", href: "#phones", image: "/volt/phones-hero.jpg", className: "phones" },
  { name: "Laptops", href: "#laptops", image: "/volt/laptop-feature.jpg", className: "laptops" },
  { name: "Audio", href: "#audio", image: "/volt/audio-feature.jpg", className: "audio" },
];

export function VoltHome() {
  return (
    <div className={`volt-page ${satoshi.variable}`}>
      <a className="volt-skip" href="#main">Skip to content</a>
      <header className="volt-header">
        <nav className="volt-nav" aria-label="Main navigation">
          <a className="volt-logo" href="#top" aria-label="Volt home">volt<span>.</span></a>
          <div className="volt-nav-links">
            <a href="#phones">Phones</a>
            <a href="#laptops">Laptops</a>
            <a href="#audio">Audio</a>
            <a href="#why-volt">Why Volt</a>
          </div>
          <a className="volt-nav-cta" href="#explore">Explore devices <ArrowRight size={14} strokeWidth={1.8} /></a>
          <details className="volt-mobile-nav">
            <summary aria-label="Open navigation"><span /><span /><span /></summary>
            <div className="volt-mobile-menu">
              <a href="#phones">Phones</a>
              <a href="#laptops">Laptops</a>
              <a href="#audio">Audio</a>
              <a href="#why-volt">Why Volt</a>
            </div>
          </details>
        </nav>
      </header>

      <main id="main">
        <div className="volt-promo">Brilliant tech deserves a second life. <a href="#why-volt">Meet the better way to buy <ArrowRight size={13} /></a></div>

        <section className="volt-hero" id="top" aria-labelledby="volt-hero-title">
          <Image src="/volt/phones-hero.jpg" alt="Two premium smartphones in a dramatic dark studio setting" fill priority sizes="100vw" className="volt-hero-image" />
          <div className="volt-hero-shade" />
          <div className="volt-hero-content">
            <p className="volt-eyebrow volt-light">REFURBISHED. REIMAGINED.</p>
            <h1 id="volt-hero-title">Tech you love.<br /><em>Again.</em></h1>
            <p className="volt-hero-subtitle">The devices you want, thoughtfully renewed for what&apos;s next.</p>
            <div className="volt-actions">
              <a className="volt-button volt-button-light" href="#explore">Explore devices <ArrowRight size={18} /></a>
              <a className="volt-text-link volt-text-link-light" href="#why-volt">Why choose renewed? <ArrowRight size={16} /></a>
            </div>
          </div>
          <a className="volt-scroll" href="#explore" aria-label="Scroll to explore devices"><ArrowDown size={17} /></a>
        </section>

        <section className="volt-intro" id="explore" aria-labelledby="volt-explore-title">
          <p className="volt-eyebrow">A SMARTER KIND OF UPGRADE</p>
          <h2 id="volt-explore-title">The good stuff.<br /><span>One more time.</span></h2>
          <p>Great technology shouldn&apos;t be a one-time story. Find your next favorite device and give exceptional engineering another chapter.</p>
          <div className="volt-category-grid">
            {categories.map((category) => (
              <a key={category.name} href={category.href} className={`volt-category volt-category-${category.className}`}>
                <Image src={category.image} alt="" fill sizes="(max-width: 700px) 100vw, 33vw" />
                <span>{category.name}<ArrowRight size={19} /></span>
              </a>
            ))}
          </div>
        </section>

        <section className="volt-feature volt-feature-phone" id="phones" aria-labelledby="volt-phone-title">
          <Image src="/volt/phones-hero.jpg" alt="Silver and midnight smartphones with illuminated displays" fill sizes="100vw" />
          <div className="volt-feature-shade" />
          <div className="volt-feature-copy">
            <p className="volt-eyebrow volt-light">RENEWED PHONES</p>
            <h2 id="volt-phone-title">Your next favorite<br />is already out there.</h2>
            <p>All the details you love, ready to make new memories.</p>
            <a className="volt-button volt-button-light" href="#why-volt">The Volt difference <ArrowRight size={18} /></a>
          </div>
        </section>

        <section className="volt-feature volt-feature-laptop" id="laptops" aria-labelledby="volt-laptop-title">
          <Image src="/volt/laptop-feature.jpg" alt="Slim silver laptop on a softly lit studio surface" fill sizes="100vw" />
          <div className="volt-feature-copy">
            <p className="volt-eyebrow">RENEWED LAPTOPS</p>
            <h2 id="volt-laptop-title">Big ideas.<br />Smaller footprint.</h2>
            <p>Power for whatever&apos;s next, with a story worth continuing.</p>
            <a className="volt-button volt-button-dark" href="#why-volt">See how Volt works <ArrowRight size={18} /></a>
          </div>
        </section>

        <section className="volt-feature volt-feature-audio" id="audio" aria-labelledby="volt-audio-title">
          <Image src="/volt/audio-feature.jpg" alt="Graphite over-ear headphones against a dark blue backdrop" fill sizes="100vw" />
          <div className="volt-feature-shade" />
          <div className="volt-feature-copy">
            <p className="volt-eyebrow volt-light">RENEWED AUDIO</p>
            <h2 id="volt-audio-title">Sound worth<br />rediscovering.</h2>
            <p>Press play on more possibilities.</p>
            <a className="volt-button volt-button-light" href="#why-volt">Why renewed? <ArrowRight size={18} /></a>
          </div>
        </section>

        <section className="volt-why" id="why-volt" aria-labelledby="volt-why-title">
          <p className="volt-eyebrow">WHY VOLT</p>
          <h2 id="volt-why-title">Second life.<br /><span>First choice.</span></h2>
          <p className="volt-why-lead">A more considered way to get the tech you&apos;ve been looking for.</p>
          <div className="volt-benefits">
            <article><span className="volt-benefit-icon"><ShieldCheck size={27} strokeWidth={1.5} /></span><h3>Checked with care.</h3><p>Thoughtfully assessed, cleaned and prepared for its next chapter.</p></article>
            <article><span className="volt-benefit-icon"><Sparkles size={27} strokeWidth={1.5} /></span><h3>Made to feel good.</h3><p>Premium technology with all the excitement of something new.</p></article>
            <article><span className="volt-benefit-icon"><RefreshCw size={27} strokeWidth={1.5} /></span><h3>More life in every device.</h3><p>Choose to keep great tech in use for longer.</p></article>
          </div>
        </section>

        <section className="volt-ending" aria-labelledby="volt-ending-title">
          <div className="volt-ending-glow" />
          <p className="volt-eyebrow volt-light">READY WHEN YOU ARE</p>
          <h2 id="volt-ending-title">The future looks<br />good on you.</h2>
          <a className="volt-button volt-button-light" href="#explore">Explore devices <ArrowRight size={18} /></a>
        </section>
      </main>

      <footer className="volt-footer">
        <div><a className="volt-logo" href="#top">volt<span>.</span></a><p>Good tech. Another great story.</p></div>
        <nav aria-label="Footer navigation"><a href="#phones">Phones</a><a href="#laptops">Laptops</a><a href="#audio">Audio</a><a href="#why-volt">Why Volt</a></nav>
        <div className="volt-footer-bottom"><span>© 2026 Volt</span><span>Thoughtfully renewed technology.</span></div>
      </footer>
    </div>
  );
}
