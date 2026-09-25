# Local testing checklist (needs keys / network the cloud agent didn't have)

The overnight build ran in a sandbox where **`openrouter.ai` and `api.x.ai` were blocked**, so every
LLM-powered path was only tested in **heuristic mode** (no key). Everything below needs a quick local check.

## What *was* tested overnight (no keys)

- Full loop in heuristic mode: observe → diagnose → propose → experiment → decide → ship
- Storefront pages + every PageSpec knob (Playwright screenshots in `apps/web/docs/screenshots/`)
- Agent surface: REST tools, MCP JSON-RPC, `/llms.txt`, agent card, scripted buyer agents, negotiation
- Simulator calibration (human + agent conversion bands)
- GitHub PRs in **dry-run** mode (title/body/diff generated, nothing sent)
- Unit tests + `next build` via CI

## Setup

```bash
cd apps/web
npm install
cp .env.example .env.local
# then in .env.local:
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...            # ask Jawad
OPENROUTER_MODEL=deepseek/deepseek-chat # or any cheap/free model id from openrouter.ai/models
npm run build && npm start               # http://localhost:3000
```

Swap to Grok for the demo: `LLM_PROVIDER=xai`, `XAI_API_KEY=...`, `XAI_MODEL=<current grok model id>`.

## Checklist

| # | What | How | Pass if |
|---|---|---|---|
| 1 | LLM is picked up | Open `/console`; run one loop step to *propose* | Proposal badge shows `llm:<model>` (not `heuristic`) |
| 2 | LLM insights | Step to *diagnose* | Insight titles/details read well, numbers match the evidence chips (LLM must not invent numbers) |
| 3 | LLM proposals | Step to *propose* 3–4 times across generations | Patches are valid (no errors in terminal), not repeats of rejected ones; copy changes (hero headline, CTA) look sensible |
| 4 | Fallback works | Set a wrong key, restart, step | Loop still runs, badge falls back to `heuristic`, no crash |
| 5 | Model JSON robustness | Try a free/small model (`OPENROUTER_MODEL=...:free`) | Either valid proposals or clean fallback to heuristic, never a stuck loop |
| 6 | Latency | Time a *diagnose* and *propose* step | < ~8s each; if slower, use a faster model for the demo |
| 7 | Live LLM shopper over MCP | `npx tsx scripts/grok-shopper.ts --url http://localhost:3000 --goal "trail shoes UK 10 under £140 by Friday"` | Readable transcript: initialize → tools/list → searches → buys or abandons with a reason; shows in console agent panel |
| 8 | Negotiation copy (if LLM phrasing enabled) | Run the shopper with a negotiating goal | Merchant never goes below floor price; messages sound natural |
| 9 | Real GitHub PRs | `GITHUB_TOKEN=<fine-grained, contents+PR write on target repo>`, `DARWIN_TARGET_REPO=owner/repo`; ship one generation | A real PR appears editing `apps/web/storefront.config.json` with the results table |
| 10 | Analytics install PR | Console → Connect repo → paste a test repo URL | Real PR adding the `darwin.js` snippet |
| 11 | Cost sanity | Check OpenRouter usage page after a full autopilot run | A few cents at most |

> Use a **throwaway test repo** for 9–10, not `jawadjalal/ecomhack` main, unless you mean it.

Report anything odd as a GitHub issue or PR comment; the overnight agent is watching the PRs.
