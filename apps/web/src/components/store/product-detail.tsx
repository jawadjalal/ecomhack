"use client";

import { Check, ChevronRight, Leaf, Lock, RotateCcw, Ruler, ShieldCheck, Truck } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import type { Product } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { addToCart, announceAdded } from "@/lib/storefront/cart";
import { categoryLabel, isOneSize, lowStockCallout, LOW_STOCK, sizeLabel, sizesOf } from "@/lib/storefront/products";
import { SizeGuide } from "./size-guide";
import { StoreLink, useStore, useTrack } from "./store-provider";
import { Price, ProductArt, Stars } from "./ui";

const ATTR_LABELS: Record<string, string> = {
  weight_g: "Weight",
  drop_mm: "Heel-to-toe drop",
  terrain: "Terrain",
  cushioning: "Cushioning",
  vegan: "Vegan",
  waterproof: "Waterproof",
  carbon_plate: "Carbon plate",
  material: "Material",
  pack: "Pairs",
  capacity_l: "Capacity",
  flasks: "Soft flasks",
};

function formatAttr(key: string, v: string | number | boolean) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (key === "weight_g") return `${v} g (UK 8)`;
  if (key === "drop_mm") return `${v} mm`;
  if (key === "capacity_l") return `${v} L`;
  return typeof v === "string" ? v.charAt(0).toUpperCase() + v.slice(1) : String(v);
}

const FIT_NOTES: Record<string, string> = {
  p_aurora: "Runs slightly long — most runners go half a size down.",
  p_ridge: "True to size with a snug heel. Wide feet: go half a size up.",
  p_velocity: "Race fit: snug and precise. Go true to size.",
};

export interface ProductDetailProps {
  product: Product;
  delivery: { message: string; date: string };
}

