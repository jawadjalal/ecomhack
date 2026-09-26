# Darwin: the 3-minute stage demo

Cursor Commerce London · agentic ecommerce + Merchant Tooling · **demos at 17:30 London**.

> **Pitch:** Darwin is a store that improves itself. It watches how people *and* AI shopping agents buy, finds where
> they drop, changes the page, proves the change with an A/B test, ships the winner as a pull request, and repeats.

The loop to land: **behaviour → insight → page change → better outcome, for people and for AI agents.**

## T-10 checklist

- [ ] Laptop is set up with [`DEMO-LAPTOP.md`](./DEMO-LAPTOP.md): production build, **one** `npm start`, `http://localhost:3000`. Not Vercel.
- [ ] **One browser tab.** Autopilot runs in the tab, so two console tabs make it run twice as fast.
- [ ] **Start over:** click **JJ** (top right) → Settings → **Start over** → **Yes, start over**. This wipes every
      event, test and agent conversation, so then:
  - [ ] `/console/traffic` → **Send 470 test visitors** (fills Traffic and Personalize).
  - [ ] `/console/agents` → switch **Simulated buyers** on for ~30 s, so Agent sales has numbers.
  - [ ] `/onboarding`: it resumes the last run. If it doesn't open on the empty prompt, click **Not the right store? Start over** at the bottom.
- [ ] **~3 min before you go on:** click **Paused** in the top bar so it reads **Darwin running**. In rehearsal it shipped
      about one change a minute. When every idea has shipped or lost (8 changes on the dev server) it switches itself off. That's fine.
- [ ] Leave the tab on `http://localhost:3000/` (landing). Zoom so the back row can read the charts. Notifications off.
- [ ] **Offline fallback:** `http://localhost:3000/console?mock=1` runs the same console on an in-browser engine. The
      top bar says **(demo data)**. It starts empty: click **Let Darwin run** and the first change ships in under a minute.
- [ ] **Keys that make it real** (`apps/web/.env.local`, restart before loading data; all optional):

