import Link from "next/link";
import type { PageSpec } from "@/lib/spec";

/** Decorative QR-style block (not a real code: the demo has no app). */
function QrArt() {
  const cells: [number, number][] = [];
  let h = 2166136261;
  for (let y = 0; y < 25; y++)
    for (let x = 0; x < 25; x++) {
      h = Math.imul(h ^ (x * 31 + y * 17), 16777619) >>> 0;
      const finder = (x < 7 && y < 7) || (x > 17 && y < 7) || (x < 7 && y > 17);
      if (!finder && h % 100 < 46) cells.push([x, y]);
    }
  const Finder = ({ x, y }: { x: number; y: number }) => (
    <g>
      <rect x={x} y={y} width={7} height={7} fill="#000" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#000" />
    </g>
  );
  return (
    <svg viewBox="0 0 25 25" shapeRendering="crispEdges" aria-hidden>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000" />
      ))}
      <Finder x={0} y={0} />
      <Finder x={18} y={0} />
      <Finder x={0} y={18} />
    </svg>
  );
}

/** "Vintage stock, by the bundle" → the part after the comma is highlighted, like the reference hero. */
function Headline({ text }: { text: string }) {
  const i = text.indexOf(",");
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i + 1)} <em>{text.slice(i + 1).trim()}</em>
    </>
  );
}

export function Hero({ spec }: { spec: PageSpec }) {
  const { hero } = spec;
  return (
    <section className={`hero hero--${hero.layout}`} id="hero" data-darwin="hero">
      <div className="hero-photo" aria-hidden />
      <div className="hero-fade" aria-hidden />
      <div className="hero-inner">
        <div className="hero-copy">
          <h1 className="hero-title" id="hero-title" data-darwin="hero-title">
            <Headline text={hero.headline} />
          </h1>
          <p className="hero-sub" id="hero-subtitle" data-darwin="hero-subtitle">
            {hero.subheadline}
          </p>
          <div className="hero-cta-row">
            <Link href="/bundles?sort=bestselling" className="btn btn-yellow hero-cta cta" id="hero-cta" data-darwin="hero-cta">
              {hero.ctaText}
            </Link>
          </div>
          <div className="hero-qr">
            <div>
              <div className="qr">
                <QrArt />
              </div>
              <div className="qr-cap">Scan this code to get the app</div>
            </div>
          </div>
          {hero.showSocialProof && (
            <div className="hero-proof social-proof" id="social-proof" data-darwin="social-proof">
              <span className="platform-dots" aria-label="Resellers sell on Vinted, eBay, Depop and Whatnot">
                <i style={{ background: "#0f6e6e", color: "#fff" }}>V</i>
                <i style={{ background: "#fff", color: "#e53238" }}>e</i>
                <i style={{ background: "#e0282e", color: "#fff" }}>d</i>
                <i style={{ background: "#1a1a1a", color: "#f8e71c" }}>w</i>
              </span>
              <span>
                21,000+ <span className="n">resellers stock up on Rackd</span>
              </span>
            </div>
          )}
        </div>
        <div className="hero-poster" aria-hidden>
          <div className="poster-flag">
            <b>RACKD</b>DROP
          </div>
          <div className="poster-off">
            UP TO <em>50%</em> OFF
          </div>
        </div>
      </div>
    </section>
  );
}