export function ProductDetail({ product, delivery }: ProductDetailProps) {
  const { spec } = useStore();
  const pp = spec.productPage;
  const track = useTrack();
  const oneSize = isOneSize(product);
  const sizes = sizesOf(product);

  const [color, setColor] = useState(product.colors[0].name);
  const [size, setSize] = useState<string | null>(oneSize ? sizes[0].size : null);
  const [view, setView] = useState(0);
  const [sizeError, setSizeError] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  const urgency = pp.urgency === "low-stock" ? lowStockCallout(product, size) : null;
  const threshold = spec.cart.freeShippingThreshold;

  const add = () => {
    if (!size) {
      setSizeError((n) => n + 1);
      document.getElementById("size-picker")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const line = { productId: product.id, color, size, quantity: 1 };
    addToCart(line);
    announceAdded(line);
    track("product_added", {
      product_id: product.id,
      price: product.price,
      quantity: 1,
      size,
      color,
      source: "product_page",
      cta_position: pp.ctaPosition,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1800);
  };

  const cta = (extra = "") => (
    <button
      type="button"
      onClick={add}
      className={`pace-btn pace-btn-primary pace-btn-block min-h-14 w-full text-base ${extra}`}
      data-darwin="cta-add-to-cart"
      data-cta-position={pp.ctaPosition}
    >
      {justAdded ? (
        <>
          <Check className="size-5" aria-hidden /> Added to bag
        </>
      ) : (
        <>
          {pp.ctaText}
          <span className="font-normal opacity-70">·</span>
          {formatGBP(product.price)}
        </>
      )}
    </button>
  );

  const views = [
    { label: "Side", img: "" },
    { label: "Medial", img: "-scale-x-100" },
    { label: "Detail", img: "scale-[2.1] origin-[22%_78%]" },
  ];

  return (
    <>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <ProductArt
            product={product}
            color={color}
            className="aspect-square w-full sm:aspect-[5/4]"
            imgClassName={`transition-transform duration-500 ease-out p-[4%] ${views[view].img}`}
            priority
          />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {views.map((v, i) => (
              <button
                key={v.label}
                type="button"
                onClick={() => setView(i)}
                className={`pace-focus pace-card overflow-hidden outline-offset-2 transition ${view === i ? "ring-2 ring-(--ink)" : "opacity-80 hover:opacity-100"}`}
                aria-label={`${v.label} view`}
                aria-pressed={view === i}
              >
                <ProductArt product={product} color={color} className="aspect-[4/3] w-full" imgClassName={`p-[4%] ${v.img}`} />
              </button>
            ))}
          </div>
        </div>

        {/* Buy box */}
        <div className="min-w-0">
          <p className="pace-eyebrow text-(--muted)">{categoryLabel(product.category)}</p>
          <h1 className="pace-display mt-2 text-[2.4rem] font-extrabold sm:text-5xl">{product.name}</h1>
          {pp.showReviews && (
            <a href="#reviews" className="pace-focus mt-3 inline-flex items-center gap-2 text-sm" data-darwin="reviews-link">
              <Stars rating={product.rating} />
              <span className="font-semibold">{product.rating.toFixed(1)}</span>
              <span className="pace-link text-(--muted)">{product.reviewCount.toLocaleString("en-GB")} reviews</span>
            </a>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Price price={product.price} compareAt={product.compareAtPrice} className="text-2xl font-semibold" />
            {product.compareAtPrice && product.compareAtPrice > product.price && (
              <span className="pace-chip bg-[#fee2e2] px-2 py-0.5 text-xs font-semibold text-[#b91c1c]">
                Save {formatGBP(product.compareAtPrice - product.price)}
              </span>
            )}
          </div>
          <p className="mt-3 text-[15px] text-(--muted)">{product.tagline}</p>

          {/* Colour */}
          <fieldset className="mt-7">
            <legend className="text-sm">
              <span className="font-semibold">Colour:</span> <span className="text-(--muted)">{color}</span>
            </legend>
            <div className="mt-3 flex gap-2.5">
              {product.colors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColor(c.name)}
                  className={`pace-focus flex size-11 items-center justify-center rounded-full border-2 transition ${
                    color === c.name ? "border-(--ink)" : "border-transparent hover:border-[#d6d3d1]"
                  }`}
                  aria-label={c.name}
                  aria-pressed={color === c.name}
                  data-darwin="color-option"
                >
                  <span className="size-8 rounded-full border border-black/10" style={{ background: c.hex }} />
                </button>
              ))}
            </div>
          </fieldset>

          {/* Size */}
          {!oneSize ? (
            <fieldset id="size-picker" className="mt-7 scroll-mt-28">
              <div className="flex items-center justify-between">
                <legend className="text-sm">
                  <span className="font-semibold">Size:</span>{" "}
                  <span className={sizeError && !size ? "font-medium text-[#b91c1c]" : "text-(--muted)"}>
                    {size ? sizeLabel(size) : sizeError ? "Please select a size" : "Select a size"}
                  </span>
                </legend>
                {pp.showSizeGuide && (
                  <button
                    type="button"
                    onClick={() => setGuideOpen(true)}
                    className="pace-focus inline-flex items-center gap-1.5 text-sm font-medium"
                    data-darwin="size-guide-open"
                  >
                    <Ruler className="size-4" aria-hidden />
                    <span className="pace-link">Size guide</span>
                  </button>
                )}
              </div>
              <div key={sizeError} className={`mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7 ${sizeError && !size ? "pace-shake" : ""}`}>
                {sizes.map(({ size: s, stock }) => {
                  const out = stock <= 0;
                  const low = pp.urgency === "low-stock" && !out && stock <= LOW_STOCK;
                  const on = size === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={out}
                      onClick={() => setSize(s)}
                      className={`pace-chip pace-focus relative min-h-12 border text-sm font-medium transition ${
                        on
                          ? "border-(--ink) bg-(--ink) text-white"
                          : out
                            ? "cursor-not-allowed border-(--line) bg-(--surface-2) text-[#c4c0bb]"
                            : sizeError && !size
                              ? "border-[#fca5a5] hover:border-(--ink)"
                              : "border-[#d6d3d1] hover:border-(--ink)"
                      }`}
                      aria-pressed={on}
                      aria-label={`${sizeLabel(s)}${out ? ", out of stock" : low ? `, only ${stock} left` : ""}`}
                      data-darwin="size-option"
                    >
                      {out && (
                        <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 10 10" aria-hidden>
                          <line x1="0" y1="10" x2="10" y2="0" stroke="#d6d3d1" strokeWidth="0.3" />
                        </svg>
                      )}
                      {s}
                      {low && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-[#ea580c]" aria-hidden />}
                    </button>
                  );
                })}
              </div>
              {!oneSize && <p className="mt-2 text-xs text-(--muted)">UK sizes · Unisex fit</p>}
            </fieldset>
          ) : null}

          {urgency && (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium text-[#c2410c]" data-darwin="urgency">
              <span className="relative flex size-2">
                <span className="pace-ping absolute inline-flex h-full w-full rounded-full bg-[#fb923c] opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-[#ea580c]" />
              </span>
              Only {urgency.stock} left in {sizeLabel(urgency.size)}
              {!size && <span className="font-normal text-(--muted)">— selling fast</span>}
            </p>
          )}

          {pp.ctaPosition === "above-fold" && <div className="mt-6">{cta()}</div>}

          {(pp.showDeliveryEstimate || pp.showReturnsPolicy) && (
            <div className="pace-card mt-6 divide-y divide-(--line) border border-(--line)">
              {pp.showDeliveryEstimate && (
                <InfoRow icon={<Truck className="size-5" strokeWidth={1.7} />} dataDarwin="delivery-estimate">
                  <p className="font-semibold">{delivery.message}</p>
                  <p className="text-(--muted)">
                    Estimated delivery {delivery.date} ·{" "}
                    {threshold !== null ? `free over ${formatGBP(threshold)}` : "tracked UK delivery"}
                  </p>
                </InfoRow>
              )}
              {pp.showReturnsPolicy && (
                <InfoRow icon={<RotateCcw className="size-5" strokeWidth={1.7} />} dataDarwin="returns-policy">
                  <p className="font-semibold">
                    {product.freeReturns ? "Free" : "Easy"} {product.returnDays}-day returns
                  </p>
                  <p className="text-(--muted)">
                    {product.freeReturns ? "Run in them. Still not right? Send them back, even worn." : "Unworn items, prepaid label £3.95."}
                  </p>
                </InfoRow>
              )}
            </div>
          )}

          {pp.trustBadges && (
            <ul className="mt-6 grid grid-cols-2 gap-3 text-[13px]" data-darwin="trust-badges">
              {[
                { icon: Lock, label: "Secure checkout" },
                { icon: ShieldCheck, label: "2-year warranty" },
                { icon: Leaf, label: "Carbon-neutral delivery" },
                { icon: Check, label: "Rated 4.8 by 12,400 runners" },
              ].map((b) => (
                <li key={b.label} className="pace-card flex items-center gap-2.5 bg-(--surface) px-3 py-2.5 font-medium">
                  <b.icon className="size-4 shrink-0 text-emerald-700" aria-hidden />
                  {b.label}
                </li>
              ))}
              <li className="col-span-2 flex flex-wrap items-center gap-1.5 pt-1 text-[11px] font-semibold text-(--muted)">
                {["VISA", "Mastercard", "AMEX", "PayPal", "Klarna"].map((p) => (
                  <span key={p} className="rounded border border-(--line) px-1.5 py-0.5">
                    {p}
                  </span>
                ))}
              </li>
            </ul>
          )}

          <div className="mt-8 border-t border-(--line) pt-7">
            <h2 className="text-sm font-semibold">Description</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-(--ink)/85">{product.description}</p>
            <ul className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {product.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 shrink-0 text-(--muted)" aria-hidden /> {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-7 border-t border-(--line) pt-7">
            <h2 className="text-sm font-semibold">Specs</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 text-sm">
              {Object.entries(product.attributes).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-(--line) py-2.5">
                  <dt className="text-(--muted)">{ATTR_LABELS[k] ?? k}</dt>
                  <dd className="text-right font-medium">{formatAttr(k, v)}</dd>
                </div>
              ))}
            </dl>
          </div>

          {pp.ctaPosition === "below-description" && <div className="mt-8">{cta()}</div>}
        </div>
      </div>

      {pp.ctaPosition === "sticky" && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-(--line) bg-white/95 backdrop-blur-md" data-darwin="sticky-cta-bar">
          <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6 lg:px-10">
            <ProductArt product={product} color={color} className="hidden size-12 shrink-0 sm:block" />
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="truncate text-sm font-semibold">{product.name}</p>
              <p className="text-sm text-(--muted)">
                {color} · {size ? sizeLabel(size) : "Select a size"}
              </p>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[300px]">{cta("min-h-12")}</div>
          </div>
        </div>
      )}

      <SizeGuide open={guideOpen} onClose={closeGuide} fitNote={FIT_NOTES[product.id] ?? "Fits true to size for most runners."} />
    </>
  );
}

function InfoRow({ icon, children, dataDarwin }: { icon: ReactNode; children: ReactNode; dataDarwin: string }) {
  return (
    <div className="flex gap-3 px-4 py-3.5 text-sm" data-darwin={dataDarwin}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 leading-snug">{children}</div>
    </div>
  );
}

export function Breadcrumbs({ product }: { product: Product }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[13px] text-(--muted)">
      <StoreLink href="/store" className="hover:text-(--ink)">
        Store
      </StoreLink>
      <ChevronRight className="size-3.5" aria-hidden />
      <StoreLink href={`/store?category=${product.category}#collection`} className="hover:text-(--ink)">
        {categoryLabel(product.category)}
      </StoreLink>
      <ChevronRight className="size-3.5" aria-hidden />
      <span className="truncate text-(--ink)" aria-current="page">
        {product.name}
      </span>
    </nav>
  );
}
