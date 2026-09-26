# PostHog extraction: what we took, how ingest maps, how to swap the pipeline

Darwin's analytics speak PostHog's wire protocol. The official `posthog-js` SDK posts straight into
our own `/ingest` endpoint, events land in our event store as `AnalyticsEvent` rows (PostHog-shaped),
and the summary/friction layer reads from there. Anything you extract from PostHog can plug in at the
three seams at the bottom of this page.

Researched against **posthog-js 1.434.14**, the version in `apps/web/package.json`
(`git clone --depth 1 https://github.com/PostHog/posthog-js`, commit `521bcd4`).

## What we took from PostHog

| What | From (posthog-js repo) | License | Where it lives here |
|---|---|---|---|
| Bot / crawler UA list (`DEFAULT_BLOCKED_UA_STRS`) | `packages/core/src/utils/bot-detection.ts` | MIT | `src/lib/analytics/classify.ts` (`POSTHOG_BLOCKED_UA_STRS`, attribution in the file) |
| The SDK itself (autocapture, rage clicks, pageviews, batching, retries) | npm `posthog-js` | Apache-2.0 AND MIT | runtime dependency, loaded by `src/lib/analytics/browser.ts` |
| Wire formats: encodings, payload shapes, query params | `packages/browser/src/request.ts`, `request-queue.ts`, `posthog-core.ts` | (read, not copied) | `src/lib/analytics/ingest.ts` |
| What remote config / flags responses the SDK needs | `remote-config.ts`, `entrypoints/external-scripts-loader.ts`, `posthog-featureflags.ts`, `autocapture.ts`, `browser-common/src/types/remote-config.ts` | (read, not copied) | `remoteConfig()`, `flagsResponse()`, `remoteConfigScript()` in `ingest.ts` |
| Server-side timestamp rule (`now - (sent_at - timestamp)`) | PostHog capture service behaviour | (reimplemented) | `resolveTimestamp()` in `ingest.ts` |
| `$elements_chain` format (for rage-click locations) | `browser-common/src/utils/autocapture-utils.ts` | (read, not copied) | `selectorFromChain()` in `summary.ts` |

