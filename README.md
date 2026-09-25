# Darwin — the storefront that improves itself

Cursor Commerce London Hackathon, 26 Sep 2026.

Darwin connects to a store's git repo, installs analytics through a PR, and watches how **humans and
AI shopping agents** move through the store. It finds where they drop off, proposes a page change,
A/B tests it, and ships the winner as a new PR. Then it starts again.

```
 behaviour ──► insight ──► page change ──► A/B test ──► ship PR ──┐
     ▲                                                              │
     └──────────────────────── next generation ◄───────────────────┘
```

## Why it's different

- **Two audiences, one loop.** Humans get a better page; AI shoppers get a better *agent surface*
  (stock, delivery ETA, returns, landed price, negotiation over MCP/REST). Both are measured and optimized.
- **Safe, declarative changes.** The store renders from a validated `PageSpec`. Every change is a diff you
  can read, test and roll back, and it ships as a normal GitHub PR.
- **Agent-to-agent commerce.** Buyer agents negotiate with Darwin's merchant agent within margin limits.

## Quick start

```bash
cd apps/web
npm install
npm run dev
# console: http://localhost:3000/console   store: http://localhost:3000/store
```

All API keys are optional (see `apps/web/.env.example`). Without them, the loop uses deterministic
heuristics and GitHub PRs run in dry-run mode.

See [AGENTS.md](AGENTS.md) for architecture, module ownership and conventions.
