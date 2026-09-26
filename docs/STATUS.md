# Darwin — status, what's left, and ideas for the next run

> **Every agent and every teammate updates this file at the end of every run** (see AGENTS.md → "After every run").
> Keep it honest: what works, what's left, what's limited. Newest run log entry on top.

Last updated: 2026-09-26 15:10 UTC (always-on watch)

---

## Brutal judge scorecard (1–10)

Scored against the hackathon brief: *behaviour → insight → page change → better outcome, for humans and AI agents*.

| Criterion | Score | Why | What moves it up next |
|---|---|---|---|
| Technical execution | 7 | A2A + MCP + ACP on one store, Bayesian A/B with rollback, GitHub PRs, OAuth, Whop webhook, 500+ tests, CI green | Nothing verified against **real** Whop / xAI / GitHub from the sandbox; in-memory state per server instance |
| Product thinking | 7 | One road: Issues → Fixes → Experiments → Changes; honest "who wrote it", rollback, no invented claims | Too many side pages; the lead-agent chat should be the front door |
| AI leverage & autonomy | 8 | Autopilot ships winners; Darwin's watch checks the store every 15 min and writes one Inbox line with a one-tap Ship / Stop that runs through the team; standing policies can allow a drastic action on autopilot | A real Grok key on stage; the watch has not been proven against a live store's traffic |
| Commerce innovation | 8 | A store that sells to AI agents three ways and optimises for them; agent checkout counted end to end | A real third-party agent buying live on the real Whop store |
| Real-world usefulness | 5 | Mostly simulated traffic; the demo store is a demo | Real Whop store + script-tag install on a real site + one real purchase |
| UX | 7 | Cream design system, mascots, real brand logos, mobile | Above-the-fold pass (in progress); readiness page still old dark style |
| Demo quality | 6 | Every screen has live data and empty states | Rewrite `docs/DEMO.md` on the new screens and rehearse; `?mock=1` offline fallback |

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
- **Done:** composer-only screen 1 (Connect your GitHub / Connect your Whop), Darwin asks what to track and where, repo dropdown, script-tag path (no GitHub), plan → install → live dashboards, progress survives reload. **Team intro** (new stage after Connect): Darwin, the only one you talk to, introduces Iris / Pixel / Fizz / Dash one by one; each wakes up from asleep and lists its real tools from `lib/team/roster.ts`, with the ask-first ones marked; skip button; reduced motion shows all at once. **New animated mascots** (`components/mascots/animated-mascot.tsx`, `public/mascots/`): Darwin is the red crowned leader; resting is calm (slow breathing, blinks, glances), and the big moves only play on events: tap → reaction, typing → Darwin thinks, steps → working, done → success. Specialists appear beside Darwin as the ones doing each step ("Iris is doing the reading").
- **Left to do:** set `GITHUB_OAUTH_CLIENT_ID/SECRET` on Vercel (the dropdown needs sign-in); detect the first real event after install and celebrate it; branch picker for the install PR; Shopify connect.
- **Limitations:** plans live in server memory; the install PR is a preview while the server's `GITHUB_TOKEN` is rejected (it is, today).
- **Next-run ideas:** "Whop OAuth" sign-in; auto-detect the store's platform from the URL; let the merchant ask Darwin a first question right in the team intro (stream `POST /api/team/chat` with `context.path=/onboarding`); swap the old `dw/mascot` crew on console screens for the animated set.
- **Limitations (team intro):** the intro script is fixed copy, not an LLM call (so it is instant and never wrong); the model chip shows the loop's model, which is "Built-in rules" until an OpenRouter key is set.

### Overview `/console`  ✅ (🟡 above-the-fold pass)
- **Done:** impact strip (before Darwin vs now, extra buyers per 1,000), Conversion / A vs B / Which agents buy / How they convert, live shoppers joined to the journey, Ask Darwin bottom-sheet chat (mobile sheet too). **Darwin's watch** strip: last check, what the team looked at, signals found vs messages sent, next check. A signal opens the Inbox (or the group chat the team used).
- **Left to do:** both card rows above the fold at 1440×900 (in progress); make the bottom chat the **lead agent on every screen** that can navigate and run any action (in progress, see Agent mode).
- **Limitations:** People rows need store traffic on (events route has no store-only filter); `?mock=1` chat answers from the server.
- **Next-run ideas:** a daily "what changed" digest card; pin a shopper journey to an issue.

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
- **Done:** autopilot, simulated shoppers, connections, Darwin's brain (model logo), who Darwin tests for, Grok teammate briefing preview + ship/stop, start over, demo mode. **Autonomy** card: off / suggest (default) / auto-safe / autopilot, plus a standing policy the merchant writes in plain English, compiled and read back before it counts.
- **Left to do:** "who to test for" is read-only. Slack, Discord and email adapters exist and stay off until their webhook or Resend key is set; they have not been sent to a real workspace from here.

