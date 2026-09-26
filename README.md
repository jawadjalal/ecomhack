# Darwin — the storefront that improves itself

Cursor Commerce London Hackathon, 26 Sep 2026.

Darwin connects to a store's git repo and installs analytics through a PR. It watches how **humans and AI
shopping agents** move through the store, finds where they drop off, proposes a page change, A/B tests it, and
ships the winner as a new PR. Then it starts again.

```
 behaviour ──► insight ──► page change ──► A/B test ──► ship PR ──┐
     ▲                                                              │
     └──────────────────────── next generation ◄───────────────────┘
```

![Mission control after a few generations of autopilot](apps/web/docs/screenshots/demo/demo-7-autopilot-late-gen.jpg)

![Before / after: the store you connected vs the store Darwin built](apps/web/docs/screenshots/demo/demo-8-before-after.jpg)

## Run it (2 minutes)

```bash
cd apps/web
npm install
npm run build && npm start     # or: npm run dev
```

| URL | What |
|---|---|
| http://localhost:3000 | Landing page |
| http://localhost:3000/onboarding | **Set up a store**: tell Darwin about it, connect GitHub (+ Whop) → it plans what to record, opens the install PR, builds your dashboards |
| http://localhost:3000/console | **Mission control**: the loop, live traffic, experiments, PRs |
| http://localhost:3000/console/dashboards | The dashboards Darwin built from a store's tracking plan, live |
| http://localhost:3000/console/agents | **Store agent**: your Whop store's AI agent (A2A at `/a2a/whop`), a live buyer-agent chat, agent sales |
| http://localhost:3000/console?mock=1 | Same UI, fully simulated in the browser (offline fallback) |
| http://localhost:3000/store | The demo store (PACE running shoes) |
| http://localhost:3000/console/personalize | **Personalize any store**: change a page per traffic source (ChatGPT, Google, Instagram, ads) and search query, A/B tested |
| http://localhost:3000/demo/north-trail | A plain-HTML store Darwin didn't build (only the darwin.js tag), used to show personalization on "any store" |
| http://localhost:3000/llms.txt | What AI agents read about the store |
| `POST /api/mcp` | MCP server for AI shoppers (search, availability, cart, negotiate, checkout) |
| `POST /api/a2a` | A2A merchant agent (v1.0 and v0.3): buyer agents shop and haggle in plain English |

All API keys are optional (`apps/web/.env.example`). With no keys the loop uses its heuristic playbook and GitHub PRs
are dry-run previews. See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for testing with an LLM and a real GitHub token,
and [docs/DEMO.md](docs/DEMO.md) for the 3-minute demo script.

## How it works

| Piece | Where | What it does |
|---|---|---|
| **PageSpec** | `src/lib/contracts/page-spec.ts`, `apps/web/storefront.config.json` | Declarative description of the store: human UI *and* agent surface. Every change Darwin makes is a validated patch to it. |
| **Storefront** | `src/app/store/**` | PACE store rendered from the PageSpec. Every setting visibly changes the page. |
| **Agent commerce** | `src/lib/agent-commerce/**` | MCP + REST tools for AI shoppers, an A2A merchant agent that chats and negotiates within margin limits, `llms.txt`, agent card. |
| **Analytics** | `src/lib/analytics/**` | PostHog-compatible ingest (`/ingest`, used by posthog-js), human vs AI-agent classification, funnels, friction signals. |
| **Simulator** | `src/lib/simulator/**` | Synthetic shoppers (5 personas) and AI agents whose behaviour depends only on the page they're served. Labelled `synthetic`. |
| **Optimizer** | `src/lib/optimizer/**` | The loop: diagnose → propose → Bayesian A/B test → decide → ship. LLM (Grok/Claude/OpenRouter) or heuristic playbook. |
| **GitHub** | `src/lib/github/**` | Connect a repo → PR installing `darwin.js`; each winner → PR editing `storefront.config.json`. |
| **Web personalization** | `src/lib/web/**` | Rules that change any page running darwin.js (text, banner, badge, hide, style) per traffic source and search query. Drafted from plain English (LLM or heuristic), A/B tested with arms recomputed server-side. |
| **Console** | `src/app/console/**` | Mission control for the demo. |

