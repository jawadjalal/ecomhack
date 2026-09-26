# Darwin — demo playbook (3 minutes)

> **One line:** Darwin is a storefront that improves itself. It watches how humans *and* AI shopping agents move
> through your store, finds where they drop, changes the page, proves the change with an A/B test, and ships the
> winner as a pull request. Then it does it again.

## Before you go on stage (T-10 min)

```bash
cd apps/web
npm run build && npm start          # production build; never demo on `next dev`
```

- [ ] Open **http://localhost:3000/console** in ONE tab (autopilot runs in the browser; two tabs = double speed)
- [ ] Press `r` (reset → confirm) so you start at Gen 0
- [ ] Optional keys in `.env.local` (restart after): `XAI_API_KEY` (Grok writes the insights and proposals; the LLM chip changes from "Heuristic"), `GITHUB_TOKEN` + `DARWIN_TARGET_REPO` (real PRs instead of dry-run cards)
- [ ] Second tab: http://localhost:3000/store (the store before Darwin touches it)
- [ ] Press `f` for fullscreen and check the evolution chart is readable from the back
- [ ] **Offline fallback:** http://localhost:3000/console?mock=1 runs the whole loop in the browser

Keys: `space` step · `a` autopilot · `t` traffic · `s` send a shopper · `r` reset · `f` fullscreen

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
| 2:35–3:00 | "Then it does it again. Autopilot. Humans get a better page, agents get a better API, and every change is a PR you review." | Press `a`. Point at the evolution chart: both lines climb, with one PR per generation, and rejected ideas are never retried. |

**Closing line:** "Darwin is CRO for the agentic web: it experiments on humans and AI shoppers, and ships the winners as code."

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
- **"What's agent-to-agent here?"** Buyer agents discover the store (`/llms.txt`, agent card), shop over MCP, and
  negotiate with Darwin's merchant agent within margin limits the optimizer can switch on.
- **"Business model?"** A share of the measured lift, or per-store pricing; agencies run it across client stores.
