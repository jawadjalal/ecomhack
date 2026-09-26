# Darwin UI redesign plan

The cream app (`[data-dw]`, Outfit, tokens in `apps/web/src/app/globals.css`) repeats one pattern: a `PageHead`, then rows of pastel `Card` / `Panel` tiles (`rounded-[26px]`, mascot silhouette in a corner, `lg:grid-cols-[1.7fr_1fr]` or three equal-height tiles). Overview, Issues, Fixes, Experiments, Changes and Settings all do this, so the product reads as one bento grid with the labels swapped. The landing page then previews that same grid inside a tilted device (`components/dw/landing/mini-dashboard.tsx`).

This is a layout and styling change only. Do not change API routes, data shapes, hooks, or what a control does. Keep every link, button, empty state, and `aria-label`. Simulated traffic stays labelled.

## Shared direction

Keep the cream page (`#F7F1E5`), ink (`#141413`), Outfit, and DM Mono for numbers. Keep the mascots, but as small marks beside a heading, not 250px silhouettes bleeding out of a tile.

- **Type.** One huge number or sentence per page (64–84px, tracking `-0.04em`). Section titles 22px. Body 16–17px, colour `#6B665C`. No eyebrow labels in all-caps except a single 13px caption under a hero number.
- **Hierarchy without boxes.** A hairline (`border-dw-ink/10`) or vertical space (48–80px) separates sections. One yellow mark (`#F6D76B`) is allowed as a selection or underline, not as a card fill. Charts stay ink-only: solid = people / B, dashed = agents / A.
- **Surfaces.** `Card` and `Panel` accept a plain surface (see `PlainSurface` in `components/dw/ui.tsx`). Plain means no fill, no radius, no silhouette, no lift. Use it on redesigned screens. Do not restyle the PACE store (`app/store/**`) or the dark classic console (`/console/classic`); those are already different products.
- **Responsive.** Stack the split at `lg`. The Ask Darwin sheet (`overview/chat.tsx`) stays fixed to the bottom; shell padding `pb-40` stays.
- **Motion.** Keep existing `motion` entrances. Respect `prefers-reduced-motion` (already via `MotionConfig` / `useReducedMotion`).

## Per page

### `/` Landing — editorial split — **implement first**

File: `components/dw/landing/landing.tsx`. Preview: `components/dw/landing/mini-dashboard.tsx`, mounted by `components/console/landing-loop.tsx`.

**Hero:** left column, left-aligned, not a centred marketing stack. Headline stays “Your store, improving itself.” Subcopy stays “For the people and the AI agents who shop there.” Under that, one short paragraph and a vertical four-step list (Watch → Find the drop-off → Test a change → Ship the winner) separated by hairlines, not cards. Actions stay “Set up your store” → `/onboarding` and “Open Darwin” → `/console`. Nav stays Agent readiness (`/readiness`) and Demo store (`/store`). “Works with” keeps the existing brand glyphs.

**Secondary:** the right half is a full-bleed sand panel (`#EFE8D8`) holding the live demo. Drop the heavy 3D tilt and the device shadow when `embed` is set. Inside the preview, do not repeat the 2×2 pastel grid: one conversion number and sparkline on top, then a split (A vs B | agents + latest shoppers). Label it “Live demo · simulated” exactly as now.

### `/console` Overview + Ask Darwin — **second**

File: `components/dw/screens/overview.tsx`. Pieces: `overview/cards.tsx`, `overview/impact.tsx`, `overview/shoppers.tsx`, `overview/chat.tsx`.

**Hero:** the conversion rate as one giant number (the active chart tab), with the other tabs (shoppers, bought, since Darwin started) as small type beside it, and the existing generation chart as a sparkline under the number. No yellow tile, no fixed `lg:h-[276px]`.

**Strip:** `ImpactStrip` becomes a borderless row under the chart (people, agents, changes shipped, what Darwin is doing). Not a rounded card.

**Secondary:** a two-column split. Left is a single column with hairline dividers: A vs B, which agents buy, how they convert (the existing charts, plain). Right is the live shoppers list joined to the journey panel (already a split; leave the behaviour). Ask Darwin stays the bottom sheet, including suggestion chips.

