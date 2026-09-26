# Rackd: a Fleek-style demo store for Darwin

A standalone Next.js storefront laid out like a vintage-wholesale marketplace (measured from joinfleek.com: section order, sizes, type scale, colours), under a fictional brand, **Rackd**. It ships with a few blatant conversion mistakes. Every mistake comes from one knob in `storefront.config.json`, which uses Darwin's PageSpec format. When Darwin's "ship the winner" PR changes that file, the store is fixed.

No Fleek images, CSS, fonts, logos or copy are committed. Product images are SVG flat-lays generated in code, lifestyle photos are neutral placeholders, and the font is Montserrat (SIL OFL) from Google Fonts.

## Run it

```bash
cd demo-websites/fleek-site
npm install
npm run dev            # http://localhost:3002
npm run build && npm start
```

Pages: home, `/bundles` (listing), `/bundles/[id]` (product), `/cart`, `/checkout` (1–3 steps, no real payments), `/order/[id]`, `/account`, plus `/api/catalog` and `/llms.txt` for AI agents.

Env (see `.env.example`): `DARWIN_URL` (default `http://localhost:3000`, live: `https://darwin-production-7899.up.railway.app`, `off` to disable) and `DARWIN_SITE` (default `rackd`).

## The planted mistakes and the knob that fixes each

| Mistake (Gen 0) | PageSpec knob → fix |
|---|---|
| Weak hero button ("Learn more"), no social proof (no press strip, buyer count or testimonials) | `hero.ctaText` → "Shop bestsellers", `hero.showSocialProof` → true |
| Add to cart buried under the long description on product pages | `productPage.ctaPosition` → `above-fold` or `sticky` |
| Stock hidden: product pages never say how many bundles are left or whether it's in stock | `productPage.urgency` → `low-stock` (shows the real stock count) |
| No delivery estimate, no buyer protection, no trust badges, no reviews or quality score | `productPage.showDeliveryEstimate`, `showReturnsPolicy`, `trustBadges`, `showReviews` → true |
| Shipping is hidden everywhere, then freight, customs and a small-order fee appear at the last checkout step | `cart.showShippingUpfront` → true, `cart.freeShippingThreshold` → e.g. 30000 |
| 3-step checkout, forced reseller-account creation (VAT number, password), no guest checkout | `checkout.steps` → 1, `checkout.guestCheckout` → true |
| No express pay | `checkout.expressPay` → true |
| No ratings on product and supplier cards, no quick add | `productGrid.showRatings`, `productGrid.showQuickAdd` → true |
| AI agents can't see stock, ETA, returns or landed price (`/api/catalog`, JSON-LD) | `agentSurface.*` → true |

The store reads `storefront.config.json` on every request, so a merged PR (or a local edit) shows on reload with no rebuild. For a before/after without Darwin: `npm run config:fixed` and `npm run config:gen0`. The footer badge shows which config is live.

## Darwin integration

- **Tag:** `components/darwin-tag.tsx` loads `${DARWIN_URL}/darwin.js` with `data-darwin-site`. It lives outside `app/layout.tsx`, so Darwin's install PR still detects a Next.js App Router layout without the tag and adds one. If both load, darwin.js only runs once.
- **Funnel events** (`lib/track.ts`): `product_viewed`, `product_added`, `cart_viewed`, `checkout_started`, `checkout_step_completed`, `shipping_cost_revealed`, `checkout_abandoned`, `order_completed`. Money is in pence, and each event carries `config_version`/`config_label`. Darwin tracks `$pageview` and clicks itself.
- **Personalization targets:** key elements have ids and `data-darwin` attributes (`hero-title`, `hero-cta`, `add-to-cart`, `buy-box`, `delivery-estimate`, `trust-badges`, `announcement`, `checkout`).
- **Connect the repo:** copy this folder into its own repo, then in Darwin's onboarding either paste the repo URL (install PR) or use the script tag. Set `DARWIN_TARGET_CONFIG_PATH=storefront.config.json` on Darwin so the ship PR edits this file.
- **Baseline:** `POST /api/loop/baseline { spec, reset? }` on Darwin (new, admin-only) makes this store's `storefront.config.json` Darwin's Gen 0. The seed script calls it. Without it, Darwin's ship PR would write the PACE demo store's copy into this repo.

## What the loop ships from this Gen 0

A local run of Darwin's real loop (heuristic proposals, built-in simulator, no LLM keys) from this `storefront.config.json` via the same path as `/api/loop/baseline` shipped 5 generations: agent stock (`agentSurface.exposeStock`), one-page guest checkout with express pay (`checkout.*`), agent delivery ETA + JSON-LD, sticky add to cart + reviews + delivery estimate (`productPage.*`), and shipping shown in the cart with a free-shipping threshold (`cart.*`). All traffic in that run is simulated. The optimizer's playbook copy was written for the PACE demo store, so some labels and values read like PACE ("add-to-bag", "free UK delivery over £60"): check the ship PR's diff before merging it here.

## Seed data

```bash
node seed/seed.mjs --darwin http://localhost:3000 --reset   # add --token $DARWIN_ADMIN_TOKEN if set
```

This imports the baseline, then sends simulated humans and AI agents through Darwin's `/api/simulate` and `/api/web/simulate`, and steps the loop (observe → diagnose → propose → experiment). Every seeded event is `synthetic: true`. Darwin's public `/api/collect` forces `synthetic: false`, so the seed never uses it.

## Exact local mode: never commit or deploy

`npm run mirror` downloads a snapshot of the live joinfleek.com pages and assets into `.mirror/`, which is gitignored. `npm run dev:mirror` serves the snapshot on http://localhost:3003. It injects darwin.js, funnel events and the same PageSpec-driven flaws, proxies cart and checkout to the store app, and labels every page "Demo copy, not affiliated with Fleek". **`.mirror/` holds a third party's copyrighted material. Keep it on the owner's laptop only: never commit it, push it, deploy it or share it.** It needs Playwright's Chromium (`npx playwright install chromium`).

## 60-second demo

1. Open the store at Gen 0. Point out the "Learn more" hero, the Add to cart under the description, and the +£32 of fees that appear at the last of three checkout steps.
2. In Darwin, open Issues (shipping shock, checkout friction, weak add-to-cart, agents missing ETA and returns), then Fixes and Experiments.
3. Ship the winner. Darwin opens a PR editing `storefront.config.json`. Merge and pull (or run `npm run config:fixed`), then reload: sticky add to cart, delivery estimate, buyer protection, fees in the cart, one-step guest checkout with express pay.
