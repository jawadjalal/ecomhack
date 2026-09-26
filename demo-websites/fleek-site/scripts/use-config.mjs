#!/usr/bin/env node
/**
 * Switch the live storefront config for a before/after demo without Darwin:
 *   npm run config:gen0    # the committed baseline, all planted mistakes
 *   npm run config:fixed   # an example of every fix Darwin can ship
 * The store reads storefront.config.json on every request, so just reload the page.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "gen0";
const from = join(root, "configs", `${name}.json`);
if (!existsSync(from)) {
  console.error(`No configs/${name}.json. Try: gen0, fixed`);
  process.exit(1);
}
copyFileSync(from, join(root, "storefront.config.json"));
console.log(`storefront.config.json ← configs/${name}.json (reload the page)`);
