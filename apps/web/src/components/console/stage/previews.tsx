"use client";

import { useState } from "react";
import useSWR from "swr";
import { ExternalLink, ImageOff } from "lucide-react";
import type { PageSpec } from "@/lib/contracts";
import { PRODUCTS, SHIPPING_FEE } from "@/lib/catalog/products";
import { base64UrlEncode, money } from "@/lib/console/format";
import { useMeasure } from "@/lib/console/hooks";
import { cn } from "@/components/ui/cn";

const FRAME_W = 1280;
const FRAME_H = 820;

export type PreviewPage = "home" | "product" | "cart";

/** Candidate storefront routes per page; the first that answers 200 is used. */
const PAGE_PATHS: Record<PreviewPage, string[]> = {
  home: ["/store"],
  product: [
    "/store/products/aurora-daily-trainer",
    "/store/product/aurora-daily-trainer",
    "/store/p/aurora-daily-trainer",
    "/store/aurora-daily-trainer",
    "/store/products/p_aurora",
    "/store",
  ],
  cart: ["/store/cart", "/store/bag", "/store/checkout", "/store"],
};

export function specQuery(spec: PageSpec) {
  return `previewSpec=${base64UrlEncode(JSON.stringify(spec))}`;
}

async function firstReachable(candidates: string[]): Promise<string | null> {
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", cache: "no-store", headers: { "x-darwin-preview": "1" } });
      if (res.ok) return url;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Which page best shows a patch. */
export function pageForPatch(patch: object | undefined): PreviewPage {
  const keys = Object.keys(patch ?? {});
  if (keys.includes("productPage")) return "product";
  if (keys.includes("cart") || keys.includes("checkout")) return "cart";
  return "home";
}

export function StoreFrame({
  page,
  query,
  label,
  tone,
  className,
}: {
  page: PreviewPage;
  /** Query string without "?" (e.g. variant=control or previewSpec=…). */
  query: string;
  label: React.ReactNode;
  tone: "control" | "treatment";
  className?: string;
}) {
  const [ref, size] = useMeasure<HTMLDivElement>();
  // probe which storefront route exists once per page type, then add the spec query
  const { data: path, isLoading } = useSWR(["preview-path", page], () => firstReachable(PAGE_PATHS[page]), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 5 * 60_000,
  });
  const src = path === undefined ? undefined : path === null ? null : `${path}?${query}`;
  const [loaded, setLoaded] = useState<string | null>(null);
  const scale = size.width ? size.width / FRAME_W : 0;

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2 text-[0.76rem]">
        <div className="flex min-w-0 items-center gap-1.5 font-medium text-white/70">
          <span
            className={cn(
              "flex size-[1.15rem] items-center justify-center rounded-[0.3rem] text-[0.66rem] font-bold",
              tone === "control" ? "bg-control/25 text-white/80" : "bg-brand text-[#0b1200]",
            )}
          >
            {tone === "control" ? "A" : "B"}
          </span>
          <span className="truncate">{label}</span>
        </div>
        {src && (
          <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-white/35 hover:text-white" title="Open in a new tab">
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      <div
        ref={ref}
        className={cn(
          "relative w-full overflow-hidden rounded-lg border bg-[#0e1117]",
          tone === "treatment" ? "border-brand/35 shadow-[0_0_30px_-12px_rgba(182,240,90,0.5)]" : "border-white/[0.08]",
        )}
        style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}` }}
      >
        {src && scale > 0 && (
          <iframe
            key={src}
            src={src}
            title={`${tone} preview`}
            tabIndex={-1}
            onLoad={() => setLoaded(src)}
            className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
            style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, opacity: loaded === src ? 1 : 0, transition: "opacity .4s" }}
          />
        )}
        {(isLoading || (src && loaded !== src)) && <div className="shimmer absolute inset-0" />}
        {!isLoading && src === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center text-[0.74rem] text-white/40">
            <ImageOff className="size-5 text-white/25" />
            Storefront preview unavailable
            <span className="font-mono text-[0.64rem] text-white/25">{PAGE_PATHS[page][0]}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ agent surface diff */

function agentView(spec: PageSpec): Record<string, unknown> {
  const p = PRODUCTS[0];
  const s = spec.agentSurface;
  const out: Record<string, unknown> = {
    id: p.id,
    name: p.name,
    price: `${money(p.price)}`,
  };
  if (s.exposeStock) out.sizes = `UK 6–11 · ${Object.values(p.stock).reduce((a, b) => a + b, 0)} in stock`;
  if (s.exposeDeliveryEta) out.deliveryEtaDays = p.deliveryDays;
  if (s.exposeReturnPolicy) out.returnPolicy = `${p.returnDays} days, ${p.freeReturns ? "free" : "paid"}`;
  if (s.exposeLandedPrice) {
    const free = spec.cart.freeShippingThreshold !== null && p.price >= spec.cart.freeShippingThreshold;
    out.landedPrice = money(p.price + (free ? 0 : SHIPPING_FEE));
  }
  if (s.structuredData) out.jsonLd = "schema.org/Product";
  if (s.negotiation.enabled) out.negotiation = `up to ${s.negotiation.maxDiscountPct}% off`;
  return out;
}

export function AgentSurfaceDiff({ control, treatment, className }: { control: PageSpec; treatment: PageSpec; className?: string }) {
  const a = agentView(control);
  const b = agentView(treatment);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const fmt = (v: unknown) => (typeof v === "string" ? `"${v}"` : String(v));
  return (
    <div className={cn("flex min-h-0 flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5 text-[0.76rem] font-medium text-white/70">
        <span>🤖</span> What AI agents see
        <span className="font-mono text-[0.68rem] text-white/35">GET /api/agent/products/{PRODUCTS[0].id}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/[0.07] bg-[#07090d] px-3 py-2 font-mono text-[0.72rem] leading-[1.45]">
        <div className="text-white/30">{"{"}</div>
        {keys.map((k) => {
          const inA = k in a;
          const inB = k in b;
          const same = inA && inB && fmt(a[k]) === fmt(b[k]);
          if (same)
            return (
              <div key={k} className="truncate pl-3 text-white/45">
                <span className="text-white/35">&quot;{k}&quot;</span>: {fmt(a[k])},
              </div>
            );
          return (
            <div key={k}>
              {inA && (
                <div className="truncate bg-bad/10 pl-3 text-[#ff9b9b]/80 line-through decoration-[#ff9b9b]/40">
                  &quot;{k}&quot;: {fmt(a[k])},
                </div>
              )}
              {inB && (
                <div className="relative truncate bg-good/10 pl-3 text-[#8ff0b2]">
                  <span className="absolute left-0.5 text-[#8ff0b2]/70">+</span>&quot;{k}&quot;: {fmt(b[k])},
                </div>
              )}
            </div>
          );
        })}
        <div className="text-white/30">{"}"}</div>
      </div>
    </div>
  );
}