### Example run (heuristic mode, synthetic traffic; exact results vary run to run)

| Gen | Change Darwin shipped | Audience | Result |
|---|---|---|---|
| 0 | Baseline | | humans 2.1%, agents 35% |
| 1 | Expose per-size stock to AI shoppers | agents | +65% |
| 2 | One-page guest checkout with express pay | humans | +53% |
| – | Low-stock urgency (wildcard) | humans | inconclusive, shelved |
| 3 | Delivery ETA + JSON-LD for agents | agents | +20% |
| 4 | Sticky add-to-bag + reviews + delivery estimate | humans | +27% |
| 5 | **Let AI shoppers negotiate** (merchant agent, ≤10% off, never below floor) | agents | +6.5% |
| 6 | Show delivery cost upfront + free delivery over £60 | humans | +29% |
| 7 | Stock levels + returns policy for agents | agents | +5.4% |
| 8 | Quote landed price to agents | agents | +6.7% |

Overall conversion (at the Gen 0 traffic mix) goes 4.5% → 10.4%: humans about 2.1% → 4.4%, agents 35% → 87%. Shipping needs ≥97.5% posterior probability (99.5% to stop early), and bad ideas are
rejected and never retried.

### Onboarding: Darwin asks, installs, builds your dashboards

1. **Connect**: describe the store in one line ("trail running shoes; checkout feels slow on mobile") and connect its
   GitHub repo (Whop is optional and adds payments).
