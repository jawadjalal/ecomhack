# Darwin — status, what's left, and ideas for the next run

> **Every agent and every teammate updates this file at the end of every run** (see AGENTS.md → "After every run").
> Keep it honest: what works, what's left, what's limited. Newest run log entry on top.

Last updated: 2026-09-26 14:30 UTC (demo-mode agent, PR "Demo store mode")

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
| UX | 7 | Cream design system, mascots, real brand logos, mobile | Above-the-fold pass (in progress) |
| Demo quality | 7 | One story everywhere: /store is PACE and every console screen is about it, filled on boot with labelled simulated shoppers; onboarding has "Skip: explore with the demo store" | Rewrite `docs/DEMO.md` on the new screens and rehearse; `?mock=1` offline fallback |

**The one question judges will ask: "is any of this real?"** Answer on stage with a real Grok bot buying on the Whop store (`/a2a/whop`), then the Grok teammate messaging the merchant what it learned.

---

## Every part of the product

Status: ✅ done · 🟡 in progress · ⬜ not started

### Landing `/`  ✅
- **Done:** one screen, "Your store, improving itself.", live mini dashboard driven by the in-browser demo engine ("Live demo · simulated"), real AI-assistant logos.
- **Left to do:** official Whop logo in `public/brand/whop.svg`; OG image + meta for link previews; A/B test the landing headline with Darwin itself.
- **Limitations:** the mini dashboard is simulated by design (no real store behind the landing).
- **Next-run ideas:** "Watch Darwin fix a store in 30 s" autoplay mode; a readiness score input right on the landing.

### Onboarding `/onboarding`  ✅
- **Done:** composer-only screen 1 (Connect your GitHub / Connect your Whop), Darwin asks what to track and where, repo dropdown, script-tag path (no GitHub), plan → install → live dashboards, progress survives reload.
- **Left to do:** set `GITHUB_OAUTH_CLIENT_ID/SECRET` on Vercel (the dropdown needs sign-in); detect the first real event after install and celebrate it; branch picker for the install PR; Shopify connect.
- **Limitations:** plans live in server memory; the install PR is a preview while the server's `GITHUB_TOKEN` is rejected (it is, today).
- **Done (demo mode):** "Skip: explore with the demo store" under the composer: POST /api/demo (Gen 1 live + a test running on a fresh server), turns the console's simulated shoppers on, opens /console (waits at most 8 s).
- **Next-run ideas:** "Whop OAuth" sign-in; auto-detect the store's platform from the URL.

### Overview `/console`  ✅ (🟡 above-the-fold pass)
- **Done:** impact strip (before Darwin vs now, extra buyers per 1,000), Conversion / A vs B / Which agents buy / How they convert, live shoppers joined to the journey, Ask Darwin bottom-sheet chat (mobile sheet too).
- **Left to do:** both card rows above the fold at 1440×900 (in progress); make the bottom chat the **lead agent on every screen** that can navigate and run any action (in progress, see Agent mode).
- **Limitations:** People rows need store traffic on (events route has no store-only filter); `?mock=1` chat answers from the server.
- **Done (demo mode):** never empty with nothing connected: boot runs the loop to Gen 1 with a test live (fresh server) or sends one round of simulated shoppers (restart: the loop state is on disk, simulated events never were, which is why the live deploy showed "8.7% converts" next to "3 shoppers · 0 bought" and an all-0% funnel). "Demo store · Connect your site" note on every console page while no repo / darwin.js site is connected.
- **Left for the console-screens agent (files I must not touch):** lede says "Right now Darwin is <phase blurb>" while paused (`screens/overview.tsx`, check `autopilot`); Conversion card's SHOPPERS/BOUGHT come from `useSummary` while CONVERTS comes from the loop history, so they can disagree (label them or use one source); CardEmpty should offer "Explore with the demo store" (POST /api/demo) instead of only "Let Darwin run".
- **Next-run ideas:** a daily "what changed" digest card; pin a shopper journey to an issue; persist a compact per-generation summary so a restart doesn't need a refill round.

### Issues `/console/issues`  ✅ (🟡 above the fold)
- **Done:** issues ranked by buyers lost per 1,000 visits, who/where cards, real sessions that hit each one, the fix, deep links.
- **Left to do:** shorter summary cards so the detail is above the fold (in progress); humanise raw CSS selectors in rage-click issue titles.
- **Next-run ideas:** "Fix this now" button that drafts a fix for the selected issue.

### Fixes `/console/fixes`  ✅ (🟡 above the fold)
- **Done:** every fix with status, A→B settings in plain words, honest "written by" chip, results.
- **Left to do:** above-the-fold pass (in progress); edit a drafted fix before it's tested.
- **Limitations:** the 97.5% ship bar is mirrored client-side (not read from the optimizer).

