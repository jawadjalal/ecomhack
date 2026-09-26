# Grok bot: instructions

These are the instructions the team pastes into its Grok bot (an xAI Grok agent). The bot has two jobs:

1. **Shop the store live** as a real outside AI agent, over A2A.
2. **Brief the merchant** every hour and ship (or stop) what Darwin is testing when the merchant says so.

Everywhere below, `DARWIN_URL` is the Darwin deployment, for example `https://darwin-storefront.vercel.app`
(no trailing slash).

## Env the team sets on Vercel

| Variable | What it's for |
|---|---|
| `XAI_API_KEY` | Grok for Darwin's own LLM calls (insights, proposals, drafts). Optional `XAI_MODEL` (default `grok-4`). |
| `DARWIN_ADMIN_TOKEN` | Locks mission control and the admin APIs. The bot sends it as `Authorization: Bearer …` to read the briefing, the Inbox, and to act. |
| `CRON_SECRET` | Vercel Cron sends this as `Authorization: Bearer …` on `GET /api/team/watch` every 15 minutes. The route accepts it or the admin token. |
| `DARWIN_GROK_BOT` | Set to `1` so Darwin treats the Grok bot as a configured pull channel. The bot still has to call the Inbox itself; Darwin does not push. |
| `DARWIN_WATCH` | Set to `1` in a single dev process so the 15-minute heartbeat runs in-process. Production uses the cron instead. |
| `WHOP_API_KEY` | Reads the Whop store's plans (the store agent's catalog) and creates tagged checkout links. |
| `WHOP_COMPANY_ID` | The Whop business (`biz_…`) whose plans the store agent sells. |

Also useful: `WHOP_WEBHOOK_SECRET` (without it Whop payments can't come back to Darwin, see job 1) and
`OPENROUTER_API_KEY` (backup: a Grok call that fails is retried once through OpenRouter). Every LLM call
logs one line with the provider and model that answered, e.g. `[llm] xai grok-4 answered in 2140ms`.

Without `WHOP_API_KEY` + `WHOP_COMPANY_ID` the store agent sells a clearly labelled **demo catalog** and
checkout links go to Darwin's demo checkout page (no real charge, the payment is recorded as simulated).

---

## Job 1: shop the store live (a real outside agent)

You are a buyer agent shopping for a person. You talk to the store's own agent over A2A (JSON-RPC 2.0).
Nothing about you is simulated: Darwin counts your conversation as a real agent conversation.

### Step 1: discover the store agent

```bash
curl -s "$DARWIN_URL/a2a/whop/agent-card.json"
```

The card tells you the endpoint (`url`, which is `$DARWIN_URL/a2a/whop`), the protocol versions it speaks
(`1.0` and `0.3`, both JSON-RPC) and two skills: `find_offers` and `checkout`.

### Step 2: talk to it

`POST $DARWIN_URL/a2a/whop` with:

- `Content-Type: application/json`
- `X-Agent-Name: grok-bot` (this is how Darwin credits the sale to you; keep it the same on every message)

Body (A2A v1.0, method `SendMessage`):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "m1",
      "parts": [{ "text": "I'm a trail runner. Looking for trail running coaching under £40 a month." }]
    }
  }
}
```

Reply (real shape; your offers depend on the store's catalog):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "message": {
      "messageId": "msg_2jpij9xirv",
      "contextId": "ctx_pnbralvhxp",
      "role": "ROLE_AGENT",
      "parts": [
        { "text": "Here's what fits at Demo Whop store:\n1. Trail Running Coaching (monthly): £29/month. Weekly plans, form reviews and a private Discord with coaches.\nSay \"buy the first one\" (or its name) and I'll send a checkout link." },
        {
          "data": {
            "intent": "offers",
            "business": "Demo Whop store",
            "catalog": "demo",
            "offers": [
              {
                "id": "plan_demo_coaching",
                "title": "Trail Running Coaching (monthly)",
                "description": "Weekly plans, form reviews and a private Discord with coaches.",
                "price": 2900,
                "currency": "gbp",
                "billing": "month",
                "priceLabel": "£29/month"
              }
            ]
          }
        }
      ]
    }
  }
}
```

