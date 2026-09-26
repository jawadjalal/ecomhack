# Darwin — agent & contributor guide

Read this before changing code (humans, Cursor, Claude — everyone).

## What we're building

**Darwin: the storefront that improves itself.** Connect a store's git repo → Darwin opens a PR installing
analytics → it watches how **humans and AI shopping agents** behave → finds conversion problems →
generates a page change → A/B tests it → ships the winner as a PR → repeats.

Demo loop (3 min): **behaviour → insight → page change → better outcome**, for both humans and bots.

## Layout

```
apps/web/                      Next.js 16 app (App Router, TS, Tailwind v4). Everything runs here.
  src/lib/contracts/           ★ Shared types. Changing these affects every module. Coordinate first.
  src/lib/catalog/             Demo catalog (PACE running shoes). Money = integer pence.
  src/lib/spec/                PageSpec: default (Gen 0), patch/diff, live store, per-visitor resolution.
  src/lib/experiments/         Experiment storage + sticky assignment.
  src/lib/analytics/           Event store, summary/funnels, human-vs-agent classification.
  src/lib/simulator/           Synthetic humans + AI shoppers that react to the PageSpec.
  src/lib/optimizer/           The loop: insights → proposals → experiments → decisions → ship.
  src/lib/agent-commerce/      Agent-facing store: REST tools, MCP server, A2A merchant agent, negotiation, llms.txt.
  src/lib/whop/                Whop connector (same API key as the Whop CLI) for onboarding.
  src/lib/github/              Connect repo, open analytics-install PR, open "ship winner" PR.
  src/lib/web/                 Web personalization for ANY store with darwin.js: rules, runtime.js, results, drafts.
  src/lib/tracking/            Tracking plans (what to record, from the merchant's words) and the dashboards built from them.
  src/lib/readiness/           Agent-readiness audit of any store URL (merchant tool): checks, SSRF-safe fetcher.
  src/lib/llm/                 Grok (xAI) / Claude / heuristic fallback.
  src/lib/db/json-store.ts     Tiny persisted KV (globalThis + .data/*.json).
  src/app/store/**             The demo storefront (what shoppers see).
  src/app/onboarding/**        First-run setup: prompt bar, connect Whop + GitHub, analytics PR, dashboards.
  src/app/console/**           Mission control (what judges see).
  src/app/api/**               HTTP API — see src/lib/contracts/api.ts for every route and shape.
```

## Ownership (one PR per area, to avoid merge conflicts)

| Area | Owns | Public API (keep stable) |
|---|---|---|
| scaffold | contracts, spec, experiments store, db, llm, proxy, `/api/capture`, `/api/spec` | everything in `contracts/` |
| analytics | `lib/analytics/**`, `/api/analytics/**`, `/ingest/**` | `getAnalyticsSummary`, `track`, `eventStore`, `classifyVisitor` |
| storefront | `app/store/**`, `components/store/**`, `public/products/**` | renders from `getVisitor().spec` |
| agent-commerce | `lib/agent-commerce/**`, `/api/agent/**`, `/api/mcp`, `/api/a2a`, `/llms.txt`, `/.well-known/**` | `callAgentTool`, `a2aSend`, `runA2aBuyer` |
| simulator | `lib/simulator/**`, `/api/simulate` | `simulateTraffic` |
| optimizer | `lib/optimizer/**`, `/api/loop/**`, `/api/experiments/**` | `getLoopState`, `stepLoop`, `setAutopilot`, `resetLoop` |
| github | `lib/github/**`, `/api/github/**` | `openAnalyticsInstallPR`, `openSpecPR` |
| web | `lib/web/**`, `/api/web/**`, `/demo/**`, `app/console/personalize`, `components/web/**` | `webState`, `buildRuntime`, `createRule`, `updateRule`, `draftRule`, `suggestRules`, `simulateWebTraffic` |
| readiness | `lib/readiness/**`, `/api/readiness`, `/api/leads`, `app/readiness/**`, `components/readiness/**` | `auditStore`, `evaluate` |
| console | `app/page.tsx`, `app/console/**`, `components/console/**` | — |
| onboarding | `app/onboarding/**`, `components/onboarding/**`, `lib/whop/**`, `/api/whop/**`, `public/onboarding/**` | `connectWhop`, `getWhopStatus` |
| tracking | `lib/tracking/**`, `/api/onboarding/**`, `/api/dashboards`, `app/console/dashboards`, `components/dashboards/**` | `heuristicPlan`, `amendPlan`, `getPlan`, `savePlan`, `computeDashboards`, `trackingDoc` |

Cross-module calls go through the public API above, never deep imports into another area.

## Conventions

- **Next.js 16**: read `apps/web/node_modules/next/dist/docs/` before using an API. `params`, `searchParams`,
  `cookies()`, `headers()` are async. Middleware is `src/proxy.ts`.
- Money is integer pence. Timestamps ISO-8601. Ids via `id("prefix")` from `lib/ids.ts`.
- Every event we write sets `properties.visitor_kind` (`human` | `agent`) and, when relevant,
  `experiment_id`, `variant`, `spec_version` (use `attributionProps()` from `lib/spec/resolve.ts`).
- Simulated traffic sets `properties.synthetic = true`. The console must label it. No faking results.
- LLM calls must have a heuristic fallback (`llmAvailable()`), so the demo runs with no API keys.
- No new dependencies without a reason in the PR description (they're pre-installed in the scaffold).
- Before pushing: `cd apps/web && npm run typecheck && npm run lint && npm test && npm run build`.

## Running

```bash
cd apps/web
cp .env.example .env.local   # all keys optional
npm install
npm run dev                  # http://localhost:3000  (console: /console, store: /store)
```

State lives in memory + `apps/web/.data/` (delete it to reset). Run a single process for the demo.