| Key | With it | Without it |
|---|---|---|
| `XAI_API_KEY` | Grok writes the insights, fixes and drafts (Settings → *Darwin's brain* shows the model) | OpenRouter if set, else the built-in playbook ("Written from Darwin's playbook, no LLM") |
| `GITHUB_TOKEN` + `DARWIN_TARGET_REPO` | Real install, ship and revert PRs | Every PR is a labelled **PR preview (dry run)** |
| `WHOP_API_KEY` + `WHOP_COMPANY_ID` | Store agent sells your real Whop plans with real Whop checkout links | Labelled **Demo catalog**, simulated payments |

## The script (3:00)

| Time | Say | Do |
|---|---|---|
| 0:00–0:12 | "Every store leaks buyers. And more and more shoppers are AI agents: ChatGPT, Claude, Grok. Nobody optimises for them. Darwin does, for both." | Landing `/`: "Your store, improving itself." The dashboard under it runs live on simulated shoppers ("Live demo · simulated"). Click **Set up your store**. |
| 0:12–0:40 | "Setup is one prompt. Say what you sell and what worries you. Connect GitHub, or paste one script tag. Whop is optional." | Type *"We sell trail running shoes; checkout feels slow on mobile and people ask about sizing"*. **Connect your GitHub** → paste a repo URL → **Connect** (or **Add one script tag instead**). **Connect your Whop** → **Try demo**. Press ↑. Darwin asks what to track (**Next**) and where (**Make my plan**), then shows "Here's what Darwin will record" (a few seconds with an LLM key: talk over it). **Looks good: install it** → **Open pull request**: the PR card ("Preview (dry run)" without a valid token). "It only changes your code through PRs you review." |
| 0:40–1:00 | "This is the store after a few minutes of Darwin. Same store, people and AI agents side by side." | Click the **darwin** logo (top left) → Overview. Point at the impact strip (buyers per 1,000 visitors; People and AI agents, before → now), the **Conversion** chart (one bar per generation) and **Which agents buy**. Point at the "simulated" labels. |
| 1:00–1:15 | "Behaviour becomes insight. Darwin ranks what stops people buying by buyers lost per 1,000 visits, for people and for agents." | **1 Issues**. Point at issue #1, then *Who is affected* (Agents vs People) and *Where they happen*. |
| 1:15–1:30 | "Insight becomes a page change. Every fix is a small settings change Darwin can undo. Nothing goes live until it wins a test." | **2 Fixes**. Open a fix: the A → B settings, and the chip that says who wrote it (model or playbook). |
| 1:30–1:55 | "It proves it. Half the shoppers get B. Darwin ships only at a 97.5% chance B wins, and a people-only change is judged only on people." | **3 Experiments**: A · before vs B · the fix, drawn from the live config. **Chance B wins** climbing to the 97.5% line. **Who buys**: people vs agents. |
| 1:55–2:15 | "A better outcome, with the receipts, and one click to undo." | **4 Changes**: *Before Darwin vs now*, *Extra buyers*, each Gen with **Live on your store** and its PR. Click **Roll back to before this**, read the confirm, click **Keep it**. |
| 2:15–2:40 | "Agents don't just browse. The store has its own AI agent. Other agents buy from it three ways: A2A chat, MCP tools, or ACP checkout. All three land in one funnel." | **⋯** → **Store agent**. Click the chip **Trail running coaching under £40 a month**, then **Buy the first one**: a checkout link. Point at **Agent sales**: Talked to it → Saw offers → Checkout link → Paid. |
| 2:40–3:00 | "And you don't have to log in. A Grok teammate messages you when there's a call to make." Close: **"Darwin is CRO for the agentic web: it experiments on people and AI shoppers, and ships the winners as code."** | **JJ** → Settings → *Your Grok teammate* → **Preview today's briefing**: the message, with its simulated-traffic label, and **Yes, ship it** / **No, stop it**. |

Numbers on screen come from simulated shoppers and are labelled "simulated". Say so if asked; never read them as real sales.

## Optional wow moments (+20–40 s each)

**1. A real agent buys over MCP.** Connect it before you go on stage. Tools: `search_offers`, `get_offer`, `create_checkout`, `store_info`.

```bash
# Cursor: ~/.cursor/mcp.json (or Settings → MCP → Add new server)
{ "mcpServers": { "darwin-store": { "url": "http://localhost:3000/api/store-agent/mcp" } } }

# Claude Code
claude mcp add --transport http darwin-store http://localhost:3000/api/store-agent/mcp
```

Prompt: *"Use darwin-store to find trail running coaching under £40 a month and get me a checkout link."* It shows up on
**Store agent** under the client's own name, not marked simulated. Line: "That's Claude Code shopping our store, live."

**2. ACP checkout from a terminal** (demo catalog ids; with real Whop, take ids from `search_offers`):

```bash
S=$(curl -s -X POST localhost:3000/acp/checkout_sessions -H 'content-type: application/json' -H 'X-Agent-Name: judge-acp' \
  -d '{"items":[{"id":"plan_demo_race","quantity":1}]}' | jq -r .id)
curl -s -X POST localhost:3000/acp/checkout_sessions/$S/complete -H 'content-type: application/json' \
  -H 'X-Agent-Name: judge-acp' -d '{}' | jq '{status, order, messages: [.messages[].content]}'
```

The first call returns `ready_for_payment`. On the demo catalog `complete` returns `completed` with an order (a labelled
simulated payment); with real Whop keys it returns `in_progress` and a tagged Whop payment link. It shows in Store agent → *Just now*.
A2A examples (curl, persona) are in [`GROK_BOT.md`](./GROK_BOT.md).

**3. Personalize any store with darwin.js.** **⋯** → **Personalize**. The preview is `/demo/north-trail`, a plain HTML
store with only the darwin.js tag. Click **Visitors from ChatGPT** (Darwin drafts it) → **Preview** → **Start A/B test**.
Switch *View the page as* to **AI assistants** or **Search**, and try **Heatmap**. **Send 500 test visitors** fills the
results (labelled simulated). Line: "Same loop, any store, one script tag."

**4. Tell Darwin what to do (⌘K).** Press **⌘K** (or click the ⌘K button in the top bar) and type *"go to experiments"*
or *"send 200 simulated shoppers"*. It shows the plan, then runs it. Risky commands (roll back, ship a test) ask you
first. Browser agents get the same commands through `window.darwin.run(name, input)` and WebMCP when the browser supports it.
This landed on the day: rehearse it once, and skip it if it misbehaves.

## If something breaks

| Symptom | Do this |
|---|---|
| Server errors, blank page, or no network | Go to `/console?mock=1`, click **Let Darwin run**, and carry on. Store agent and Settings still need the server. |
| Overview is empty | Darwin hasn't run yet. Click **Paused** → **Darwin running**. The first change takes a minute or two. |
| Autopilot switched itself off, "out of untested ideas" | Honest behaviour: every idea shipped or lost. Show Changes. For a fresh loop, Start over (before you go on, not live). |
| Test ends "No clear winner" | That's a real outcome. Say "it doesn't ship vibes"; the next idea starts. |
| LLM slow or failing | Darwin falls back to its playbook by itself. The fix chip says who wrote it. |
| PR fails or the token is rejected | The PR card becomes **PR preview (dry run)** automatically. Say so. |
| GitHub sign-in fails on localhost | Expected (OAuth callback is the Vercel URL). Paste the repo URL, or **Add one script tag instead**. |
| Whop key rejected | **Try demo** connects a labelled demo business. |
| Loop runs too fast | A second console tab is open. Close it. |
| Numbers jump or empty on refresh | You're on Vercel (several instances). Use the laptop. |

## Judge questions, honest answers

- **"Is any of this real?"** *Simulated, and labelled:* the shoppers and AI shoppers driving the loop on the demo store,
  so the conversion numbers on Overview, Experiments and Changes; Personalize's test visitors; the Store agent's
  "simulated buyer agents". Every simulated event is tagged `synthetic` and the UI says "simulated" (e.g. "N of M
  simulated"). The simulator only reacts to the page each visitor is served, so a change has to actually help to win.
  *Real:* the A2A (`/a2a/whop`), MCP (`/api/store-agent/mcp`) and ACP (`/acp/checkout_sessions`) endpoints (any outside
  agent can buy right now, and it's counted by name, not as simulated); the A/B statistics and decisions; rollback; the
  darwin.js tag on any site; GitHub PRs with a valid `GITHUB_TOKEN`; Whop plans and checkout links with `WHOP_API_KEY` +
  `WHOP_COMPANY_ID`. Payments come back through Whop's webhook; that needs `WHOP_WEBHOOK_SECRET`. We tested Whop, GitHub
  and xAI against mocks in CI; a real paid Whop purchase hasn't been run end to end yet.
- **"How do you avoid shipping noise?"** Bayesian A/B test: ship at 97.5% on the final look (99.5% on earlier looks), drop
  under 10%. A people-only change is judged on people, an agent-only change on agents. Losers are never retried. Store
  agent pitch tests need 100+ conversations per arm and 30+ payments, and ship at 97%.
- **"Why a settings change instead of letting the AI edit code?"** Every fix is a small, validated, diffable change to
  `storefront.config.json`. It can be A/B tested and rolled back, and it still ships as a normal PR you review.
- **"How do you tell agents from people?"** Declared agent headers (`X-Agent-Name`), Web Bot Auth signatures, and user
  agents (ChatGPT-User, Claude-User, GPTBot, headless browsers, curl…). Traffic on A2A, MCP and ACP is an agent by definition.
- **"What does Grok do?"** With `XAI_API_KEY` it is Darwin's brain (insights, fixes, drafts). The Grok teammate bot reads
  `GET /api/briefing` every hour, messages the merchant, and ships or stops a test through `POST /api/briefing/act` when
  they say yes. Without keys everything still runs on the built-in playbook.
- **"Business model?"** Merchant tooling: per-store pricing or a share of measured lift; agencies run it across client stores.