On top of PostHog's list we added AI-specific categories (PostHog only knows 4 AI crawlers):
`ai_agent` (ChatGPT-User, Claude-User, Perplexity-User…), `ai_crawler` (GPTBot, ClaudeBot, CCBot,
Bytespider…), `automation` (HeadlessChrome, Playwright, webdriver), `http_client` (curl, axios…), `bot`
(PostHog's list), `declared` (`x-agent-name` header). Also honoured: Web Bot Auth `signature-agent`
header, and posthog-js's own `$browser_type: "bot"` (which includes `navigator.webdriver`).

## Wire formats (verified with real captures, see `src/lib/analytics/__fixtures__/`)

posthog-js with `api_host: "/ingest"` sends:

| Request | Body | How we decode |
|---|---|---|
| `POST /ingest/e?compression=gzip-js` (fetch, default) | gzip of JSON, `Content-Type: text/plain` | gzip sniffed by magic bytes `1f 8b` |
| `POST /ingest/e` (compression disabled) | JSON, `application/json` | JSON |
| `POST /ingest/e?compression=base64` (sendBeacon on unload) | `data=<urlencoded base64(utf8 JSON)>`, form-urlencoded | form → base64 → JSON |
| `POST /ingest/batch` (posthog-node) | JSON, optional `Content-Encoding: gzip` | same sniffing |
| `GET /ingest/e?data=…` (legacy pixel) | base64 JSON in query | base64 → JSON |

Payload shapes accepted: `{api_key, batch: [...], sent_at}` (what the modern SDK always sends to `/e`),
a bare array, or a single event. Each event is `{event, uuid, timestamp, properties: {distinct_id, token,
$session_id, $current_url, $pathname, $elements_chain, …}}`; posthog-node puts `distinct_id` at top level.
`lz64` (removed from the SDK years ago) is rejected with 400.

Other endpoints posthog-js calls:

| Endpoint | We return | Why it matters |
|---|---|---|
| `GET /ingest/array/<token>/config.js` | script setting `window._POSTHOG_REMOTE_CONFIG[token]` | loaded first on every page |
| `GET /ingest/array/<token>/config` | same config as JSON | fallback |
| `POST /ingest/flags?v=2`, `/ingest/decide` | no flags, `sessionRecording: false`, + config | flags API contract |
| `POST /ingest/s` (replay), `/i/v1/logs`, `/i/v1/metrics` | `{status: 1}`, dropped | SDK never errors |
| `GET /ingest/static/*.js` | 302 → `https://us-assets.i.posthog.com` (`POSTHOG_ASSET_HOST`) | only for lazy features we disable |

**Gotcha:** the remote config **must** contain `autocapture_opt_out: false`. Without it posthog-js keeps
autocapture (and therefore `$rageclick`) switched off. `hasFeatureFlags: false` makes it skip `/flags`.

**Gotcha:** Next.js redirects `/ingest/e/` → `/ingest/e` (308). Browsers follow it with the body (we
checked fetch and sendBeacon), but our `browser.ts` strips the slash with `rewriteRequestPath` to save the
round trip. External stores pointing posthog-js at Darwin can add `skipTrailingSlashRedirect: true`.

## How an ingested event maps to `AnalyticsEvent`

| AnalyticsEvent | From |
|---|---|
| `uuid` | event `uuid` (posthog's uuidv7); retries with the same uuid are deduped by the store |
| `event` | `event` (`$snapshot`, `$$heatmap`, `$performance_event` are dropped) |
| `distinct_id` | `distinct_id` → `properties.distinct_id` → `$device_id` → `"anonymous"` |
| `timestamp` | `now - (sent_at - timestamp)` (clock-skew corrected), else `now - offset`, else `now`; never future |
| `properties` | all PostHog props kept (`$current_url`, `$pathname`, `$session_id`, `$elements_chain`, `$browser_type`…); top-level `$set`/`$set_once` merged in |
| `properties.visitor_kind`, `agent_name`, `agent_category` | server-side classification (claims of being an agent are believed, claims of being human are verified) |
| `properties.$user_agent` | `$raw_user_agent` or the request UA |

The storefront (`browser.ts`) registers `experiment_id`, `variant`, `spec_version` as posthog super
properties, so autocaptured events are attributed too. It bootstraps posthog with our `darwin_id`
cookie and sets `opt_out_useragent_filter: true` (so headless agents are captured, then classified
server-side). The storefront fires `$pageview` itself, so posthog's `capture_pageview` is off (no double
counting); posthog captures `$pageleave`, so explicit `capture("$pageleave")` is dropped. Events
captured during `pagehide` (e.g. `checkout_abandoned`) go out immediately by beacon, because posthog's
own unload handler may already have drained its queue. If posthog-js fails to load, everything falls
back to `/api/capture`.

## Swapping in your own pipeline

Everything downstream only uses these (see `/AGENTS.md`), so replace behind them:

1. **`track(events)` / `eventStore()`** (`src/lib/analytics/store.ts`). Implement `EventStore`
   (`append`, `all`, `since`, `clear`) and return it from `eventStore()`. `/ingest`, `/api/capture`, the
   simulator and the agent API all write through `track()`.
2. **Mirror instead of replace.** `store.ts` calls `mirrorEvents()` on every append; the Supabase mirror
   (`src/lib/analytics/supabase.ts`) is the template: batched, fire-and-forget, never blocks the demo.
   Add a PostHog forwarder the same way if you want the real PostHog UI too (POST the batch to
   `https://eu.i.posthog.com/batch/` with your project key).
3. **`getAnalyticsSummary(filter)`** (`src/lib/analytics/summary.ts`). If you compute funnels elsewhere
   (HogQL, SQL on the `events` table), return the same `AnalyticsSummary` shape from
   `src/lib/contracts/analytics.ts`. `compareVariants(experimentId)` returns per-arm
   `{visitors, conversions, revenue}` overall and by kind (superset of `VariantStats`).

## Supabase (optional)

- Schema: `apps/web/supabase/migrations/0001_events.sql` — `public.events` (jsonb `properties` + generated
  columns for `visitor_kind`, `experiment_id`, `variant`, `spec_version`, `synthetic`, `revenue`…),
  indexes, RLS on with no policies (service role only), and an `events_funnel` view.
- Set `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and every appended event is upserted
  (batches of 500, retried, capped queue). `DARWIN_SUPABASE_MIRROR=0` switches it off. Reads stay in memory.

## Friction signals the summary derives

| kind | rule |
|---|---|
| `rage_click` | posthog `$rageclick`, or ≥3 `$autocapture` clicks on the same element within 2s. Location `"/store/products/[id] button#size-guide \"Size guide\""` |
| `shipping_shock` | `shipping_cost_revealed`, then `checkout_abandoned` or no `order_completed` |
| `dead_end` | `$pageleave` on a product page by a visitor who never added to cart |
| `agent_missing_field` | `agent_request.properties.missing[]`, grouped by field (location = most common tool) |
| `agent_error` | `agent_request` with `ok === false`, grouped by tool (detail = most common error) |
| `agent_abandoned` | `agent_abandoned.properties.reason`, grouped by reason (location = tool, or agent's last tool) |

`share` = distinct affected visitors / visitors of that audience. 200k events summarize in ~150–250ms.
