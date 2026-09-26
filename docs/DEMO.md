# Darwin — demo playbook (3 minutes)

> **One line:** Darwin is a storefront that improves itself. It watches how humans *and* AI shopping agents move
> through your store, finds where they drop, changes the page, proves the change with an A/B test, and ships the
> winner as a pull request. Then it does it again.

## Before you go on stage (T-10 min)

```bash
cd apps/web
npm run build && npm start          # production build; never demo on `next dev`
# On a LAN/public URL, set DARWIN_ADMIN_TOKEN first and open /console?key=<token> once (sets a cookie)
```

- [ ] Open **http://localhost:3000/console** in ONE tab (autopilot runs in the browser; two tabs = double speed)
- [ ] Press `r` (reset → confirm) so you start at Gen 0
- [ ] Optional keys in `.env.local` (restart after): `XAI_API_KEY` (Grok writes the insights and proposals; the LLM chip changes from "Heuristic"), `GITHUB_TOKEN` + `DARWIN_TARGET_REPO` (real PRs instead of dry-run cards)
- [ ] Second tab: http://localhost:3000/store (the store before Darwin touches it)
- [ ] Press `f` for fullscreen and check the evolution chart is readable from the back
- [ ] **Offline fallback:** http://localhost:3000/console?mock=1 runs the whole loop in the browser

Keys: `space` step · `a` autopilot · `t` traffic · `s` send a shopper · `b` before/after · `r` reset · `f` fullscreen

## The script

| Time | Say | Do |
|---|---|---|
| 0:00–0:20 | "Every store leaks. And more and more shoppers aren't people: they're agents from Grok, ChatGPT and Claude. Nobody optimizes for them." | Show the PACE store tab. |
| 0:20–0:40 | "You connect your repo. Darwin opens a PR that installs analytics for humans *and* agents." | Console → **Connect & open PR** → scroll the PR (detected Next.js, file diff) → **Start watching shoppers**. |
| 0:40–1:00 | "Traffic comes in: people in the browser, agents over MCP. Everything simulated is labelled." | Press `t`. Point at the live feed: 🧑 rows and 🤖 rows, e.g. *"grok-shopper abandoned: no delivery ETA exposed"*. Press `s` to send one shopper and show its tool calls. |
| 1:00–1:20 | "Darwin's analyst finds the leaks, with numbers." | `space` → Observe, `space` → **Diagnose**: insight cards, e.g. *"92% of AI shoppers asked for stock levels: we don't expose it"*. |
| 1:20–1:45 | "Its designer proposes a change as a safe, reviewable config diff. Here's the before and after, live." | `space` → **Propose**: config diff + the two live store previews side by side. |
| 1:45–2:15 | "It proves it with an A/B test, on the audience that can actually see the change." | `space` → **Experiment**: A vs B bars, P(beat) gauge climbing past the 97.5% ship line → **Decide: SHIP**. |
| 2:15–2:35 | "And it ships like an engineer would: a pull request, with the evidence." | `space` → **Ship**: PR card (title with lift and P). |
| 2:35–2:50 | "Then it does it again. Autopilot. Every change is a PR you review, and rejected ideas are never retried." | Press `a`. Point at the evolution chart: both lines climb, with one PR per generation. |
| 2:50–3:00 | "Here's the store you connected, and the store Darwin built: humans get a better page, agents get a better API." | Press `b`: **Before / after**. Gen 0 vs live side by side (opens on the page that changed most), the conversion multiples and the list of shipped PRs. |

**Optional wow moment (+20s): a judge buys on their phone.** Before the demo, run the server on the LAN
(`npm start -- -H 0.0.0.0`) and put a QR code for `http://<laptop-ip>:3000/store` on a slide (same Wi-Fi).
When a judge buys something, it lands in the live feed pinned under **"Real visitors · just now"** with a green
REAL tag, next to the synthetic traffic, and goes into the same analytics and experiments.

### Optional: a real AI agent buys

The store is a standard MCP server, so a real agent can shop it live. Connect one before going on stage:

```bash
# Cursor: Settings → MCP → Add new server (or ~/.cursor/mcp.json)
{ "mcpServers": { "pace-store": { "url": "http://localhost:3000/api/mcp" } } }

# Claude Code
claude mcp add --transport http pace-store http://localhost:3000/api/mcp

# Claude Desktop (bridges stdio → HTTP)
{ "mcpServers": { "pace-store": { "command": "npx", "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp"] } } }
```

Prompt: *"Use the pace-store tools to buy me waterproof trail shoes, UK 10, under £150 delivered. I need them within
4 days, so check stock and delivery time first."*

- **On stage:** the agent's session jumps to the front of the **Agent-to-agent** panel with a green REAL tag, and each
  tool call appears live. On Gen 0 the store hides stock and delivery time: `check_availability` answers "not exposed"
  (red chip) and fields the agent asks for via `want` come back under `missing` (amber chip).
