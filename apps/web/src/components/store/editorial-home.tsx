import { Lock, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { getProduct } from "@/lib/catalog/products";
import type { PageSpec } from "@/lib/contracts";
import type { WhopShowcase } from "@/lib/whop";
import { ProductGrid } from "./product-grid";
import { SocialProof } from "./hero";
import { StoreLink } from "./store-provider";
import { ProductArt } from "./ui";

const BANDS = [
  {
    key: "road",
    label: "Road",
    line: "Elevated everyday miles.",
    id: "p_aurora",
    color: "Midnight",
  },
  {
    key: "trail",
    label: "Trail",
    line: "Grip that doesn't flinch.",
    id: "p_ridge",
    color: "Slate",
  },
  {
    key: "racing",
    label: "Racing",
    line: "Light, fast, race legal.",
    id: "p_velocity",
    color: "Volt",
  },
] as const;

const TRUST = [
  { icon: Truck, title: "Fast delivery", body: "UK in 2–4 days" },
  { icon: RotateCcw, title: "Easy returns", body: "Within 60 days" },
  { icon: ShieldCheck, title: "Quality assured", body: "Designed in London" },
  { icon: Lock, title: "Secure payment", body: "Demo checkout" },
];

function wordmarkSize(brand: string) {
  const letters = Math.max(brand.trim().length, 4);
  const vw = Math.max(7, Math.min(22, Math.round(92 / letters)));
  return `clamp(3.4rem, ${vw}vw, 16.5rem)`;
}

export function EditorialHome({
  spec,
  brand,
  category,
  showcase,
}: {
  spec: PageSpec;
  brand: string;
  category?: string;
  showcase: WhopShowcase | null;
}) {
  const heroProduct = getProduct("p_aurora");
  const seasonProduct = getProduct("p_city");
  const { headline, subheadline, ctaText } = spec.hero;

  return (
    <>
      <section className="relative overflow-hidden bg-[#f6f4f1]" data-darwin="hero" data-layout={spec.hero.layout}>
        <div className="relative mx-auto min-h-[620px] max-w-[1440px] px-4 pb-10 pt-8 sm:min-h-[700px] sm:px-6 sm:pt-10 lg:px-10 lg:pb-14">
          <p className="relative z-20 max-w-[10.5rem] text-[11px] font-medium uppercase leading-[1.45] tracking-[0.18em] sm:text-[12px]">
            {headline}
            <span className="mt-3 block h-px w-8 bg-black" />
          </p>

          <div className="pointer-events-none absolute inset-x-0 top-[16%] z-0 flex items-center justify-center px-2 sm:top-[14%]" aria-hidden>
            <span className="pace-wordmark block w-full text-center uppercase text-black" style={{ fontSize: wordmarkSize(brand) }}>
              {brand}
            </span>
          </div>

          {heroProduct && (
            <ProductArt
              product={heroProduct}
              color="Solar"
              priority
              className="relative z-10 mx-auto mt-2 aspect-[5/3] w-[min(560px,86%)] bg-transparent sm:mt-6"
              imgClassName="scale-110 object-contain drop-shadow-[0_28px_40px_rgba(0,0,0,0.18)]"
              style={{ backgroundImage: "none", background: "transparent" }}
            />
          )}

          <div className="relative z-20 mt-6 flex flex-col gap-8 sm:mt-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-3">
              <StoreLink
                href="/store#collection"
                className="pace-focus inline-flex h-11 items-center bg-black px-6 text-[12px] font-medium uppercase tracking-[0.16em] text-white"
                data-darwin="hero-cta"
              >
                {ctaText}
              </StoreLink>
              <StoreLink
                href="/store/products/velocity-carbon"
                className="pace-focus inline-flex h-11 items-center border border-black px-6 text-[12px] font-medium uppercase tracking-[0.16em]"
                data-darwin="hero-secondary"
              >
                Explore new in
              </StoreLink>
            </div>
            <p className="text-[11px] font-medium uppercase leading-relaxed tracking-[0.22em] sm:text-right">
              New
              <br />
              Collection
              <br />
              2026
            </p>
          </div>
        </div>
      </section>

      {spec.hero.showSocialProof && <SocialProof />}

      <section className="bg-black text-white" aria-label="Categories">
        <div className="mx-auto grid max-w-[1440px] gap-3 px-4 py-4 sm:px-6 lg:grid-cols-3 lg:px-8 lg:py-5">
          {BANDS.map((band) => {
            const product = getProduct(band.id);
            return (
              <StoreLink
                key={band.key}
                href={`/store?category=${band.key}#collection`}
                className="pace-focus group grid min-h-[148px] grid-cols-[112px_1fr] items-center gap-4 bg-[#141414] p-3 transition hover:bg-[#1c1c1c] sm:min-h-[168px] sm:grid-cols-[140px_1fr] sm:p-4"
              >
                {product && (
                  <ProductArt
                    product={product}
                    color={band.color}
                    className="aspect-square w-full bg-[#101010]"
                    imgClassName="scale-110 object-contain"
                    style={{ backgroundImage: "none", background: "#101010" }}
                  />
                )}
                <span>
                  <span className="block text-[22px] font-medium tracking-[-0.03em] sm:text-[26px]">{band.label}</span>
                  <span className="mt-1 block text-[13px] text-white/70">{band.line}</span>
                  <span className="mt-4 inline-block text-[11px] font-medium uppercase tracking-[0.16em] underline underline-offset-4">
                    Shop {band.label}
                  </span>
                </span>
              </StoreLink>
            );
          })}
        </div>
      </section>

      <section className="grid bg-[#f3f1ee] lg:grid-cols-2">
        <div className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16 lg:py-24">
          <p className="text-[12px] font-medium uppercase tracking-[0.2em]">New season</p>
          <h2 className="pace-display mt-3 text-5xl font-black uppercase leading-[0.9] sm:text-7xl">New vibes</h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-black/70">
            {subheadline || "Discover everything new, from daily trainers to race day."}
          </p>
          <StoreLink
            href="/store#collection"
            className="pace-focus mt-8 inline-flex h-11 w-fit items-center bg-black px-6 text-[12px] font-medium uppercase tracking-[0.16em] text-white"
          >
            Explore collection
          </StoreLink>
        </div>
        {seasonProduct && (
          <ProductArt
            product={seasonProduct}
            color="Navy"
            className="min-h-[320px] rounded-none lg:min-h-[560px]"
            imgClassName="scale-90 object-contain"
          />
        )}
      </section>

      <section className="border-y border-black/10 bg-white" aria-label="Store promises">
        <ul className="mx-auto grid max-w-[1440px] gap-8 px-6 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:px-10">
          {TRUST.map((item) => (
            <li key={item.title} className="flex items-center gap-4">
              <item.icon className="size-7 shrink-0" strokeWidth={1.25} aria-hidden />
              <span>
                <span className="block text-[12px] font-semibold uppercase tracking-[0.12em]">{item.title}</span>
                <span className="mt-0.5 block text-[13px] text-black/55">{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {showcase && showcase.products.length > 0 && (
        <section className="bg-white py-12 sm:py-16" aria-label={`Best of ${showcase.title}`}>
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[13px] font-medium uppercase tracking-[0.2em]">Best of {showcase.title}</h2>
              {showcase.storeUrl && (
                <a href={showcase.storeUrl} className="pace-focus text-[12px] font-medium uppercase tracking-[0.16em] underline underline-offset-4" target="_blank" rel="noreferrer">
                  View all
                </a>
              )}
            </div>
            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
              {showcase.products.map((product) => (
                <li key={product.id}>
                  <a href={product.href} className="pace-focus group block" target="_blank" rel="noreferrer">
                    <span className="block aspect-[3/4] overflow-hidden bg-[#f3f1ee]">
                      {product.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Whop CDN image
                        <img src={product.image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                      ) : (
                        <span className="flex h-full items-end p-4 text-lg font-medium tracking-[-0.03em]">{product.title}</span>
                      )}
                    </span>
                    <span className="mt-3 block text-[14px] font-medium">{product.title}</span>
                    {product.priceLabel && <span className="mt-0.5 block text-[13px] text-black/55">{product.priceLabel}</span>}
                    {product.headline && !product.priceLabel && (
                      <span className="mt-0.5 line-clamp-2 block text-[13px] text-black/55">{product.headline}</span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <ProductGrid spec={spec} category={category} editorial brand={brand} />
    </>
  );
}
