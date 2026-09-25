import { PageSpecSchema, type PageSpec } from "@/lib/contracts";
import config from "../../../storefront.config.json";

/**
 * Generation 0 = `apps/web/storefront.config.json`.
 *
 * Darwin ships winning experiments by opening a PR that edits that file, so merging the PR
 * makes the winner the new baseline on the next deploy. That's the "git" half of the loop.
 *
 * The committed baseline deliberately ships with the friction real stores have, so the loop
 * has something to find:
 *   - shipping cost only revealed at the last checkout step ("shipping shock")
 *   - add-to-cart button below the description
 *   - no reviews on product pages, no delivery estimate
 *   - 3-step checkout, account required
 *   - agent surface hides stock, delivery ETA, returns and landed price; no negotiation
 */
export const DEFAULT_SPEC: PageSpec = PageSpecSchema.parse(config);