Empty states and “Let Darwin run” stay.

### `/console/experiments` — split view — **third**

File: `components/dw/screens/experiments.tsx`.

**Primary:** a left rail, “Every test so far” (`PastExperiments`), sticky, only when there is more than one test. The selected row can keep the yellow highlight.

**Stage:** the chosen test’s name stays the page title. A and B are two columns divided by a hairline (storefront previews via `SpecMock`), not a white card and a yellow card. Under that, chance-B-wins is a wide chart and “who buys” sits beside it. “What B changes” is a table, not a card. Loading and empty states stay, without a pink empty tile.

### `/console/issues` — ranked list

File: `components/dw/screens/issues.tsx`. `BuyersLostCard` is a full-width hero (the number of buyers lost), not the left cell of a three-tile row. Who and Where sit in a quiet row under it (they are filters). The existing list + detail split stays and is the body of the page. Drop the fixed `lg:h-[250px]` row.

### `/console/fixes` — status rail + detail

File: `components/dw/screens/fixes.tsx`.

Do not open with three equal tiles. A narrow left column stacks In test → Up next → Thrown away → the fix list. The detail (`FixDetail`) is the wide right column and sticks. Same actions (draft, start test, watch the test).

### `/console/changes` — document + inspector

Files: `components/dw/screens/changes.tsx`, `experiments/changes-parts.tsx` (`UpliftCards`).

**Hero:** one number, extra buyers per 1,000, with the before/now pairs as a strip beside it. Not two cards (`1.7fr` / `1fr`).

**Body:** the timeline is the document; proof and diff are a sticky inspector on the right (`minmax(0,1fr)` / `380px`). Rollback, GitHub, and “where Darwin started” copy stay.

### `/console/settings` — one column

File: `components/dw/screens/settings.tsx`.

A single column, max width ~760px, sections separated by hairlines: Autopilot, Your store, Who Darwin tests for, Grok teammate, Start over, Demo mode. No alternating `1.7fr` / `1fr` rows. Every switch and snippet stays.

### Still to do (do not invent layouts; follow this)

| Route | File | Layout |
|---|---|---|
| `/console/agents` | `components/agents/agents-app.tsx` and `components/dw/agents/*` | Chat is the stage (full height). Connect, sales and tests are a right inspector, not four tiles. |
| `/console/dashboards` | `components/dashboards/dashboards-app.tsx` | One chart dominates; the rest is a list of series under it, not `dashboard-grid` tiles. |
| `/console/personalize` | `components/web/personalize-app.tsx` | Rule list on the left, preview on the right. Kill the `2xl:grid-cols-3` rule tiles. |
| `/console/traffic` | `components/traffic/traffic-app.tsx` | A table of visits. Summary numbers are a strip above the table, not tiles. |
| `/console/research` | `components/research/research-app.tsx` | A single report column. Sources are footnotes, not a `1.7fr/1fr` card row. |
| `/onboarding` | `components/onboarding/onboarding-app.tsx` | Keep the composer as the only hero. Later steps are a vertical timeline, not cards. |
| `/readiness` | `components/readiness/readiness-app.tsx` | The score is the hero. Checks are a checklist. The certificate is a document, not a lilac card. |
| `/store/**` | storefront | Already a shop. Leave it. |
| `/console/classic` | `components/console/console-app.tsx` | Already a dark three-column mission control. Leave it. |
| `/volt` | `components/volt/volt-home.tsx` | Separate brand. Leave it unless it copies the Darwin bento. |
| `/checkout/demo` | demo checkout | Leave the payment flow. |

`?mock=1` is the same screens with mock data (`TopNav` appends the query). Redesign the screen, not a second layout.

## How to keep it safe

- Thread plain styling through `PlainSurface` so charts, counts and buttons do not get rewritten.
- Tests assert behaviour, not these class names. If a test snaps markup, update the assertion to the same user-visible string.
- Before pushing: `cd apps/web && npm run typecheck && npm run lint && npm test && npm run build`.
- If a page is half-migrated at the deadline, revert only that page.