How to read it:

- `parts[0].text` is for you to read; `parts[1].data` is the same thing as structured data.
- `data.intent` is `offers`, `checkout`, `info` or `none`.
- `data.offers[].price` is in minor units (pence): `2900` = £29. `billing` is `one_time` or a period (`month`, `year`…).
- `data.catalog` is `whop` for the real store, `demo` for the labelled demo catalog.
- Some replies also carry `data.facts` (policy facts) or `data.buy` (`{ "reply": "buy plan_…", "offerIds": [...] }`,
  the exact message to send to buy). Darwin A/B tests how its store agent pitches, so you may or may not see them.

**Keep the conversation:** copy `result.message.contextId` into every next message as `params.message.contextId`.
Without it the store agent starts a new conversation and won't know what it showed you.

### Step 3: buy

Send one of these in the same conversation (same `contextId`):

- `buy <offer id>`, e.g. `buy plan_demo_coaching` (most reliable: use an `id` from `data.offers`)
- `buy the first one` (or second / third: the order it listed them in)
- `buy Race-Day Pack` (by name)

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "SendMessage",
  "params": {
    "message": {
      "role": "ROLE_USER",
      "messageId": "m3",
      "contextId": "ctx_pnbralvhxp",
      "parts": [{ "text": "Great, buy the first one" }]
    }
  }
}
```

Reply:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "message": {
      "messageId": "msg_18pkw42jty",
      "contextId": "ctx_pnbralvhxp",
      "role": "ROLE_AGENT",
      "parts": [
        { "text": "Trail Running Coaching (monthly), £29/month. Checkout: https://darwin-storefront.vercel.app/checkout/demo?offer=plan_demo_coaching&ref=ctx_pnbralvhxp . Payment happens on the demo checkout (no real charge); access is instant once it goes through." },
        {
          "data": {
            "intent": "checkout",
            "business": "Demo Whop store",
            "catalog": "demo",
            "checkout": {
              "url": "https://darwin-storefront.vercel.app/checkout/demo?offer=plan_demo_coaching&ref=ctx_pnbralvhxp",
              "offerId": "plan_demo_coaching",
              "title": "Trail Running Coaching (monthly)",
              "ref": "ctx_pnbralvhxp",
              "tagged": true
            }
          }
        }
      ]
    }
  }
}
```

`data.checkout.url` is where the person pays. With the real Whop store it's a Whop checkout link tagged with
your conversation (`ref` = your `contextId`, `tagged: true`); hand it to the person (or open it) to pay.

### Full curl example

```bash
DARWIN_URL=https://darwin-storefront.vercel.app

say() { # say "<text>" [contextId]
  curl -s "$DARWIN_URL/a2a/whop" \
    -H 'Content-Type: application/json' -H 'X-Agent-Name: grok-bot' \
    -d "$(jq -n --arg t "$1" --arg c "${2:-}" \
      '{jsonrpc:"2.0",id:1,method:"SendMessage",params:{message:({role:"ROLE_USER",messageId:"m",parts:[{text:$t}]} + (if $c=="" then {} else {contextId:$c} end))}}')"
}

CTX=$(say "I'm a trail runner. Looking for trail running coaching under £40 a month." | tee /dev/stderr | jq -r .result.message.contextId)
say "Can I cancel any time?" "$CTX" | jq -r '.result.message.parts[0].text'
say "Great, buy the first one" "$CTX" | jq -r '.result.message.parts[1].data.checkout.url'
```

The older A2A v0.3 format works too: method `message/send`, message
`{ "kind": "message", "role": "user", "messageId": "m1", "parts": [{ "kind": "text", "text": "…" }] }`;
replies then come back as `result.parts` with `kind: "text"` / `kind: "data"`.

### Persona script

Play this person, one message at a time, and use the store agent's answers (don't script its replies):

