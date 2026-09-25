# Darwin — demo playbook (3 minutes)

> **One line:** Darwin is a storefront that improves itself. It watches how humans *and* AI shopping
> agents move through your store, finds where they drop, changes the page, proves the change with an
> A/B test, and ships the winner as a pull request. Then it does it again.

## Before you go on stage (T-10 min)

- [ ] `cd apps/web && npm run build && npm start` (single process; don't demo on `next dev`)
- [ ] `XAI_API_KEY` set if you want Grok copy in proposals (otherwise "Heuristic" badge; still works)
- [ ] `GITHUB_TOKEN` + `DARWIN_TARGET_REPO` set if you want *real* PRs (otherwise dry-run cards)
- [ ] Console → **Reset** (clears events, spec back to Gen 0)
- [ ] Open three tabs: `/console` (fullscreen, `f`), `/store`, GitHub PR list
- [ ] Browser zoom so the loop ring + evolution chart are readable from the back
- [ ] Offline fallback: `/console?mock=1` runs the whole loop in the browser

## The script

| Time | Say | Do | Judging criteria it hits |
|---|---|---|---|
| 0:00–0:20 | "Every store has leaks. And half your shoppers soon won't be human — they'll be agents from Grok, ChatGPT, Claude. Nobody optimizes for them." | Show `/store` (PACE running shoes). | Product thinking, commerce innovation |
| 0:20–0:40 | "You connect your repo. Darwin opens a PR that installs analytics for humans *and* agents." | Connect-repo modal → PR card (real or dry-run). | Real-world usefulness |
| 0:40–1:10 | "Traffic comes in. Humans in the browser, agents over MCP." | Toggle **Traffic**. Point at the live feed: 🧑 rows and 🤖 rows, e.g. "grok-shopper abandoned: no delivery ETA". | Technical execution, agent-to-agent |
| 1:10–1:40 | "Darwin's analyst finds the leaks." | **Step** to *diagnose*: insight cards, e.g. "58% of carts die when shipping appears", "41% of agents leave: no delivery ETA". | AI leverage |
| 1:40–2:10 | "Its designer proposes a change, as a safe, reviewable config diff." | *propose*: hypothesis, diff, before/after previews side by side. | UX, autonomy |
| 2:10–2:35 | "It proves it with an A/B test." | *experiment*: A vs B bars, P(beat) climbing past 95%. *decide*: **SHIP**. | Technical execution |
| 2:35–2:50 | "And ships it like an engineer would: a pull request." | *ship*: PR card → open it on GitHub. | Real-world usefulness |
| 2:50–3:00 | "Then it does it again. Autopilot." | Toggle **Autopilot**; point at the evolution chart climbing for humans and agents. | Demo quality |

**Closing line:** "Humans get a better page. Agents get a better API. The store gets better every generation, and you review every change as a PR."

## If something breaks

| Symptom | Recovery |
|---|---|
| Console blank / API errors | Switch to `/console?mock=1` (same UI, in-browser loop) |
| Experiment stays inconclusive | Press **Step** again (next round of traffic) or Autopilot |
| LLM slow or down | Unset keys → heuristic mode (instant) |
| GitHub rate-limited | Dry-run PR card still shows title, body and diff |
| State weird | **Reset** (`r`) |

## Likely judge questions

- **"Is the traffic real?"** In the demo it's simulated, and labelled *synthetic* everywhere, because we can't wait
  a week for real traffic on stage. The simulator reacts only to the page each visitor is served, so a change
  has to actually help to win. With real traffic, the same loop runs on real events (PostHog-compatible ingestion).
- **"Why a PageSpec instead of letting the AI edit code?"** Safety and speed. Every change is validated, A/B
  testable, diffable and reversible, and it still ships as a normal PR your team reviews.
- **"How do you tell agents from humans?"** User agent + declared agent headers + PostHog's crawler list, and
  agents that use the MCP/REST surface identify themselves.
- **"What's agent-to-agent here?"** Buyer agents discover the store (`/llms.txt`, agent card), shop over MCP,
  and negotiate with Darwin's merchant agent inside margin limits the optimizer can tune.
- **"Business model?"** % of lift or per-seat for merchants; agencies run it across client stores.