### Experiments `/console/experiments`  ✅ (🟡 result strip above the fold)
- **Done:** A vs B storefronts rendered from the spec, chance-B-wins curve, who buys, what B changes, every test so far.
- **Left to do:** verdict strip above the fold (in progress); an API to stop / ship early (`POST /api/loop/decide`) so "Stop test" / "Ship B now" can be real buttons.

### Changes `/console/changes`  ✅
- **Done:** every shipped change, overall uplift, proof, "Live on your store" (+ PR only when GitHub is involved), **Roll back** (`POST /api/loop/rollback`, revert PR when GitHub is live). `/console/pulls` redirects.
- **Left to do:** decide whether a rollback returns to `idle` (current: watch the restored store first) or `observe`; test the revert PR against a real repo.
- **Limitations:** every PR is a dry-run preview until a valid `GITHUB_TOKEN` is set.

### Settings `/console/settings`  ✅
- **Done:** autopilot, simulated shoppers, connections, Darwin's brain (model logo), who Darwin tests for, Grok teammate briefing preview + ship/stop, start over, demo mode.
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

### Lead agent: ⌘K, bottom chat, WebMCP  🟡
- **In progress:** one typed command layer (`src/lib/commands`) used by ⌘K, the bottom prompt-bar chat on every screen, and WebMCP (`navigator.modelContext`) so a browser agent can navigate, build dashboards, simulate traffic, roll back, draft personalizations, ship/stop tests. `window.darwin.run(name, input)` for automation.
- **Left to do:** every new user-facing action must be added as a command (rule in AGENTS.md).

### Agent readiness `/readiness`  ✅
- **Done:** audit any store URL for AI shoppers; cream Darwin design at desktop and mobile: one-line hero with URL composer, "what agents need" intro, crew loading state, error card with retry / demo store; results = score dial + grade, what agents can do (Reach / Read / Buy meters), which assistants robots.txt lets in (real ChatGPT / Claude / Perplexity / Gemini glyphs, Siri as monogram), "Get certified by Grok" (from PR #36, restyled), prioritised fixes with copyable snippets, "Let Darwin fix these" → `/onboarding` plus email lead capture, every check by category, drafted llms.txt. Public certificate page `/readiness/certificate/[id]` and badge embed restyled to cream too.
- **Left to do:** register "check a store's agent readiness" as a lead-agent command once `src/lib/commands` lands on main; pass the audited URL into `/onboarding` so the merchant doesn't retype it.
- **Limitations:** the badge SVG (`/api/readiness/badge/[id]`) keeps its dark shields style on purpose (it sits on merchants' sites); "Siri" has no official glyph in `dw/brand-logos` so it shows a monogram; results aren't persisted (share link re-runs the audit, 10-min cache).
- **Next-run ideas:** a before/after preview ("with Darwin you'd score 95") computed from the fixable checks; re-check button that bypasses the cache (`?fresh=1`) after a merchant ships a fix; an OG image of the score for shared links.

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

- **2026-09-26 14:37 UTC — words + crew pass (subagent).** Crew names in the app: Iris (Watcher), Darwin (Lead), Theo (Designer), Ada (Tester), Max (Shipper), Mika (store agent). Plain words on Settings, Store agent, Dashboards, Personalize, Traffic, More menu and landing leftovers (no "A/B", "Gen N", "synthetic", "pull request", provider/model names; protocol names kept small and muted for judges). Open: lib-generated sentences (lever reasons, autopilot log, dashboard titles) still use some old words; Next-run idea: move those strings to a shared plain-words helper.
- **2026-09-26 14:30 UTC — demo-mode agent.** Demo store mode: /store is PACE end to end (no Whop strip / "STORE" brand), boot fills the console with labelled simulated shoppers (fresh → Gen 1 + test live; restart → one refill round), onboarding "Skip: explore with the demo store", "Demo store · Connect your site" note on every console page, dashboards default to the demo store's plan, North Trail seeded for Personalize/Traffic, Whop server key counts as connected, store agent never named `biz_…`, `explore_demo_store` assistant tool. Not touched (other agent's files): Overview lede while paused, conversion card sources, `roadmap.ts`. Still open: curl/headless hits on the agent API show as agent sessions.
- **2026-09-26 13:59 UTC — readiness agent.** `/readiness` + certificate page restyled to the cream design (hero, loading crew, error state, score / agents-can-do / fixes / CTA to onboarding, Grok certify panel from #36 kept and restyled); screenshots at 1440×900 and 390×844, no horizontal overflow. Open: readiness command for the lead agent, prefill onboarding with the audited URL.
- **2026-09-26 13:40 UTC — lead agent.** Redesign of every screen (PR #37), Grok teammate, ACP/MCP agent checkout, rollback, owner bug list fixed (double payments, invented claims, rejected GitHub token, RPV tile, mobile overflow, dead store buttons). In progress: above-the-fold pass, lead agent (⌘K / chat / WebMCP), brutal judge review.