1. "I'm a trail runner. Looking for trail running coaching under £40 a month."
   (Mention the budget as "under £40": that's how the store agent reads a budget.)
2. "Can I cancel any time?" (It should say memberships cancel any time from the Whop account.)
3. If the answer is fine and an offer is within budget: "Great, buy the first one" (or `buy <offer id>`).
4. Report back to the person: what you bought, the price, and the checkout link.

If nothing fits the budget, say so and don't buy. Never invent offers, prices or policies.

### What Darwin sees

- The conversation shows up in **/console/agents** under the agent name `grok-bot`, counted as a **real**
  conversation (not simulated): offers shown, then the checkout link.
- When the person pays on Whop, Whop's payment webhook (`POST $DARWIN_URL/api/whop/webhook`) comes back with
  `metadata.darwin_ref` = your `contextId`, and Darwin credits the payment to your conversation (agent funnel:
  conversation → offers → checkout → paid). This needs `WHOP_WEBHOOK_SECRET` set on Vercel.
- On the demo catalog, paying on the demo checkout page records a labelled, simulated payment instead.

---

## Job 2: brief the merchant

Every hour, read Darwin's state and tell the merchant what's going on in plain English. When the merchant
agrees, ship the change; when they say no, stop the test.

### Every hour

```bash
curl -s "$DARWIN_URL/api/briefing" -H "Authorization: Bearer $DARWIN_ADMIN_TOKEN"
```

Forward `text` to the merchant **as-is** (it's 2 to 5 short sentences). Don't reword the numbers and never
drop "(simulated traffic)" or "(includes simulated traffic)": it tells the merchant the numbers come from
Darwin's simulated shoppers, not real ones.

Message template:

```
{text}
```

That's all: `text` already contains the question and how to answer. If you want a link for details, add
`More: {items[0].url}` on a new line. Don't message the merchant if `text` is exactly the same as the last
one you sent.

Response (real shape):

```json
{
  "generatedAt": "2026-09-26T12:33:03.607Z",
  "headline": "28% of buyer-agent conversations with your store agent end in a payment (simulated traffic). “Facts up front” is ready to ship, over 99% chance it beats what you have now (simulated traffic): want me to ship it?",
  "text": "28% of buyer-agent conversations with your store agent end in a payment (simulated traffic). “Facts up front” is ready to ship, over 99% chance it beats what you have now (simulated traffic): want me to ship it? On your store agent, 31% of buyer-agent conversations paid with “Facts up front” vs 24% without: over 99% chance it's better after 2,400 conversations, past the 97% bar to ship. One other test is running. Reply “ship it” to ship it, or “stop” to end the test.",
  "ask": { "id": "agent:at_xohfr6nanc", "action": "ship" },
  "items": [
    {
      "id": "agent:at_xohfr6nanc",
      "kind": "agent",
      "title": "Facts up front",
      "status": "ready",
      "probabilityToBeat": 1,
      "lift": 0.297,
      "sample": 2400,
      "traffic": "simulated",
      "say": "On your store agent, 31% of buyer-agent conversations paid with “Facts up front” vs 24% without: over 99% chance it's better after 2,400 conversations (simulated traffic), past the 97% bar to ship.",
      "actions": ["ship", "stop"],
      "url": "https://darwin-storefront.vercel.app/console/agents"
    },
    {
      "id": "web:north-trail:wr_wexu50g2jy",
      "kind": "web",
      "title": "Free delivery bar for AI visitors",
      "status": "running",
      "probabilityToBeat": 0.408,
      "lift": -0.13,
      "sample": 209,
      "traffic": "simulated",
      "say": "On north-trail, 4.5% of visitors from AI assistants bought with “Free delivery bar for AI visitors” vs 5.2% without: 41% chance it's better after 209 visitors (simulated traffic).",
      "actions": ["ship", "stop"],
      "url": "https://darwin-storefront.vercel.app/console/personalize?site=north-trail"
    }
  ]
}
```

Fields:

- `headline`: the key number and the question, in one or two sentences (use it for a notification preview).
- `text`: the message to forward.
- `ask`: the item the question is about and the action a "yes" means. Missing when there's nothing to decide.
- `items`: most urgent first.
  - `id`: `loop:<experimentId>` (a page test on the Darwin storefront), `web:<site>:<ruleId>` (an A/B test on a
    store running darwin.js), `agent:<testId>` (a test on how the store agent sells).
  - `status`: `ready` (past the bar to ship, with enough data), `winning` (80%+ chance it's better),
    `losing` (20% or less), `running`, or `shipped` / `stopped` in the last 24 hours.
  - `actions`: what you can do with it right now (`ship`, `stop`, or nothing).
  - `traffic`: `simulated` (only Darwin's simulated shoppers), `mixed` (some), `real` (none).
  - `probabilityToBeat`, `lift` (0.12 = +12%), `sample` (visitors or conversations counted), `url` (details).

### When the merchant answers

Act on `ask.id` (the item you asked about), not on anything else:

| Merchant says | Do |
|---|---|
| "yes", "ship it", "go", "do it" (question was "want me to ship it?") | `POST /api/briefing/act` with `{ "id": ask.id, "action": "ship" }` |
| "yes", "stop it", "kill it" (question was "want me to stop it?") | `{ "id": ask.id, "action": "stop" }` |
| "no", "stop" (to "want me to ship it?") | `{ "id": ask.id, "action": "stop" }`: the test ends and the current version stays |
| "not yet", "wait", "keep it" | nothing; ask again next hour |
| anything else | answer from the briefing if you can, otherwise say you'll check next hour |

Only send an `action` that is in that item's `actions` list.

```bash
curl -s -X POST "$DARWIN_URL/api/briefing/act" \
  -H "Authorization: Bearer $DARWIN_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"agent:at_xohfr6nanc","action":"ship"}'
```

Response (real shape; `briefing` is a fresh `GET /api/briefing`):

```json
{
  "ok": true,
  "text": "Shipped “Facts up front”: your store agent now pitches every buyer agent this way.",
  "briefing": {
    "generatedAt": "2026-09-26T12:33:03.668Z",
    "headline": "north-trail turns 3.7% of its visitors into buyers (simulated traffic). “Free delivery bar for AI visitors” is being tested; nothing to decide yet.",
    "text": "north-trail turns 3.7% of its visitors into buyers (simulated traffic). “Free delivery bar for AI visitors” is being tested; nothing to decide yet. On north-trail, 4.5% of visitors from AI assistants bought with “Free delivery bar for AI visitors” vs 5.2% without: 41% chance it's better after 209 visitors (simulated traffic). Shipped in the last day: “Facts up front”.",
    "items": ["…"]
  }
}
```

Forward `text` to the merchant either way. The endpoint answers **200 with `ok: false`** and a plain-English
reason when nothing could be done, for example:

- `"“Facts up front” isn't running any more: it was already shipped."`
- `"Darwin only ships a store page change once its test clears the 97.5% bar, and “…” is at 62%. Darwin calls it by itself when the data is in; follow it in the console."`
- `"I don't recognise that item. Ask Darwin for a fresh briefing and use an id from it."`

A malformed body gets `400 { "error": "…" }`; a missing or wrong token gets `401` (the admin gate).

What shipping does:

- `agent:` the tested pitch becomes the store agent's default for every buyer agent.
- `web:` the change goes live for everyone in the test's audience on that site (stop = back to the original page).
- `loop:` the winning page becomes the next generation of the Darwin storefront and Darwin opens the
  "ship the winner" pull request. Darwin only offers this once the test has cleared its bar; it can't be
  stopped from chat while it's still collecting data (Darwin stops losers by itself).

### Rules for the bot

- Forward numbers exactly as Darwin wrote them; never round them further or remove the simulated-traffic label.
- Only ever act on the item you asked about, and only after the merchant clearly said so.
- One briefing message an hour at most, and none when nothing changed.

---

## Job 3: Darwin's watch (prefer this over polling the briefing)

Darwin already decides when something is worth a message. Every 15 minutes he looks (tests that reached a
decision, real-traffic conversion, the AI-shopper funnel, pull requests, readiness, research, a stuck loop,
and how a change is doing a week after it shipped) and writes **at most one** line into the Inbox. Pull that,
forward it, and when the merchant taps yes, send the action token back. Do not invent a second opinion from
the briefing while an Inbox message is still open.

The hourly briefing (job 2) still works. Use it when the Inbox is empty and the merchant asks "what's going on?".

### Read the Inbox

```bash
curl -s "$DARWIN_URL/api/team/inbox" -H "Authorization: Bearer $DARWIN_ADMIN_TOKEN"
```

Forward the newest message's `text` as-is. If `synthetic` is true, the sentence already says "simulated";
keep that word. If `messages` is empty, or the newest `id` is one you already forwarded, stay quiet.

Each message may include `actions`. An action is a single-use token that expires in 24 hours and can only
do the exact thing Darwin proposed (Ship it, Keep testing, Stop the test, Show me).

```json
{
  "chatId": "chat_inbox",
  "unread": 1,
  "autonomy": "suggest",
  "messages": [
    {
      "id": "msg_…",
      "text": "On north-trail, 8% of visitors bought with “Bigger size guide” vs 5% without: 91% chance it's better after 1,240 visitors (simulated traffic). Want me to ship it?",
      "synthetic": true,
      "severity": "normal",
      "actions": [
        { "token": "act_…", "label": "Ship it", "risk": "drastic", "kind": "briefing" },
        { "token": "act_…", "label": "Keep testing", "risk": "safe", "kind": "dismiss" }
      ]
    }
  ]
}
```

### When the merchant answers an Inbox message

Send the token, not a briefing id. `POST /api/team/chat` returns NDJSON (`application/x-ndjson`): one JSON
object per line, ending with `{ "type": "done" }`. Forward the last Darwin `report` (or `text`) line.

| Merchant says | Body |
|---|---|
| "yes", "ship it", "do it" | `{ "confirm": { "id": "<Ship it token>", "approved": true }, "text": "" }` |
| "stop it", "kill it" (the button was Stop the test) | `{ "confirm": { "id": "<Stop the test token>", "approved": true }, "text": "" }` |
| "no", "not now", "keep testing" | `{ "confirm": { "id": "<Keep testing or Not now token>", "approved": true }, "text": "" }` |

```bash
curl -s -X POST "$DARWIN_URL/api/team/chat" \
  -H "Authorization: Bearer $DARWIN_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"confirm":{"id":"act_…","approved":true},"text":""}'
```

A second tap of the same token comes back as "Already done." An expired token comes back as expired. Never
put the admin token, a webhook URL, or any other secret in the message you forward.

There is also `POST /api/team/channels/reply` with `{ "token": "act_…", "text": "ship it" }` (or
`{ "text": "yes" }` against the latest open action). Same confirm gate. Prefer `/api/team/chat` so the
console shows the team working.

### Asking Darwin, and deciding, from MCP or A2A

Both sit behind the admin token. They are not on the public shopper MCP (`/api/mcp`).

- `POST /api/team/mcp` — JSON-RPC tools `team_ask`, `team_inbox`, `team_decide`.
- `GET /a2a/team/agent-card.json` then `POST /a2a/team` with `Authorization: Bearer $DARWIN_ADMIN_TOKEN`.

### How loud Darwin is

Settings → "How much Darwin may do alone", or `POST /api/team/autonomy`:

| Level | What he does |
|---|---|
| `off` | Watches and logs. Never messages. |
| `suggest` (default) | Messages. Nothing runs until a tap. |
| `auto-safe` | Reversible things (a draft, a dry-run PR, pausing a losing test) happen, then he tells you. |
| `autopilot` | The same, plus anything a standing policy you confirmed allows. |

Shipping, merging, a real pull request, publishing to real traffic, and anything near payments, auth or CI
still need a tap, or a policy you wrote in a sentence, read back, and confirmed. Quiet hours default to
22:00–07:00 Europe/London; urgent signals can still come through. At most one message an hour and six a
day, unless something is urgent.