### Store agent `/console/agents`  ✅ (🟡 chat above the fold)
- **Done:** the Whop store's own AI agent. Buyer agents buy three ways — chat (A2A `/a2a/whop`), tools (MCP `/api/store-agent/mcp`), checkout sessions (ACP `/acp/checkout_sessions`) — all in one funnel. A/B tests on the agent's pitch with autopilot. Demo payments count once per checkout.
- **Left to do:** chat + sales above the fold (in progress); run one **real** purchase on Vercel with `WHOP_API_KEY` + `WHOP_COMPANY_ID` + the webhook; ACP terms/policy links once Whop's terms URL is confirmed.
- **Limitations:** ACP sessions don't join the pitch A/B tests; lever copy + 97% bar mirrored client-side.

### Dashboards `/console/dashboards`  ✅ (🟡 above the fold)
- **Done:** dashboards built from the tracking plan, "Ask for a chart" in plain English, ink-only charts.
- **Left to do:** KPIs + funnel directly under the header (in progress).
- **Limitations:** plan + events in server memory.

### Personalize `/console/personalize`  ✅ (🟡 live tests above the fold)
- **Done:** per-source / per-search page changes on any store with darwin.js, A/B tested, heatmap, autopilot. **Never publishes invented claims** (`lib/web/claims.ts`); ideas needing a merchant fact become `[Your …]` drafts.
- **Left to do:** live-tests strip above the fold (in progress); a clear "fill in the blanks" UX for `[Your …]` placeholders.
- **Limitations:** rules a merchant started by hand aren't auto-retracted.

### Traffic `/console/traffic` (Pb1323)  ✅
- **Done:** where visitors come from (humans + AI agents), insights, restyled.
- **Left to do:** above the fold (in progress); the page polls every 4 s but `/api/traffic` can take ~5 s → add an in-flight guard.

