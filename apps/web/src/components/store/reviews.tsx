import { BadgeCheck } from "lucide-react";
import type { Product } from "@/lib/catalog/products";
import { ratingDistribution } from "@/lib/storefront/products";
import { Container, Stars } from "./ui";

const EXTRA_REVIEWS = [
  { author: "Hannah C.", rating: 5, title: "Comfiest shoe I own", body: "Bought for the London Marathon, now wear them for everything." },
  { author: "Marcus D.", rating: 4, title: "Great value", body: "Quick delivery, true to size, and the grip on wet pavements is excellent." },
];

export function Reviews({ product }: { product: Product }) {
  const dist = ratingDistribution(product.rating);
  const reviews = [...product.reviews, ...EXTRA_REVIEWS].slice(0, 4);
  return (
    <section id="reviews" className="scroll-mt-24 border-t border-(--line) bg-(--surface-2) py-16 sm:py-20" data-darwin="reviews">
      <Container>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-20">
          <div>
            <h2 className="pace-display text-3xl font-bold sm:text-4xl">Reviews</h2>
            <div className="mt-6 flex items-end gap-3">
              <span className="pace-display text-6xl font-extrabold">{product.rating.toFixed(1)}</span>
              <div className="pb-2">
                <Stars rating={product.rating} size={18} />
                <p className="mt-1 text-sm text-(--muted)">{product.reviewCount.toLocaleString("en-GB")} verified reviews</p>
              </div>
            </div>
            <div className="mt-6 space-y-2">
              {dist.map((pct, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <span className="w-3 text-(--muted)">{5 - i}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e7e5e4]">
                    <div className="h-full rounded-full bg-(--ink)" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-9 text-right text-(--muted)">{pct}%</span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <p className="text-sm font-semibold">Fit</p>
              <div className="relative mt-3 h-1.5 rounded-full bg-[#e7e5e4]">
                <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-(--ink) shadow" style={{ left: product.id === "p_aurora" ? "64%" : "50%" }} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-(--muted)">
                <span>Runs small</span>
                <span>True to size</span>
                <span>Runs large</span>
              </div>
            </div>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {reviews.map((r) => (
              <li key={r.author} className="pace-card border border-(--line) bg-white p-6">
                <Stars rating={r.rating} />
                <h3 className="mt-3 font-semibold">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-(--ink)/80">{r.body}</p>
                <p className="mt-4 flex items-center gap-1.5 text-xs text-(--muted)">
                  <span className="font-medium text-(--ink)">{r.author}</span>
                  <BadgeCheck className="size-3.5 text-emerald-700" aria-hidden /> Verified buyer
                </p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
