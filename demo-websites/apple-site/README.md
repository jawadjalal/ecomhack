# Orchard: a demo store for Darwin

A standalone storefront that follows the big consumer-electronics store layout (global nav, full-bleed
product tiles, a card-based store, a long buy page, bag, multi-step checkout). The brand is fictional,
Orchard, and it ships with a few **obvious, fixable conversion mistakes**. Connect Darwin to it and demo
Darwin finding the mistakes and fixing them, before → after.

- Next.js 16 (App Router), React 19, zod. No dependency on `apps/web`.
- Every behaviour knob is read from **`storefront.config.json`** (Darwin's PageSpec format) on every
  request, so a merged Darwin "ship the winner" PR fixes the live site on the next refresh.
- Instrumented with Darwin's `darwin.js` plus the standard funnel events, and stable `data-darwin="…"`
  selectors for web personalization.
- Original assets only: product renders are inline SVG drawn in code, lifestyle photos are neutral
  placeholders, fonts are the visitor's system fonts. Nothing from apple.com is committed.
- Optional **exact mode** (`npm run mirror`): a local-only copy of the real pages with the same flaws
  layered on top. See [Exact local mode](#exact-local-mode-owners-laptop-only). Never commit or deploy it.

## The planted mistakes

| # | Mistake (Gen 0 = `storefront.config.json`) | Where you see it | PageSpec knob that fixes it | Fixed look (`presets/fixed.json`) |
|---|---|---|---|---|
| 1 | **Add to Bag is below the description.** The buy page runs through finish, storage, trade-in, OrchardCare, What's in the Box, a comparison table and small print before the only Add to Bag. | `/products/*` | `productPage.ctaPosition`: `"below-description"` → `"above-fold"` or `"sticky"` | Add to Bag in the header, the summary right after the configurator, a sticky bottom bar |
| 2 | **No delivery estimate or returns promise; no trust signals.** The summary says "Delivery details for your area will be shown in Checkout." | buy page summary | `productPage.showDeliveryEstimate`, `showReturnsPolicy`, `trustBadges` (+ `showReviews`, `showSizeGuide`) | "Order by 3pm, delivers Tue 29 Sep", free 14-day returns, secure checkout / warranty badges, star rating and reviews, size guide |
| 3 | **Shipping shock.** The £9.95 delivery fee is hidden in the bag ("Calculated at checkout") and appears only on the last checkout step. | `/bag`, `/checkout` | `cart.showShippingUpfront` (+ `cart.freeShippingThreshold`) | Delivery shown in the bag, free over £50, a "£X more for free delivery" nudge |
| 4 | **3-step checkout with forced account creation, no guest checkout, no express pay.** Step 1 demands an Orchard ID: password rules, date of birth, phone. | `/checkout` | `checkout.steps` 3 → 1, `checkout.guestCheckout`, `checkout.expressPay` | One page, guest checkout, express pay buttons |
| 5 | **AI shopping agents are blind.** No JSON-LD; the agent catalogue hides delivery ETA, returns, stock and landed price. | `/api/catalog`, product JSON-LD, `/llms.txt` | `agentSurface.structuredData`, `exposeDeliveryEta`, `exposeReturnPolicy`, `exposeStock`, `exposeLandedPrice` | Full schema.org `Product` with `shippingDetails` and `hasMerchantReturnPolicy`; ETA, returns, stock and landed price in the catalogue |

Other knobs also render, so any Darwin patch has a visible effect: `hero.*` (home hero headline, subhead,
button text, layout, a social-proof line), `announcement.*` (the ribbon under the nav), `productGrid.*`
(the "All models" cards on `/store`: columns, ratings, quick add, sort), `productPage.ctaText` and
`urgency`, `cart.upsell` ("Complete your setup" in the bag), `theme.accent` and `theme.radius` (every button).

The footer shows which config the page was rendered from (`Config v0 · Baseline`).

## Run it

```bash
cd demo-websites/apple-site
npm install
npm run dev            # http://localhost:3001
npm run build && npm start   # production build, also on :3001
```

Before/after without touching the file: open `http://localhost:3001/preview?config=fixed` (a cookie for
your browser only; `/preview?config=off` goes back). Or point the app at another file with
`STOREFRONT_CONFIG=presets/fixed.json npm run dev`. Editing `storefront.config.json` shows on the next refresh.

Environment (all optional, see `.env.example`):

| Variable | Default | What |
|---|---|---|
| `NEXT_PUBLIC_DARWIN_URL` | `http://localhost:3000` | Where `darwin.js` is loaded from. Live Darwin: `https://darwin-production-7899.up.railway.app`. `off` removes the tag. |
| `NEXT_PUBLIC_DARWIN_SITE` | `orchard` | The `data-darwin-site` id (traffic and personalization rules are grouped by it). |
| `STOREFRONT_CONFIG` | `storefront.config.json` | PageSpec file to render. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3001` | Absolute URLs in JSON-LD and the agent catalogue. |

`NEXT_PUBLIC_*` values are baked in at build time: rebuild after changing them.

## What Darwin sees

`darwin.js` records `$pageview`, `$pageleave`, clicks (`$autocapture`) and `$rageclick`, and loads Darwin's
web personalization runtime for the site id. The site adds the commerce funnel (`lib/track.ts`, money in pence):

`product_viewed` → `product_added` → `cart_viewed` → `shipping_cost_revealed` → `checkout_started` →
`checkout_step_viewed` / `checkout_step_completed` / `checkout_error` → `checkout_abandoned` or
`order_completed` (`revenue`, `shipping`, `order_id`). Express pay sends `express_pay_clicked`.

Stable selectors for personalization rules: `[data-darwin="hero"]`, `hero-title`, `hero-cta`,
`announcement`, `product-grid`, `product-card`, `buy-summary`, `add-to-bag`, `delivery-estimate`,
`returns-policy`, `trust-badges`, `reviews`, `bag`, `bag-summary`, `shipping-row`, `checkout`,
`checkout-step`, `checkout-account`, `checkout-continue`, `express-pay`, `order-summary`.

Agents: `GET /api/catalog` (JSON), `/llms.txt`, and product JSON-LD when `agentSurface.structuredData` is on.

## Copy it into its own repo

```bash
cp -R demo-websites/apple-site ~/orchard-store && cd ~/orchard-store
rm -rf node_modules .next .mirror
git init && git add . && git commit -m "Orchard demo store"
gh repo create orchard-store --public --source . --push
```

It's a plain Next.js App Router app at the repo root (`app/layout.tsx`, `next.config.ts`), which is what
Darwin's install PR detects.

## Connect Darwin

**Option A: GitHub (the full loop).**
1. Build with `NEXT_PUBLIC_DARWIN_URL=off` so Darwin's install PR adds the only tag (otherwise the first
   tag to load wins and its site id is used).
2. Darwin → `/onboarding` → **Connect your GitHub** → pick the repo. Darwin detects "Next.js (App Router)"
   and opens *Install Darwin analytics*, adding `darwin.js` to `app/layout.tsx`. Merge it.
3. Point Darwin's winner PRs at this repo's config: run Darwin with
   `DARWIN_TARGET_REPO=<owner>/orchard-store` and `DARWIN_TARGET_CONFIG_PATH=storefront.config.json`
   (plus a `GITHUB_TOKEN` that can push branches).
4. Recommended: make Orchard's config Darwin's Gen 0 so shipped PRs keep Orchard's copy (Darwin's own
   baseline copy is about running shoes): `node seed/seed.mjs --darwin <darwin> --import-baseline` (uses
   Darwin's `POST /api/loop/baseline`, resets Darwin's loop). Offline alternative, with Darwin stopped:
   `node seed/seed.mjs --write-baseline <DARWIN_DATA_DIR>`.

**Option B: script tag (fastest).** Keep the default `NEXT_PUBLIC_DARWIN_URL` (or set it to your Darwin)
and run the site. In Darwin's onboarding choose the script-tag path; the tag is already on every page.

## Seed data

`seed/seed.mjs` sends simulated shoppers to Darwin: humans (search, social, AI referrals, paid, email,
direct; 60% mobile) and AI shopping agents (ChatGPT, Claude, Perplexity, Gemini, Grok). Their drop-offs
follow the knobs in the config: fix a knob, re-seed, and that step improves.

```bash
node seed/seed.mjs --dry-run                          # print the modelled funnel, send nothing
node seed/seed.mjs --darwin http://localhost:3000     # 1200 humans + 120 agents, then 4 Darwin loop steps
node seed/seed.mjs --darwin https://darwin-production-7899.up.railway.app --token $DARWIN_ADMIN_TOKEN
node seed/seed.mjs --config presets/fixed.json --dry-run   # what the fixed store would do
```

Flags: `--humans`, `--agents`, `--hours` (spread over the last N hours, default 24), `--loop N` (Darwin
loop steps afterwards, default 4: observe → diagnose → propose → experiment), `--seed`, `--site`,
`--site-url`, `--config`, `--token`, `--import-baseline`, `--write-baseline <dir>`.

Every event is **synthetic** and labelled so (the rule in Darwin's AGENTS.md). The seed posts to Darwin's
`POST /api/simulate/events`, which always stamps `properties.synthetic = true` server-side, drops any
experiment claims, and is admin-gated like the rest of `/api/simulate`. (Darwin's public ingest routes
force `synthetic: false`, so a seed can't use them.) Events carry `spec_version` = the config's `version`,
so they count towards the Darwin generation the site is on.

With the Gen 0 config (seed 7): ~1% of humans and ~8% of agents buy; biggest leaks are "left product page
(Add to Bag below the fold)", agents giving up over missing delivery ETA / landed price / account
required, and checkout step 1 (account required). With `presets/fixed.json`: ~13% of humans, ~70% of agents.
These are modelled numbers, not evidence.

## 60-second demo script

1. **Before (10 s).** Open the Orchard store at `/products/orchard-phone-17-pro`: "Looks like a store you
   know. Where's Add to Bag?" Scroll: finish, storage, trade-in, care, box contents, comparison… it's at the
   very bottom. Add, open the bag: "Delivery: Calculated at checkout". Check out: "Create your Orchard ID".
2. **Darwin sees it (15 s).** `node seed/seed.mjs --darwin <darwin>` (or have it pre-seeded). Darwin →
   **Issues**: shoppers leaving product pages without adding, abandoning after shipping is revealed, the
   forced account step, AI agents giving up over missing delivery ETA and landed price. Humans and agents, separately.
3. **Fix (15 s).** **Fixes** / **Experiments**: Darwin proposes, e.g. "Sticky add-to-bag + reviews + delivery
   estimate" and "One-page guest checkout with express pay", and A/B tests them (simulated traffic, labelled).
4. **Ship (10 s).** **Changes** → the winner ships as a PR editing `storefront.config.json`. Merge it
   (or, offline: `/preview?config=fixed`).
5. **After (10 s).** Refresh Orchard: Add to Bag at the top plus a sticky bar, delivery date and free
   returns, shipping in the bag, one-page guest checkout with express pay, JSON-LD for agents. Re-seed with
   the new config and the funnel lifts.

## Exact local mode (owner's laptop only)

For rehearsals where the store must be indistinguishable from the real site:

```bash
npm run mirror        # downloads apple.com home, store and one buy page + their CSS/images/fonts into .mirror/
npm run dev:mirror    # http://localhost:3011 (also starts the Next app on :3001 for bag/checkout)
```

- `.mirror/` holds third-party copyrighted material. It is gitignored. **Never commit, push, deploy or
  share `.mirror/`, and never expose `dev:mirror` publicly.** It exists only to rehearse on your laptop.
- `mirror/mirror.mjs` renders each page in a headless browser (Playwright from this repo's `apps/web`, or
  one you install; `--raw` skips it), saves the rendered HTML with scripts stripped, and rewrites asset URLs
  to local copies. Videos aren't downloaded; tiles show their still image.
- `mirror/serve.mjs` injects `darwin.js`, `mirror/runtime.js` and a "Demo copy, not affiliated with Apple"
  note. The runtime reads `storefront.config.json` on every request and applies the same flaws: the buy
  page's summary and its button (renamed to `productPage.ctaText`) are moved below all the small print
  when `ctaPosition` is `below-description`, the "Free shipping" promise is hidden until
  `cart.showShippingUpfront`, delivery estimate / returns / trust badges / reviews appear with their knobs,
  the ribbon follows `announcement`, the hero button follows `hero.ctaText`. It sends the same funnel
  events. Add to Bag writes the Orchard bag and continues into the Orchard bag and checkout (proxied from
  the Next app), where the shipping and account flaws live.

## Files

```
storefront.config.json   Gen 0: the planted mistakes (Darwin's PageSpec)
presets/fixed.json       every fix applied, for /preview?config=fixed
app/                     pages: / /store /products/[slug] /bag /checkout /order/[id] /support, /api/catalog, /llms.txt, /preview
components/              nav, footer, buy flow, bag, checkout, SVG device renders, darwin.js tag
lib/                     page-spec schema, spec loader, catalog, tracking, agent view
seed/seed.mjs            synthetic humans + agents → Darwin
mirror/                  exact local mode (mirror.mjs, serve.mjs, runtime.js); output in .mirror/ (gitignored)
```
