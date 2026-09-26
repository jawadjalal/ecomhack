import { getSpec } from "@/lib/config";
import { BUNDLES } from "@/lib/catalog";
import { gbp } from "@/lib/commerce";

export const dynamic = "force-dynamic";

/** GET /llms.txt: a plain-text map of the store for AI assistants and shopping agents. */
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const spec = getSpec();
  const body = [
    "# Rackd (demo store)",
    "",
    "> Wholesale vintage clothing bundles for resellers. Fictional store used to demo Darwin; nothing is for sale.",
    "",
    `- Catalog JSON: ${origin}/api/catalog`,
    `- All bundles: ${origin}/bundles`,
    spec.agentSurface.exposeReturnPolicy ? "- Buyer protection: report a bundle that doesn't match its listing within 7 days for a refund." : "",
    "",
    "## Bundles",
    ...BUNDLES.map((b) => `- [${b.name}](${origin}/bundles/${b.id}): ${b.pieces} pieces, grade ${b.grade}, ${gbp(b.price)}`),
    "",
  ]
    .filter((l, i, all) => l !== "" || all[i - 1] !== "")
    .join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