### Demo storefront `/store` (teammates)  ✅
- **Done:** editorial Whop-catalog store (#34), working Search, Account page, newsletter sign-up, `WELCOME10` discount code, mobile.
- **Left to do:** "Already have an account? Sign in" is still a dead span; the PACE demo components hard-code "4.8/5 from 12,400+ runners" / "Rated 4.8 by 12,400 runners" (use real per-product ratings).

### Grok teammate (briefing)  ✅
- **Done:** `GET /api/briefing`, `POST /api/briefing/act`, `docs/GROK_BOT.md`, xAI → OpenRouter fallback.
- **Left to do:** set `XAI_API_KEY` on Vercel and run the real bot; a loop test can't be shipped from chat while running (needs `POST /api/loop/decide`). The always-on Inbox (`GET /api/team/inbox`, action tokens on `POST /api/team/chat`) is the path the bot should prefer; the hourly briefing still works.

### Lead agent: ⌘K, bottom chat, WebMCP  🟡
- **In progress:** one typed command layer (`src/lib/commands`) used by ⌘K, the bottom prompt-bar chat on every screen, and WebMCP (`navigator.modelContext`) so a browser agent can navigate, build dashboards, simulate traffic, roll back, draft personalizations, ship/stop tests. `window.darwin.run(name, input)` for automation.
- **Left to do:** every new user-facing action must be added as a command (rule in AGENTS.md).

### Agent team: Darwin + Iris, Pixel, Fizz, Dash (`lib/team`, `/api/team/**`)  🟡 (backend ✅, panel UI in progress)
- **Done:** Darwin (team lead) plans and delegates; specialists each have their own tools (roster in `lib/team/roster.ts`, registries in `lib/team/tools.ts`). Several parts of an ask run **concurrently** (max 3) in a group chat Darwin opens, with ≤140-char progress/tool messages, then Darwin reports in the merchant's chat. Specialists can `ask` a teammate once (depth 1). Every side-effecting tool (merge, commit/PR, publish rule, ship, autopilot, reset) posts a `confirm` message and runs only after the merchant approves (once). NDJSON stream `POST /api/team/chat`; `GET /api/team`, `GET /api/team/chats/[id]`, `POST /api/team/chats`; chats persisted in `.data/team-*.json`. No key → keyword routing with the same group chats and real tool results. Onboarding (`context.path = "/onboarding"`) gets a short team intro. Pixel/Dash can list/read repo files, commit to `darwin/*` branches, open, check and merge PRs (`lib/github/edit.ts`; dry-run/offline return previews). LLM: `runToolLoop` with native tool calling → JSON-protocol fallback → next provider; DeepSeek V4 Flash via OpenRouter by default, APINex for Pixel (`APINEX_EDITOR_MODEL`), hard tasks and overflow (`OPENROUTER_MAX_CONCURRENT`). **Always-on watch** (`lib/team/watch.ts`, `POST/GET /api/team/watch`): Iris and Fizz check in parallel through real tools (briefing decisions, real-traffic KPI band, AI-shopper funnel, PRs, readiness, research, a stuck loop, a 7-day follow-up). A notability gate (dedupe 24h, 1 message/hour, 6/day, quiet hours, daily digest) writes at most one line into a pinned Inbox chat. One-tap tokens are single-use, bound to the action, and expire in 24h; tapping runs through the team and the same confirm path. Autonomy off / suggest / auto-safe / autopilot; a standing policy is compiled, read back, and only fires once confirmed. Drastic actions (ship, merge, a live PR, publish, reset, payments/auth/CI) still need a tap or a matching policy. Channels: in-app Inbox always; Grok bot pulls `GET /api/team/inbox` when `DARWIN_GROK_BOT=1`; Slack/Discord/email only when their URL or key is set. Admin MCP `POST /api/team/mcp` (`team_ask`, `team_inbox`, `team_decide`) and A2A `GET /a2a/team/agent-card.json` (admin bearer). Vercel Cron every 15 min; `DARWIN_WATCH=1` starts an in-process interval. Commands: `watch.run`, `watch.inbox`, `autonomy.set`, `policy.add`, `policy.confirm`.
- **Left to do:** the bottom chat panel UI rendering chats/group chats/confirm buttons (other agent); wire `src/lib/commands` into ⌘K / the bottom chat / WebMCP (the registry exists, nothing calls it yet); the keyword path never marks tasks hard (only Darwin's LLM `delegate` does, per task).
- **Limitations:** live model calls were not verified here (the sandbox egress blocks openrouter.ai and api.apinex.bond), so messages are the heuristic voice; APINex tool calling is unverified (the JSON fallback covers it); heuristic splitting is keyword based ("A and B, then C"); history sent to the model is the last 12 text messages of the chat; one in-process semaphore and one watch lease (not shared across instances, so two Vercel instances can both speak); KPI bands need five prior real-traffic windows of 100+ visitors, so a new store stays quiet on KPIs; `/api/team/watch` is outside the admin proxy so Vercel Cron's `CRON_SECRET` can call it, and the route still checks the admin token or that secret.
- **Next-run ideas:** have the watch resume a half-finished group chat instead of opening a new one; share the lease across instances; let a confirmed policy name a maximum spend, not just a probability and a sample size.

### Agent readiness `/readiness`  ⬜ restyle
- **Done:** audit any store URL for AI shoppers.
- **Left to do:** still the old dark design — restyle to cream.

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

- **2026-09-26 UTC — team (always-on watch).** Darwin checks the store every 15 minutes (`POST /api/team/watch`, Vercel Cron, or `DARWIN_WATCH=1`), writes at most one Inbox line when something is worth a tap, and runs Ship / Stop through the team on a single-use token. Open: the command registry is not wired into the bottom chat yet; Slack/Discord/email stay off until configured; no live LLM in this sandbox.

- **2026-09-26 UTC — team (agent team backend).** Shipped `lib/team` (roster, per-agent tools, orchestrator with concurrent delegation, group chats, ask, confirm gate), `/api/team/**` NDJSON API, `runToolLoop` + OpenRouter/APINex routing in `lib/llm/client.ts` (default model now `deepseek/deepseek-v4.1-flash`), repo editing in `lib/github/edit.ts`. Open: panel UI, command-layer registration, live LLM check outside the sandbox.

- **2026-09-26 UTC — onboarding (main session).** Onboarding now talks only through Darwin (the new red crowned leader mascot), with a "Meet your team" stage that introduces the four specialists and their tools; the handoff's animated mascots are in `public/mascots` with a calm idle (`scripts/mascots/calm-idle.mjs`). Open: the console screens still use the old static crew.

- **2026-09-26 13:40 UTC — lead agent.** Redesign of every screen (PR #37), Grok teammate, ACP/MCP agent checkout, rollback, owner bug list fixed (double payments, invented claims, rejected GitHub token, RPV tile, mobile overflow, dead store buttons). In progress: above-the-fold pass, lead agent (⌘K / chat / WebMCP), brutal judge review.