- **Line to say:** "That's Cursor shopping our store. At Gen 0 it can't see stock or delivery time. Watch what happens
  after Darwin ships the agent-surface fix." Run it again after Gen 1: the same prompt gets real answers.

### Agent-to-agent in one click (A2A)

Press `s`, switch the box to **Chat (A2A)**, keep the brief ("… delivered by Friday") and **Send**. A buyer agent
talks to PACE's merchant agent in plain English, and the chat appears in the **Agent-to-agent** panel.

- **At Gen 0:** the merchant can't share delivery times, so the buyer walks: *"No thanks: I need it within 6 days and
  you can't confirm delivery times."*
- **After Darwin ships the delivery-ETA change:** send the same brief again and the buyer buys. With "best price" in
  the brief and negotiation on, it haggles first.
- **Line to say:** "Same buyer, same brief. The only difference is what Darwin shipped."

### Optional: agent-to-agent in a terminal

`npx tsx scripts/a2a-buyer.ts --url http://localhost:3000 --brief "trail shoes UK 10 under £150 by Friday"` runs a
buyer agent that talks to the merchant agent over A2A. The conversation prints in the terminal and appears as chat
bubbles in the **Agent-to-agent** panel (tagged A2A). The script labels itself synthetic; any other A2A client
pointed at `http://localhost:3000` (it reads the agent card) shows as REAL.

**Closing line:** "Darwin is CRO for the agentic web: it experiments on humans and AI shoppers, and ships the winners as code."

### Personalize any store (45 s)

Open `/console/personalize` (top bar → **Personalize**). The preview is `/demo/north-trail`, a plain-HTML store with
only the darwin.js tag.

1. Click the example **"Visitors from ChatGPT: banner…"** → Darwin drafts it → **Preview** shows the banner as an AI
   visitor → **Start A/B test**.
2. Click **"Google searchers: put their search in the headline"** → **Start A/B test**. Switch "View the page as" to
   **Search**: the headline reads "Waterproof Trail Shoes: in stock, ships today". **Original page** shows it unchanged.
3. **Send 500 test visitors** two or three times (labelled synthetic) → the tests fill with results and a chance-to-beat.
4. Line: *"Same loop, but on any store: one script tag, and the page adapts to where each shopper came from."*

## What typically happens (heuristic mode)

- **Gen 1 (usually an agent-surface fix):** exposing stock or delivery ETA takes agent conversion from about 40% to 60–70%.
- **Gen 2 (a human fix):** e.g. one-page guest checkout, about +25%.
- **A wildcard gets rejected:** low-stock urgency or bold hero copy. That's a good moment to say "it doesn't ship vibes".
- **After about 3 minutes of autopilot:** humans are at about 2.1% → 4–5%, agents at about 41% → 85%+.

## If something breaks

| Symptom | Recovery |
|---|---|
| Console shows "Simulated API" chip | An endpoint failed and the console switched to mock mode itself; carry on |
| Everything is broken | `/console?mock=1` (same UI, in-browser loop) |
| Experiment inconclusive | That's a real outcome; say so, press `space` for the next idea |
| LLM slow / erroring | Remove the key and restart; the heuristic playbook is instant |
| GitHub errors | PR cards fall back to dry-run previews automatically |
| State weird | `r` to reset |

## Likely judge questions

- **"Is the traffic real?"** In the demo it's simulated and labelled synthetic everywhere, because we can't wait a week
  for real traffic on stage. The simulator reacts *only* to the page each visitor is served, so a change has to actually
  help to win. `GET /api/simulate` returns the behaviour model. Real traffic flows through the same pipeline:
  posthog-js posts to our PostHog-compatible `/ingest`.
- **"How do you avoid shipping noise?"** A Bayesian A/B test with a stricter bar for early stops (99.5% before the final
  round, 97.5% at the end). Human-only changes are judged on humans and agent-only changes on agents. Losers are never
  retried.
- **"Why a PageSpec instead of letting the AI edit code?"** Safety and reviewability. Every change is validated,
  diffable, reversible and A/B testable, and it still ships as a normal PR editing `storefront.config.json`.
- **"How do you tell agents from humans?"** Declared agent headers, the MCP/REST surface, and PostHog's crawler list
  split into AI agents, AI crawlers and automation.
- **"What's agent-to-agent here?"** Buyer agents discover the store (`/llms.txt`, `/.well-known/agent-card.json`)
  and either call its tools over MCP or talk to PACE's merchant agent over **A2A** (v1.0 and v0.3, verified with the
  official `@a2a-js/sdk`) in plain English: brief → shortlist → haggle within margin → order. Every conversation goes
  through the same tracked, spec-aware store, so when Darwin exposes delivery times, the merchant agent can finally
  answer "will it arrive by Friday?".
- **"Business model?"** A share of the measured lift, or per-store pricing; agencies run it across client stores.
