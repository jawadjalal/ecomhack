# Darwin — status, what's left, and ideas for the next run

> **Every agent and every teammate updates this file at the end of every run** (see AGENTS.md → "After every run").
> Keep it honest: what works, what's left, what's limited. Newest run log entry on top.

Last updated: 2026-09-26 17:00 UTC (merge #57 UI redesign into main)

---

## Brutal judge scorecard (1–10)

Scored against the hackathon brief: *behaviour → insight → page change → better outcome, for humans and AI agents*.

| Criterion | Score | Why | What moves it up next |
|---|---|---|---|
| Technical execution | 7 | A2A + MCP + ACP on one store, Bayesian A/B with rollback, GitHub PRs, OAuth, Whop webhook, 500+ tests, CI green | Nothing verified against **real** Whop / xAI / GitHub from the sandbox; in-memory state per server instance |
| Product thinking | 7 | One road: Issues → Fixes → Experiments → Changes; honest "who wrote it", rollback, no invented claims | Too many side pages; the lead-agent chat should be the front door |
| AI leverage & autonomy | 7 | Autopilot ships winners, store agent A/B tests its own pitch, Grok teammate briefing ("want me to ship it?") | Lead agent that *acts* (⌘K / chat / WebMCP) — in progress; a real Grok key on stage |
| Commerce innovation | 8 | A store that sells to AI agents three ways and optimises for them; agent checkout counted end to end | A real third-party agent buying live on the real Whop store |
| Real-world usefulness | 5 | Mostly simulated traffic; the demo store is a demo | Real Whop store + script-tag install on a real site + one real purchase |
| UX | 7 | Cream type and mascots stay; landing, overview, experiments, issues, fixes, changes and settings no longer share one pastel bento. Agents, dashboards, personalize, traffic, research, onboarding and readiness still do. | Finish the pages listed in `docs/ui-redesign-plan.md` |
| Demo quality | 7 | One story everywhere: /store is PACE and every console screen is about it, filled on boot with labelled simulated shoppers; onboarding has "Skip: explore with the demo store" | Rewrite `docs/DEMO.md` on the new screens and rehearse; `?mock=1` offline fallback |

**The one question judges will ask: "is any of this real?"** Answer on stage with a real Grok bot buying on the Whop store (`/a2a/whop`), then the Grok teammate messaging the merchant what it learned.

---

## Every part of the product

Status: ✅ done · 🟡 in progress · ⬜ not started

### Landing `/`  ✅
- **Done:** editorial split (left: headline, four-step loop, actions; right: live demo on a sand panel, no tilted device). Mini dashboard is a conversion sparkline plus a split, not a 2×2 pastel grid. "Your store, improving itself.", "Live demo · simulated", real AI-assistant logos.
- **Left to do:** official Whop logo in `public/brand/whop.svg`; OG image + meta for link previews; A/B test the landing headline with Darwin itself.
- **Limitations:** the mini dashboard is simulated by design (no real store behind the landing).
- **Next-run ideas:** "Watch Darwin fix a store in 30 s" autoplay mode; a readiness score input right on the landing.

### Onboarding `/onboarding`  ✅
- **Done:** composer-only screen 1 (Connect your GitHub / Connect your Whop), Darwin asks what to track and where, repo dropdown, script-tag path (no GitHub), plan → install → live dashboards, progress survives reload. **Team intro** (new stage after Connect): Darwin, the only one you talk to, introduces Iris / Pixel / Fizz / Dash one by one; each wakes up from asleep and lists its real tools from `lib/team/roster.ts`, with the ask-first ones marked; skip button; reduced motion shows all at once. **New animated mascots** (`components/mascots/animated-mascot.tsx`, `public/mascots/`): Darwin is the red crowned leader; resting is calm (slow breathing, blinks, glances), and the big moves only play on events: tap → reaction, typing → Darwin thinks, steps → working, done → success. Specialists appear beside Darwin as the ones doing each step ("Iris is doing the reading").
- **Left to do:** set `GITHUB_OAUTH_CLIENT_ID/SECRET` on Vercel (the dropdown needs sign-in); detect the first real event after install and celebrate it; branch picker for the install PR; Shopify connect.
- **Limitations:** plans live in server memory; the install PR is a preview while the server's `GITHUB_TOKEN` is rejected (it is, today).
- **Done (demo mode):** "Skip: explore with the demo store" under the composer: POST /api/demo (Gen 1 live + a test running on a fresh server), turns the console's simulated shoppers on, opens /console (waits at most 8 s).
- **Next-run ideas:** "Whop OAuth" sign-in; auto-detect the store's platform from the URL; let the merchant ask Darwin a first question right in the team intro (stream `POST /api/team/chat` with `context.path=/onboarding`).
- **Limitations (team intro):** the intro script is fixed copy, not an LLM call (so it is instant and never wrong); the model chip shows the loop's model, which is "Built-in rules" until an OpenRouter key is set.

### Overview `/console`  ✅ (🟡 above-the-fold pass)
- **Done:** impact strip (before Darwin vs now, extra buyers per 1,000), Conversion / A vs B / Which agents buy / How they convert, live shoppers joined to the journey, Ask Darwin bottom-sheet chat (mobile sheet too). The four cards now sit in an even 2-up grid instead of the mirrored asymmetric (bento) 1.7fr/1fr layout. `CountUp`/`Grow` (`components/dw/overview/fx.tsx`) no longer replay their full entrance animation on every poll tick — they animate fully once on mount, then only glide briefly when the displayed value actually changes (or jump instantly if it's an unchanged/negligible refresh), which removes the constant bar-growing/number-counting jitter that live polling (`useSummary`/`useSessions`/`useExperiments`) used to cause every few seconds.
- **Left to do:** both card rows above the fold at 1440×900 (in progress); make the bottom chat the **lead agent on every screen** that can navigate and run any action (in progress, see Agent mode); the live feed (`MoneyFeed`, `useEventFeed`'s 230ms drain) still animates row reordering on a short interval — revisit if it still reads as jittery after this pass.
- **Limitations:** People rows need store traffic on (events route has no store-only filter); `?mock=1` chat answers from the server.
- **Done (demo mode):** never empty with nothing connected: boot runs the loop to Gen 1 with a test live (fresh server) or sends one round of simulated shoppers (restart: the loop state is on disk, simulated events never were, which is why the live deploy showed "8.7% converts" next to "3 shoppers · 0 bought" and an all-0% funnel). "Demo store · Connect your site" note on every console page while no repo / darwin.js site is connected.
- **Left for the console-screens agent (files I must not touch):** lede says "Right now Darwin is <phase blurb>" while paused (`screens/overview.tsx`, check `autopilot`); Conversion card's SHOPPERS/BOUGHT come from `useSummary` while CONVERTS comes from the loop history, so they can disagree (label them or use one source); CardEmpty should offer "Explore with the demo store" (POST /api/demo) instead of only "Let Darwin run".
- **Next-run ideas:** a daily "what changed" digest card; pin a shopper journey to an issue; persist a compact per-generation summary so a restart doesn't need a refill round.

### Issues `/console/issues`  ✅ (🟡 above the fold)
- **Done:** buyers-lost as a full-width figure, who/where as a quiet row, then the ranked list joined to the detail. Same ranking, sessions, fix, deep links.
- **Left to do:** shorter summary cards so the detail is above the fold (in progress); humanise raw CSS selectors in rage-click issue titles.
- **Next-run ideas:** "Fix this now" button that drafts a fix for the selected issue.

### Fixes `/console/fixes`  ✅ (🟡 above the fold)
- **Done:** in-test / up-next / thrown-away / list stacked in a narrow column, detail on the right. Status, A→B settings, "written by", results unchanged.
- **Left to do:** above-the-fold pass (in progress); edit a drafted fix before it's tested.
- **Limitations:** the 97.5% ship bar is mirrored client-side (not read from the optimizer).

### Experiments `/console/experiments`  ✅ (🟡 result strip above the fold)
- **Done:** test list as a left rail, A and B side by side without pastel tiles, chance curve and who-buys beside it, what-B-changes as a table.
- **Left to do:** verdict strip above the fold (in progress); an API to stop / ship early (`POST /api/loop/decide`) so "Stop test" / "Ship B now" can be real buttons.

### Changes `/console/changes`  ✅
- **Done:** extra buyers as the headline, before/now as a strip, timeline plus a sticky inspector. Proof, "Live on your store" (+ PR only when GitHub is involved), **Roll back** (`POST /api/loop/rollback`, revert PR when GitHub is live). `/console/pulls` redirects.
- **Left to do:** decide whether a rollback returns to `idle` (current: watch the restored store first) or `observe`; test the revert PR against a real repo.
- **Limitations:** every PR is a dry-run preview until a valid `GITHUB_TOKEN` is set.

### Settings `/console/settings`  ✅
- **Done:** one column (autopilot, store, audience, Grok teammate, start over, demo mode) instead of alternating card rows. Same controls.
- **Done (demo mode):** a WHOP_API_KEY on the server now counts as connected on boot (`connectServerWhop`), so Whop no longer reads "Not connected" while the store agent uses the key.
- **Left to do:** real notification channels (email / Slack) instead of the Grok bot only; "who to test for" is read-only.

### Store agent `/console/agents`  ✅ (🟡 chat above the fold)
- **Done:** the Whop store's own AI agent. Buyer agents buy three ways — chat (A2A `/a2a/whop`), tools (MCP `/api/store-agent/mcp`), checkout sessions (ACP `/acp/checkout_sessions`) — all in one funnel. A/B tests on the agent's pitch with autopilot. Demo payments count once per checkout.
- **Left to do:** chat + sales above the fold (in progress); run one **real** purchase on Vercel with `WHOP_API_KEY` + `WHOP_COMPANY_ID` + the webhook; ACP terms/policy links once Whop's terms URL is confirmed.
- **Done (demo mode):** the agent's name (A2A card, header) is the Whop business's title, never the raw `biz_…` id ("Whop store" if Whop gives no title).
- **Limitations:** ACP sessions don't join the pitch A/B tests; lever copy + 97% bar mirrored client-side. The catalog is whatever public plans the Whop business has (today one free "Website" plan on the default business): add real plans on Whop, Darwin won't invent them.

### Dashboards `/console/dashboards`  ✅ (🟡 above the fold)
- **Done:** dashboards built from the tracking plan, "Ask for a chart" in plain English, ink-only charts.
- **Left to do:** KPIs + funnel directly under the header (in progress).
- **Done (demo mode):** `/console/dashboards` with no `?site` redirects to `?site=pace-store` (next.config.ts), whose plan is built on the fly (`demoStorePlan`, not saved) from what /store records: KPIs, funnel, mobile vs desktop, humans vs agents, revenue.
- **Limitations:** plan + events in server memory. The demo plan has no sources/heatmap charts (the storefront doesn't send darwin.js page context).

### Personalize `/console/personalize`  ✅ (🟡 live tests above the fold)
- **Done:** per-source / per-search page changes on any store with darwin.js, A/B tested, heatmap, autopilot. **Never publishes invented claims** (`lib/web/claims.ts`); ideas needing a merchant fact become `[Your …]` drafts.
- **Left to do:** live-tests strip above the fold (in progress); a clear "fill in the blanks" UX for `[Your …]` placeholders.
- **Done (demo mode):** the demo site (North Trail) gets 400 labelled simulated visitors on boot when it has none, so the page opens with data.
- **Limitations:** rules a merchant started by hand aren't auto-retracted. North Trail is a second demo site (a darwin.js page), not PACE: Personalize is about sites that install darwin.js.

### Traffic `/console/traffic` (Pb1323)  ✅
- **Done:** where visitors come from (humans + AI agents), insights, restyled.
- **Left to do:** above the fold (in progress); the page polls every 4 s but `/api/traffic` can take ~5 s → add an in-flight guard.

### Demo storefront `/store` (teammates)  ✅
- **Done:** editorial store (#34), working Search, Account page, newsletter sign-up, `WELCOME10` discount code, mobile. **PACE end to end by default** (`lib/storefront/showcase.ts`): the Whop showcase used to rename the store "STORE" and add 8 unrelated Whop products (other creators', linking to whop.com) above the shoes, and made every page call Whop (1–4 s TTFB, images kept pages loading). `DARWIN_STORE_CATALOG=whop` brings the strip back for a Whop-only demo.
- **Left to do:** "Already have an account? Sign in" is still a dead span; the PACE demo components hard-code "4.8/5 from 12,400+ runners" / "Rated 4.8 by 12,400 runners" (use real per-product ratings).

### Grok teammate (briefing)  ✅
- **Done:** `GET /api/briefing`, `POST /api/briefing/act`, `docs/GROK_BOT.md`, xAI → OpenRouter fallback.
- **Left to do:** set `XAI_API_KEY` on Vercel and run the real bot; a loop test can't be shipped from chat while running (needs `POST /api/loop/decide`).

### Telegram  🟡
- **Done:** `POST /api/telegram` accepts Bot API updates. Chats in `TELEGRAM_ALLOWED_CHAT_IDS` go through `runAssistant` (the console assistant, `POST /api/assistant`): every message, same tools, yes/no before ship / autopilot / reset, tool summaries as text. With the allowlist empty, messages stay on `ask()` (`POST /api/ask`) and `/help` says tools are off. Secret header, one reply with the chat id when a chat is not listed, typing, MarkdownV2, 4096 split, `/start` and `/help`. History per chat (including a pending confirm) in the process KV, and in Supabase `telegram_chats` when configured (migration `0002`; errors fall back to memory). `npm run telegram:setup` and `GET /api/telegram` register the webhook.
- **Left to do:** set the three env vars on Vercel (put your chat id in the allowlist), apply `0002_telegram_chats.sql` if history should survive cold starts, register the webhook, send `/start`. `src/lib/status/roadmap.ts` is not on main, so the in-app "what's left" mirror was not updated.
- **Limitations:** without Supabase, history and an unanswered yes/no reset across serverless instances. An empty allowlist still lets any chat spend the LLM key on answers. Tool use requires the allowlist, so a public bot cannot step the loop.
- **Next-run ideas:** inline Yes/No buttons instead of a text reply; edit one message in place when the answer is long.

### Lead agent: ⌘K, bottom chat, WebMCP  🟡
- **In progress:** one typed command layer (`src/lib/commands`) used by ⌘K, the bottom prompt-bar chat on every screen, and WebMCP (`navigator.modelContext`) so a browser agent can navigate, build dashboards, simulate traffic, roll back, draft personalizations, ship/stop tests. `window.darwin.run(name, input)` for automation.
- **Left to do:** every new user-facing action must be added as a command (rule in AGENTS.md).

### Agent team: Darwin + Iris, Pixel, Fizz, Dash (`lib/team`, `/api/team/**`)  🟡 (backend ✅, panel UI in progress)
- **Done:** Darwin (team lead) plans and delegates; specialists each have their own tools (roster in `lib/team/roster.ts`, registries in `lib/team/tools.ts`). Several parts of an ask run **concurrently** (max 3) in a group chat Darwin opens, with ≤140-char progress/tool messages, then Darwin reports in the merchant's chat. Specialists can `ask` a teammate once (depth 1). Every side-effecting tool (merge, commit/PR, publish rule, ship, autopilot, reset) posts a `confirm` message and runs only after the merchant approves (once). NDJSON stream `POST /api/team/chat`; `GET /api/team`, `GET /api/team/chats/[id]`, `POST /api/team/chats`; chats persisted in `.data/team-*.json`. No key → keyword routing with the same group chats and real tool results. Onboarding (`context.path = "/onboarding"`) gets a short team intro. Pixel/Dash can list/read repo files, commit to `darwin/*` branches, open, check and merge PRs (`lib/github/edit.ts`; dry-run/offline return previews). LLM: `runToolLoop` with native tool calling → JSON-protocol fallback → next provider; DeepSeek V4 Flash via OpenRouter by default, APINex for Pixel (`APINEX_EDITOR_MODEL`), hard tasks and overflow (`OPENROUTER_MAX_CONCURRENT`). 18 tests.
- **Left to do:** the bottom chat panel UI rendering chats/group chats/confirm buttons (other agent); register team actions in the command layer once `src/lib/commands` lands on this branch; the keyword path never marks tasks hard (only Darwin's LLM `delegate` does, per task).
- **Limitations:** live model calls were not verified here (the sandbox egress blocks openrouter.ai and api.apinex.bond), so the live curl ran the heuristic path; APINex tool calling is unverified (the JSON fallback covers it); heuristic splitting is keyword based ("A and B, then C"); history sent to the model is the last 12 text messages of the chat; one in-process semaphore (not shared across instances).
- **Next-run ideas:** let Darwin resume a delegation after a confirm is approved (today the approving agent just reports the tool result); stream specialists' model tokens; show per-agent cost/latency; have Dash poll `pr_status` after a merge-able PR opens and ping the merchant.

### Agent readiness `/readiness`  ✅
- **Done:** audit any store URL for AI shoppers; cream Darwin design at desktop and mobile: one-line hero with URL composer, "what agents need" intro, crew loading state, error card with retry / demo store; results = score dial + grade, what agents can do (Reach / Read / Buy meters), which assistants robots.txt lets in (real ChatGPT / Claude / Perplexity / Gemini glyphs, Siri as monogram), "Get certified by Grok" (from PR #36, restyled), prioritised fixes with copyable snippets, "Let Darwin fix these" → `/onboarding` plus email lead capture, every check by category, drafted llms.txt. Public certificate page `/readiness/certificate/[id]` and badge embed restyled to cream too.
- **Left to do:** register "check a store's agent readiness" as a lead-agent command once `src/lib/commands` lands on main; pass the audited URL into `/onboarding` so the merchant doesn't retype it.
- **Limitations:** the badge SVG (`/api/readiness/badge/[id]`) keeps its dark shields style on purpose (it sits on merchants' sites); "Siri" has no official glyph in `dw/brand-logos` so it shows a monogram; results aren't persisted (share link re-runs the audit, 10-min cache).
- **Next-run ideas:** a before/after preview ("with Darwin you'd score 95") computed from the fixable checks; re-check button that bypasses the cache (`?fresh=1`) after a merchant ships a fix; an OG image of the score for shared links.

### Demo website: Orchard `demo-websites/apple-site/`  ✅
- **Done:** standalone Next.js store (port 3001) in the big-tile consumer-electronics layout (measured at 1440/390), fictional brand, SVG product renders, system fonts. Every knob from `storefront.config.json` (PageSpec), read per request. Gen 0 plants: Add to Bag below the description, no delivery/returns/trust, shipping revealed at the last checkout step, 3-step checkout with forced account and no express pay, agent-blind catalogue/JSON-LD. `presets/fixed.json` + `/preview?config=fixed` for before/after. darwin.js + funnel events + `data-darwin` selectors. `seed/seed.mjs` (humans + agents, all synthetic, `--import-baseline` via `POST /api/loop/baseline`) verified against a local Darwin. New `POST /api/simulate/events` (admin-gated, always `synthetic: true`). Local-only exact mirror (`npm run mirror`, `.mirror/` gitignored, never commit).
- **Left to do:** register the seed/baseline import as lead-agent commands; mirror mode only covers home, store and one buy page.
- **Limitations:** real darwin.js events from the site come in as `external` (no `spec_version`), so only seeded traffic feeds the loop's diagnose step; the optimizer playbook copy is PACE's (shoe wording) unless an LLM key is set.
- **Next-run ideas:** attribute external darwin.js events to the connected repo's spec version so real visitors count in Issues; a `store:"orchard"` filter in the console.

### Classic mission control `/console/classic`  ✅ (fallback)
- Kept as the original loop view and offline fallback (`?mock=1`).

---

## Platform limitations (fix before real merchants)

- **State lives in memory + `.data/`**: on Vercel each instance has its own state → demo from one process (`npm run build && npm start`) or move to Supabase (`lib/analytics/supabase.ts` mirror exists).
- **Admin gate is open by default** → set `DARWIN_ADMIN_TOKEN` on any public deploy.
- **GitHub token in the environment is rejected (401)** → set a valid `GITHUB_TOKEN` or configure OAuth; Darwin now says so instead of pretending.
- **Whop logo** is a placeholder (`public/brand/whop.svg`).
- **No outbound network in the build sandbox**: Whop, xAI and GitHub calls are tested with mocks only.

---

## Run log (newest first)

- **2026-09-26 17:00 UTC — merge #57 (UI redesign) into main.** Main had already redesigned the same screens after #57 branched (painted landing with timeline/crew sections, SummaryStrip + list/detail on Issues, Fixes, Experiments and Changes, #63's even 2-up Overview), so those screens keep main's layout and #57's versions of them were dropped, as were `issues/issue-cards.tsx` and `fix-cards.tsx` (deleted on main). Kept from #57: `PlainSurface` / `plain` on `Card` and `Panel` (no page uses it yet), Settings as one column, `overflow-x-clip` on the console shell, and `docs/ui-redesign-plan.md` as a plan for the pages still on tiles.
- **2026-09-26 — de-jitter the Overview + drop the bento grid.** The four Overview cards (Conversion/A vs B/Which agents buy/How they convert) moved from a mirrored asymmetric `1.7fr/1fr` "bento" grid to a plain even 2-up grid (`components/dw/screens/overview.tsx`). `CountUp` and `Grow` (`components/dw/overview/fx.tsx`) used to fully replay their entrance animation (long duration + per-index delay) on every live poll refresh (`useSummary` 3-4s / `useSessions` 5s / `useExperiments` 3s), which read as constant number-counting/bar-growing jitter; they now animate fully once on mount, then glide briefly only when the displayed value actually changed, or jump instantly on an unchanged/negligible refresh. `npm run typecheck && npm run lint && npm test` all green (895 tests). Still open: the live feed (`MoneyFeed` 1.5s trickle, `useEventFeed`'s 230ms drain interval) still animates row reordering on a short cadence — worth a look if jitter is still reported there.
- **2026-09-26 16:45 UTC — apple-site agent.** `demo-websites/apple-site/`: Orchard demo store (Next.js, :3001) with five PageSpec-driven conversion mistakes, darwin.js + funnel events, synthetic seed (humans + AI agents) verified on a local Darwin, local-only exact mirror mode, and `POST /api/simulate/events` so seeds are always labelled synthetic. Still open: lead-agent commands for seeding; real darwin.js events don't feed the loop (no spec_version on external events).
- **2026-09-26 15:25 UTC — merge #42 into #46.** Crew registry (`lib/crew`), assistant personas and crew tabs use Pixel / Fizz / Dash (ids theo / ada / max stay; `pixel`, `fizz`, `dash` are aliases). Each loop page's start button names its own agent ("Let Iris watch", "Let Pixel draft a fix", "Let Fizz run the test", "Let Dash ship winners"); Darwin's own actions (Overview start, top-nav autopilot) are in his yellow. #46's team loop moved to `lib/llm/team.ts` on top of main's client (OpenRouter first, timeouts, cooldowns). Left: the team loop and the assistant loop are still two loops; merge them next run.
- **2026-09-26 15:15 UTC — merge #46 into main.** One crew naming everywhere: Darwin (Lead), Iris (Watcher), Pixel (Designer), Fizz (Tester), Dash (Shipper); Mika (store agent) and Grok (teammate) unchanged. Main's redesigned screens kept; `components/dw/mascot.tsx` renders the animated set with the same API.
- **2026-09-26 15:25 UTC — screenshot-audit regressions.** Console header fits 1280–1536 with nothing clipped (below 1536: store chip says "Demo store"/"Demo site", ⌘K and Live are icon-only, nav padding tighter; below 1280 the step pill takes its own row; checked with Playwright: nav scrollWidth = clientWidth, no overlaps). DemoBadge no longer mounts in the console: the header StoreChip (pill, phone bar) is the one demo indicator. Landing: `Reveal` and the closing/timeline reveals stay opaque at rest (only a small rise animates), so full-page renders show every section; phone "Open Darwin" is a cream pill, "Sells to AI shoppers" sits on a dark tint, the second phone sticker moved off the link. Onboarding: "Skip…" links are cream pills, "4 steps · about 2 minutes" and "Try" sit on a dark tint. Still open: a very long connected host name can still truncate in the header chip below 1536px.
- **2026-09-26 15:30 UTC — fleek-site mistakes.** Rackd Gen 0: stock is now a visible gap (buy box shows nothing until `productPage.urgency: low-stock`, which prints the real stock count, not only "Only N left"). Checked a real local loop run from Rackd's `storefront.config.json`: 5 generations shipped (agent stock, 1-page guest checkout + express pay, agent ETA + JSON-LD, sticky ATC + reviews + delivery estimate, shipping in cart + free-shipping threshold). Open: playbook copy is PACE's ("free UK delivery over £60" on £100+ bundles); no newsletter-popup or low-contrast-CTA lever, so those mistakes were not planted.
- **2026-09-26 16:10 UTC — fleek-site agent.** `demo-websites/fleek-site/`: Rackd, a Fleek-layout wholesale store (Next.js, port 3002) whose conversion flaws all come from `storefront.config.json` (PageSpec), with darwin.js, funnel events, seed script, and a gitignored local-only exact mirror (`npm run mirror`, never commit `.mirror/`). New `POST /api/loop/baseline` imports a connected repo's config as Gen 0, so the ship PR doesn't write the PACE store's copy. Seed verified against a local Darwin (issues, a proposal and a test show up; real darwin.js events arrive). Still open: the lead-agent command for the baseline import isn't registered, and `roadmap.ts` isn't updated (not on main).
- **2026-09-26 15:05 UTC — install consistency.** One darwin.js tag everywhere: `installSnippet()` in lib/github (DARWIN_PUBLIC_URL, else request origin) feeds onboarding's plan response, Personalize (`install` on `GET /api/web/rules`, no more `window.location` or second `runtime.js` tag), the install PR and llms.txt. One site-id helper (`siteIdForUrl`, www/case-insensitive) and one site list (plans ∪ rules ∪ event sites) for Personalize and Traffic. Personalize's install card says Waiting for first event / Installed / Verified. Still open: onboarding's client fallback and Settings' `scriptTagFor` still build tags client-side; Dashboards/onboarding don't use the shared status words yet.
- **2026-09-26 15:00 UTC — telegram.** Allowlisted Telegram chats now call `runAssistant` (same tools as the console assistant): step the loop, experiments, ship, autopilot, reset, with yes/no before side effects. Empty allowlist stays answer-only via `ask()` and `/help` says so. Still open: set the allowlist on Vercel.
- **2026-09-26 14:45 UTC — telegram.** Text Darwin from Telegram through the Overview Ask Darwin chat (`ask` / `POST /api/ask` from merged PR #37), not a second assistant. Webhook secret, chat allowlist, typing, MarkdownV2, 4096 split, per-chat history (KV, Supabase when configured). Still open: set env on Vercel and register the webhook; not connected to the tool-using `/api/assistant` (PR #36). `roadmap.ts` is not on main.
- **2026-09-26 14:37 UTC — words + crew pass (subagent).** Crew names in the app: Iris (Watcher), Darwin (Lead), Pixel (Designer), Fizz (Tester), Dash (Shipper), Mika (store agent). Plain words on Settings, Store agent, Dashboards, Personalize, Traffic, More menu and landing leftovers (no "A/B", "Gen N", "synthetic", "pull request", provider/model names; protocol names kept small and muted for judges). Open: lib-generated sentences (lever reasons, autopilot log, dashboard titles) still use some old words; Next-run idea: move those strings to a shared plain-words helper.
- **2026-09-26 UTC — mascots (main session).** Every screen now uses the animated team mascots: `components/dw/mascot.tsx` keeps its API but renders the animated SVGs (same body size, so no layout moved). Darwin is the crowned leader everywhere the purple disc stood for him (logo, chats, empty states, "Built-in rules"); the loop crew on Issues reads Iris · Darwin · Pixel · Fizz · Dash; Darwin thinks while the bottom chat, the Overview chat, dashboards and traffic wait on an answer; clicking any mascot plays its tap reaction; `active={false}` holds a still pose. Favicon, `icon.svg` and `apple-icon.png` are Darwin's crowned logo. Open: shopper/buyer avatars still borrow crew shapes (e.g. a ChatGPT buyer shows the shipper diamond); the analyst disc is only a persona avatar now.
- **2026-09-26 UTC — team (agent team backend).** Shipped `lib/team` (roster, per-agent tools, orchestrator with concurrent delegation, group chats, ask, confirm gate), `/api/team/**` NDJSON API, `runToolLoop` + OpenRouter/APINex routing in `lib/llm/client.ts` (default model now `deepseek/deepseek-v4.1-flash`), repo editing in `lib/github/edit.ts`. Open: panel UI, command-layer registration, live LLM check outside the sandbox.
- **2026-09-26 UTC — onboarding (main session).** Onboarding now talks only through Darwin (the new red crowned leader mascot), with a "Meet your team" stage that introduces the four specialists and their tools; the handoff's animated mascots are in `public/mascots` with a calm idle (`scripts/mascots/calm-idle.mjs`). Open: the console screens still use the old static crew.
- **2026-09-26 15:25 UTC — UI redesign.** Landing, overview, experiments, issues, fixes, changes and settings no longer share the pastel bento (`docs/ui-redesign-plan.md`). Plain surface on `Card`/`Panel`. Still the old tile layout: agents, dashboards, personalize, traffic, research, onboarding, readiness. Storefront and classic console left as they are. `src/lib/status/roadmap.ts` is not in the tree. (Superseded in part by main's redesign; see the merge entry above.)
- **2026-09-26 14:30 UTC — demo-mode agent.** Demo store mode: /store is PACE end to end (no Whop strip / "STORE" brand), boot fills the console with labelled simulated shoppers (fresh → Gen 1 + test live; restart → one refill round), onboarding "Skip: explore with the demo store", "Demo store · Connect your site" note on every console page, dashboards default to the demo store's plan, North Trail seeded for Personalize/Traffic, Whop server key counts as connected, store agent never named `biz_…`, `explore_demo_store` assistant tool. Not touched (other agent's files): Overview lede while paused, conversion card sources, `roadmap.ts`. Still open: curl/headless hits on the agent API show as agent sessions.
- **2026-09-26 13:59 UTC — readiness agent.** `/readiness` + certificate page restyled to the cream design (hero, loading crew, error state, score / agents-can-do / fixes / CTA to onboarding, Grok certify panel from #36 kept and restyled); screenshots at 1440×900 and 390×844, no horizontal overflow. Open: readiness command for the lead agent, prefill onboarding with the audited URL.
- **2026-09-26 13:40 UTC — lead agent.** Redesign of every screen (PR #37), Grok teammate, ACP/MCP agent checkout, rollback, owner bug list fixed (double payments, invented claims, rejected GitHub token, RPV tile, mobile overflow, dead store buttons). In progress: above-the-fold pass, lead agent (⌘K / chat / WebMCP), brutal judge review.
