import { ArrowRight } from "lucide-react";
import { getProduct, PRODUCTS } from "@/lib/catalog/products";
import type { PageSpec } from "@/lib/contracts";
import { formatGBP } from "@/lib/money";
import { productImage } from "@/lib/storefront/products";
import { StoreLink } from "./store-provider";
import { Container, Stars, tileBackground } from "./ui";

const hero = getProduct("p_aurora") ?? PRODUCTS[0];
const racer = getProduct("p_velocity") ?? PRODUCTS[0];
const trail = getProduct("p_ridge") ?? PRODUCTS[0];

function Art({ src, alt, className = "", eager = true }: { src: string; alt: string; className?: string; eager?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- static SVG art
  return <img src={src} alt={alt} className={className} loading={eager ? "eager" : "lazy"} draggable={false} />;
}

function Ctas({ spec, dark = false, center = false }: { spec: PageSpec; dark?: boolean; center?: boolean }) {
  return (
    <div className={`mt-8 flex flex-wrap gap-3 ${center ? "justify-center" : ""}`}>
      <StoreLink
        href="/store#collection"
        className={`pace-btn ${dark ? "pace-btn-dark-surface" : "pace-btn-primary"} min-h-[52px] px-7 text-base`}
        data-darwin="hero-cta"
      >
        {spec.hero.ctaText}
        <ArrowRight className="size-4" aria-hidden />
      </StoreLink>
      <StoreLink
        href="/store/products/velocity-carbon"
        className={`pace-btn ${dark ? "pace-btn-ghost-light" : "pace-btn-secondary"} min-h-[52px] px-7 text-base`}
        data-darwin="hero-secondary"
      >
        Shop race day
      </StoreLink>
    </div>
  );
}

function Eyebrow({ dark = false }: { dark?: boolean }) {
  return (
    <p className={`pace-eyebrow ${dark ? "text-white/70" : "text-(--muted)"}`}>
      <span className="mr-2 inline-block size-1.5 -translate-y-px rounded-full bg-[#f97316] align-middle" />
      AW26 collection · Designed in London
    </p>
  );
}

export function Hero({ spec }: { spec: PageSpec }) {
  const { layout, headline, subheadline } = spec.hero;

  if (layout === "fullbleed") {
    return (
      <section className="relative isolate overflow-hidden bg-[#0c0a09] text-white" data-darwin="hero" data-layout="fullbleed">
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "radial-gradient(60% 70% at 78% 40%, rgba(249,115,22,0.45) 0%, rgba(249,115,22,0.08) 45%, transparent 70%), radial-gradient(50% 60% at 10% 100%, rgba(59,130,246,0.18) 0%, transparent 60%)",
          }}
        />
        <svg className="absolute inset-0 -z-10 h-full w-full opacity-[0.22]" viewBox="0 0 1400 700" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <path
              key={i}
              d={`M-100 ${760 - i * 34} C 300 ${520 - i * 40}, 900 ${420 - i * 36}, 1500 ${300 - i * 30}`}
              stroke="#ffffff"
              strokeWidth={i === 3 ? 2 : 1}
              fill="none"
              strokeDasharray={i === 3 ? "10 14" : undefined}
            />
          ))}
        </svg>
        <Art
          src={productImage(hero, "Solar")}
          alt={`${hero.name} in Solar`}
          className="pointer-events-none absolute -right-[20%] top-[-3%] w-[118%] max-w-none rotate-[-10deg] drop-shadow-[0_40px_60px_rgba(0,0,0,0.5)] sm:-right-[8%] sm:top-[-6%] sm:w-[88%] lg:-right-[7%] lg:top-[-8%] lg:w-[62%]"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-[#0c0a09] via-[#0c0a09]/85 to-transparent lg:hidden" />
        <Container className="relative flex min-h-[620px] flex-col justify-end pb-14 pt-72 sm:min-h-[660px] sm:pb-20 lg:min-h-[700px] lg:pt-24">
          <div className="max-w-2xl">
            <Eyebrow dark />
            <h1 className="pace-display mt-5 text-[3.2rem] font-extrabold sm:text-7xl lg:text-[5.6rem]">{headline}</h1>
            {subheadline && <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/75">{subheadline}</p>}
            <Ctas spec={spec} dark />
          </div>
        </Container>
      </section>
    );
  }

  if (layout === "split") {
    return (
      <section className="bg-white" data-darwin="hero" data-layout="split">
        <Container className="grid items-center gap-10 py-10 sm:py-14 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:py-16">
          <div className="order-2 lg:order-1">
            <Eyebrow />
            <h1 className="pace-display mt-5 text-[2.9rem] font-extrabold sm:text-6xl lg:text-[4.6rem]">{headline}</h1>
            {subheadline && <p className="mt-6 max-w-md text-lg leading-relaxed text-(--muted)">{subheadline}</p>}
            <Ctas spec={spec} />
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-(--line) pt-6 text-sm">
              <div>
                <dt className="text-(--muted)">Drop</dt>
                <dd className="mt-1 font-semibold">8 mm</dd>
              </div>
              <div>
                <dt className="text-(--muted)">Weight</dt>
                <dd className="mt-1 font-semibold">265 g</dd>
              </div>
              <div>
                <dt className="text-(--muted)">Trial</dt>
                <dd className="mt-1 font-semibold">60 days</dd>
              </div>
            </dl>
          </div>
          <div className="order-1 lg:order-2">
            <div className="pace-tile relative aspect-[5/4] w-full" style={tileBackground("#f97316")}>
              <div className="absolute inset-x-0 top-6 text-center">
                <span className="pace-display text-[18vw] font-black leading-none text-white/55 lg:text-[9.5rem]" style={{ fontVariationSettings: '"wdth" 125' }} aria-hidden>
                  PACE
                </span>
              </div>
              <Art
                src={productImage(hero, "Solar")}
                alt={`${hero.name} in Solar`}
                className="absolute inset-0 h-full w-full scale-110 object-contain drop-shadow-[0_30px_30px_rgba(124,45,18,0.25)]"
              />
              <StoreLink
                href={`/store/products/${hero.slug}`}
                className="pace-card absolute bottom-4 left-4 flex items-center gap-3 bg-white/90 px-4 py-3 text-sm shadow-lg backdrop-blur transition hover:bg-white sm:bottom-6 sm:left-6"
              >
                <span>
                  <span className="block font-semibold">{hero.name}</span>
                  <span className="flex items-center gap-1.5 text-(--muted)">
                    {formatGBP(hero.price)} · <Stars rating={hero.rating} size={11} />
                  </span>
                </span>
                <ArrowRight className="size-4" aria-hidden />
              </StoreLink>
            </div>
          </div>
        </Container>
      </section>
    );
  }

  // centered
  return (
    <section className="relative overflow-hidden bg-(--surface)" data-darwin="hero" data-layout="centered">
      <Container className="pb-4 pt-14 text-center sm:pt-20">
        <Eyebrow />
        <h1 className="pace-display mx-auto mt-5 max-w-4xl text-[2.9rem] font-extrabold sm:text-6xl lg:text-[5rem]">{headline}</h1>
        {subheadline && <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-(--muted)">{subheadline}</p>}
        <Ctas spec={spec} center />
      </Container>
      <div className="relative mx-auto -mt-2 h-[200px] max-w-[1200px] sm:h-[300px] lg:h-[360px]" aria-hidden>
        <Art src={productImage(racer)} alt="" className="absolute left-[-6%] top-[18%] w-[52%] rotate-[8deg] opacity-95 sm:left-[2%] sm:w-[40%]" />
        <Art src={productImage(trail, "Slate")} alt="" className="absolute right-[-6%] top-[20%] w-[52%] -scale-x-100 rotate-[-8deg] opacity-95 sm:right-[2%] sm:w-[40%]" />
        <Art src={productImage(hero, "Solar")} alt="" className="absolute left-1/2 top-0 w-[70%] -translate-x-1/2 drop-shadow-[0_24px_24px_rgba(0,0,0,0.15)] sm:w-[52%]" />
      </div>
    </section>
  );
}

export function SocialProof() {
  const initials = ["PS", "TH", "ML", "JK", "AB"];
  const hues = ["#f97316", "#1e293b", "#3f6212", "#a3e635", "#1e3a8a"];
  return (
    <section className="border-b border-(--line) bg-white" data-darwin="social-proof">
      <Container className="flex flex-col items-center justify-center gap-x-10 gap-y-4 py-6 text-sm sm:flex-row sm:flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {initials.map((i, n) => (
              <span
                key={i}
                className="flex size-8 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white"
                style={{ background: hues[n], color: n === 3 ? "#1a2e05" : "#fff" }}
              >
                {i}
              </span>
            ))}
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <Stars rating={4.8} />
              <span className="font-semibold">4.8/5</span>
            </div>
            <span className="text-(--muted)">from 12,400+ runners</span>
          </div>
        </div>
        <span className="hidden h-8 w-px bg-(--line) sm:block" />
        <p className="text-center text-(--muted)">
          Worn by <span className="font-semibold text-(--ink)">140+ London run clubs</span> — from Hackney Harriers to the South Bank Striders
        </p>
        <span className="hidden h-8 w-px bg-(--line) lg:block" />
        <p className="font-medium">60-day run-in-them trial</p>
      </Container>
    </section>
  );
}