2. **Plan**: Darwin reads the repo (framework, site id) and your words, and proposes a tracking plan with a reason for
   every event: automatic ones darwin.js records with no code, the shopping funnel, and events for *your* worry
   (checkout steps and errors, sizing, search…). Change it by chatting ("also track wishlist adds", "don't track
   rage clicks") or with toggles; the dashboards update as you go.
3. **Install**: one pull request adds darwin.js and commits the plan as `DARWIN_TRACKING.md`, with the one line each
   event needs.
4. **Live**: the dashboards are built from the plan and fill as events arrive, with a checklist of what's been
   recorded. Simulated shoppers are available for a demo, and always labelled.

Darwin runs on its own onboarding (site `darwin-onboarding`): each step is an event, so its funnel shows up in
`/console/dashboards?site=darwin-onboarding` and can be A/B tested like any store.

![Onboarding A (before) vs B (now)](apps/web/docs/screenshots/onboarding/onboarding-A-vs-B.jpg)

### Your Whop store's own AI agent (agent-to-agent commerce)

How an AI agent buys from the store, and how Darwin knows it converted:

1. A shopper's agent (ChatGPT, Claude, Perplexity, a custom buyer) finds the store agent at `/a2a/whop`
   (agent card at `/a2a/whop/agent-card.json`; A2A v1.0 `SendMessage` and v0.3 `message/send`).
2. It asks in plain English ("trail running coaching under £40 a month") and gets real offers from the Whop
   business's plans (price, billing) as text plus structured data.
3. "Buy the first one" returns a **Whop checkout link tagged with the conversation** (checkout configuration
   metadata: `visitor_kind: agent`, `agent_name`, `darwin_ref`).
4. The Whop payment webhook (`/api/whop/webhook`) brings the payment back with that metadata, so it counts as
   that agent's sale. `/console/agents` shows the funnel: conversations → offers → checkout links → paid, by agent.

Set `WHOP_API_KEY` and `WHOP_COMPANY_ID` (biz_…). Until then it runs on a labelled demo catalog whose checkout
records a simulated payment.

![Store agent](apps/web/docs/screenshots/agents/store-agent.jpg)

**A/B tests on the agent's pitch.** Darwin tests how the store agent sells, one lever at a time, judged on paid
conversations (sticky per conversation, Bayesian, ships at ≥97% chance better):

| Lever | What changes in the reply |
|---|---|
| Facts up front | Instant access, cancel any time, paid on Whop (text + a `facts` array) |
| One best pick | One recommendation with the reason instead of a list |
| Structured buy instructions | Exact offer ids and `reply "buy <id>"` in the data part |
| Upsell the yearly plan | Leads with the biggest plan |

Winners ship into the pitch and stack; the next lever is tested on top. Turn on **Autopilot** in `/console/agents`
(it starts labelled simulated buyer agents if there's no traffic yet). API: `GET/POST /api/store-agent/tests`.

![Agent A/B tests](apps/web/docs/screenshots/agents/agent-ab-tests.jpg)

### Personalize any store

The loop above optimizes a store built on a PageSpec. Web personalization works on **any** store with the darwin.js tag:

1. Tell Darwin what to change: *"Visitors from ChatGPT: banner with delivery and returns"*, *"Google searchers: put their
   search in the headline"*. It drafts a rule against the page's real elements (or suggests one per traffic source,
   biggest conversion gap first).
2. Preview it as each audience, then start an A/B test (or show it to everyone in that audience).
3. darwin.js loads `/api/web/runtime.js?site=…`, which sorts each visitor by source (AI assistant, search, social,
   paid, email, referral, direct) and search query, assigns a sticky arm, and applies the change with `textContent` and
   styles only (never HTML or scripts), without flicker.
4. Results count orders after exposure, with each visitor's arm recomputed on the server.
5. **Autopilot** runs this loop by itself: one A/B test per traffic source (biggest conversion gap first, up to 3 at
   once), ships a winner at ≥97% with ≥300 visitors per arm and ≥30 orders, stops losers, then tries that source's
   next idea. It never retries an idea, and every decision is logged with its numbers.
6. **Heatmap**: darwin.js already records clicks (`$autocapture`, `$rageclick`); flip *Heatmap* to see where each
   audience clicks, painted over the page (same-origin previews) and listed (any store), rage clicks in red.

![Personalize: preview as an audience, draft from a prompt, live A/B results](apps/web/docs/screenshots/personalize/personalize-desktop.jpg)

### Talk to the store's agents

The store is agent-ready: `GET /llms.txt` and `GET /.well-known/agent-card.json` describe it. What agents are told
always follows the live PageSpec, so Darwin's changes reach them as well.

```bash
# A2A (v1.0): chat with the merchant agent; reuse the contextId from the reply to continue
curl -s localhost:3000/api/a2a -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage",
  "params":{"message":{"role":"ROLE_USER","messageId":"m1","parts":[{"text":"Trail shoes, UK 10, under £150, by Friday"}]}}}'

# MCP (Streamable HTTP): Cursor / Claude Code can connect directly
claude mcp add --transport http pace-store http://localhost:3000/api/mcp

# A scripted buyer agent chatting over A2A, in the terminal
npx tsx scripts/a2a-buyer.ts --url http://localhost:3000
```

### Honest notes

- **Security:** mission control and every state-changing API (loop, GitHub PRs, simulator, LLM shoppers, raw
  analytics) can sit behind `DARWIN_ADMIN_TOKEN` (sign in at `/console?key=…`). It's optional: without it the
  console is open, public deploys included, and anyone with the URL can drive the loop and spend the LLM key. Browser
  events can't claim to be synthetic or pick an experiment arm (attribution is re-derived server-side), and ingest is
  size- and rate-limited.
- **Simulated traffic in the demo:** the demo runs on simulated traffic, labelled everywhere. The simulator's behaviour model is
  documented in `src/lib/simulator/behavior-model.ts`, and `GET /api/simulate` returns it.
- **Stricter bar for early stops:** experiments stop early only at 99.5% certainty; the final round uses 97.5%.
- **Single process:** state lives in memory plus `apps/web/.data/`. Run one process for the demo.

See [AGENTS.md](AGENTS.md) for module ownership and conventions, and
[docs/posthog-extraction.md](docs/posthog-extraction.md) for what we took from PostHog.
