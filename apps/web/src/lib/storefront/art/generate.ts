/**
 * Regenerate the product illustrations in `public/products/`.
 *
 *   cd apps/web && npx tsx src/lib/storefront/art/generate.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allArtFiles } from "./catalog-art";

const outDir = path.resolve(process.cwd(), "public/products");
mkdirSync(outDir, { recursive: true });
for (const { file, svg } of allArtFiles()) {
  writeFileSync(path.join(outDir, file), svg);
  console.log(`wrote public/products/${file} (${(svg.length / 1024).toFixed(1)} KB)`);
}
