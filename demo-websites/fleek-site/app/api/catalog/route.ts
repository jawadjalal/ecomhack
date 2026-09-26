import { getSpec } from "@/lib/config";
import { BUNDLES, perPiece, supplierById } from "@/lib/catalog";
import { deliveryWindow, landedPrice, RETURNS_POLICY } from "@/lib/commerce";

export const dynamic = "force-dynamic";

/**
 * GET /api/catalog: the store for AI shopping agents. What it reveals follows `agentSurface` in
 * storefront.config.json, exactly like the human page follows the other knobs: Gen 0 hides stock,
 * delivery ETA, returns and landed price, and says so in `not_provided`.
 */
export function GET(req: Request) {
  const spec = getSpec();
  const a = spec.agentSurface;
  const origin = new URL(req.url).origin;
  const notProvided = [
    !a.exposeStock && "stock",
    !a.exposeDeliveryEta && "delivery_eta",
    !a.exposeReturnPolicy && "return_policy",
    !a.exposeLandedPrice && "landed_price",
  ].filter(Boolean);
  const products = BUNDLES.map((b) => {
    const d = deliveryWindow(b);
    return {
      id: b.id,
      name: b.name,
      url: `${origin}/bundles/${b.id}`,
      category: b.category,
      supplier: supplierById(b.supplier)?.name,
      currency: "GBP",
      price: b.price,
      price_per_piece: perPiece(b),
      pieces: b.pieces,
      grade: b.grade,
      weight_kg: b.weightKg,
      sizes: b.sizes,
      rating: b.rating,
      review_count: b.reviewCount,
      ...(a.exposeStock ? { stock: b.stock } : {}),
      ...(a.exposeDeliveryEta ? { delivery_eta: { from: d.from.toISOString().slice(0, 10), to: d.to.toISOString().slice(0, 10) } } : {}),
      ...(a.exposeLandedPrice ? { landed_price: landedPrice(b, spec.cart.freeShippingThreshold) } : {}),
    };
  });
  return Response.json(
    {
      store: "Rackd (demo)",
      money: "integer pence",
      config_version: spec.version,
      ...(a.exposeReturnPolicy ? { return_policy: RETURNS_POLICY } : {}),
      ...(a.negotiation.enabled ? { negotiation: { enabled: true, max_discount_pct: a.negotiation.maxDiscountPct } } : {}),
      not_provided: notProvided,
      products,
    },
    { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
  );
}
