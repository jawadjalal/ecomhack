import { PRODUCTS } from "@/lib/catalog";
import { hiddenFields } from "@/lib/agent-view";
import { gbp } from "@/lib/format";
import { getSpec } from "@/lib/spec";

/** GET /llms.txt: a plain-text map of the store for AI assistants. */
export async function GET() {
  const { spec } = await getSpec();
  const hidden = hiddenFields(spec);
  const body = [
    "# Orchard",
    "",
    "> A fictional consumer-electronics store used to demo Darwin. Nothing here is really for sale.",
    "",
    "## Catalogue",
    "- [Product catalogue as JSON](/api/catalog): prices in pence (GBP), options, ratings" + (hidden.length ? `; not published yet: ${hidden.join(", ")}` : ""),
    "",
    "## Products",
    ...PRODUCTS.map((p) => `- [${p.name}](/products/${p.slug}): ${p.tagline} From ${gbp(p.price, { whole: true })}.`),
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
