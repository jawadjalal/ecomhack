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

## Run it (2 minutes)

```bash
cd apps/web
npm install
npm run build && npm start     # or: npm run dev
```

| URL | What |
|---|---|
| http://localhost:3000 | Landing page |
| http://localhost:3000/console | **Mission control**: the loop, live traffic, experiments, PRs |
| http://localhost:3000/console?mock=1 | Same UI, fully simulated in the browser (offline fallback) |
| http://localhost:3000/store | The demo store (PACE running shoes) |
| http://localhost:3000/llms.txt | What AI agents read about the store |
| `POST /api/mcp` | MCP server for AI shoppers (search, availability, cart, negotiate, checkout) |

All API keys are optional (`apps/web/.env.example`). With no keys the loop uses its heuristic playbook and GitHub PRs
are dry-run previews. See [docs/LOCAL_TESTING.md](docs/LOCAL_TESTING.md) for testing with an LLM and a real GitHub token,
and [docs/DEMO.md](docs/DEMO.md) for the 3-minute demo script.

## How it works

| Piece | Where | What it does |
|---|---|---|
| **PageSpec** | `src/lib/contracts/page-spec.ts`, `apps/web/storefront.config.json` | Declarative description of the store: human UI *and* agent surface. Every change Darwin makes is a validated patch to it. |
| **Storefront** | `src/app/store/**` | PACE store rendered from the PageSpec. Every setting visibly changes the page. |
| **Agent commerce** | `src/lib/agent-commerce/**` | MCP + REST tools for AI shoppers, a merchant agent that negotiates within margin limits, `llms.txt`, agent card. |
| **Analytics** | `src/lib/analytics/**` | PostHog-compatible ingest (`/ingest`, used by posthog-js), human vs AI-agent classification, funnels, friction signals. |
| **Simulator** | `src/lib/simulator/**` | Synthetic shoppers (5 personas) and AI agents whose behaviour depends only on the page they're served. Labelled `synthetic`. |
| **Optimizer** | `src/lib/optimizer/**` | The loop: diagnose → propose → Bayesian A/B test → decide → ship. LLM (Grok/Claude/OpenRouter) or heuristic playbook. |
| **GitHub** | `src/lib/github/**` | Connect a repo → PR installing `darwin.js`; each winner → PR editing `storefront.config.json`. |
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

### Honest notes

- **Simulated traffic in the demo:** the demo runs on simulated traffic, labelled everywhere. The simulator's behaviour model is
  documented in `src/lib/simulator/behavior-model.ts`, and `GET /api/simulate` returns it.
- **Stricter bar for early stops:** experiments stop early only at 99.5% certainty; the final round uses 97.5%.
- **Single process:** state lives in memory plus `apps/web/.data/`. Run one process for the demo.

See [AGENTS.md](AGENTS.md) for module ownership and conventions, and
[docs/posthog-extraction.md](docs/posthog-extraction.md) for what we took from PostHog.
