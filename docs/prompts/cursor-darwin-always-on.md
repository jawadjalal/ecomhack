# Cursor prompt: Darwin as an always-on, Grok-bot-style teammate

Paste everything below the line into Cursor (Agent mode, strongest model). Run it after
`docs/prompts/cursor-darwin-agent-team.md`, or together with it: that one makes the team plan, delegate and ask
before drastic changes; this one makes Darwin proactive, like the team's Grok bot (`docs/GROK_BOT.md`): it watches the
store on its own, messages the merchant when there is a call to make, and does the work when they say yes.

---

You are working in the Darwin repo (`apps/web`, Next.js 16, TypeScript, Tailwind v4). Read `AGENTS.md`,
`apps/web/AGENTS.md` and `docs/GROK_BOT.md` first and follow them (Next 16 APIs are async, read
`node_modules/next/dist/docs/` before using a Next API; cross-module calls only through public APIs; every LLM path
has a heuristic fallback; simulated data is labelled `synthetic` and never mixed into real numbers; update
`docs/STATUS.md`; register every merchant action in the commands registry).

What exists: the agent team in `src/lib/team/**` (Darwin the lead plus Iris, Pixel, Fizz, Dash; roster in
`roster.ts`; orchestrator, router, chat store, tools, confirm gate) streaming NDJSON `TeamEvent`s from
`POST /api/team/chat`; the briefing (`getBriefing`, `actOnBriefing` in `src/lib/briefing`, `GET /api/briefing`,
`POST /api/briefing/act`) that an external xAI Grok bot reads hourly; the optimiser loop, experiments, analytics,
web personalisation, store agent (A2A at `/a2a/whop`), GitHub PRs, LLM client with xAI / OpenRouter (DeepSeek V4
Flash) / APINex / Anthropic and fallbacks.

## Goal

Today Darwin only answers when asked, and the proactive part lives in an outside Grok bot. Bring that inside and make
it great: **Darwin is a teammate that is always on.** He notices things, tells the merchant in one or two sharp
sentences, proposes the move, and his team does it the moment the merchant taps yes. The external Grok bot stays
supported, now as one more channel into the same team.

## Build

1. **Heartbeat.** A `watch` job (`src/lib/team/watch.ts`, route `POST /api/team/watch`, admin or cron-secret auth)
   that runs every 15 minutes (Vercel Cron in `vercel.json`; in dev an in-process interval behind
   `DARWIN_WATCH=1`, single process only). Each run, Iris and Fizz check in parallel, using their real tools only:
   experiments that just reached a decision (use the stats already in the optimiser; never recompute a significance
   the code does not have), a KPI moving outside its usual band (real traffic only, minimum sample sizes), the AI
   shopper funnel dropping at a step, a PR merged, failed or waiting, a readiness score change, a competitor finding
   from research, the loop stuck in a phase. Output: a list of **signals** `{id, kind, severity, facts[], sources[],
   synthetic, suggestedAction?}`.
2. **Should Darwin speak?** A notability gate: severity × novelty × actionability, dedupe by a signal fingerprint
   (don't repeat yourself for 24 h unless it got worse), a per-merchant rate limit (max 1 message per hour, 6 a day,
   more only for severity "urgent"), quiet hours in the merchant's timezone, and a daily digest that bundles the rest.
   When it speaks, Darwin writes into an **Inbox** chat (a `direct` chat, pinned, unread count in `GET /api/team`)
   and emits a `TeamEvent` so an open console shows it live.
3. **One-tap decisions.** Every proactive message that proposes something carries actions (e.g. "Ship it", "Keep
   testing", "Stop the test", "Show me") bound to the existing confirm gate: a single-use token tied to the exact
   action and arguments, expiring in 24 h. Tapping runs it through the team (Dash ships, Fizz stops, Pixel publishes)
   with progress in a group chat, then Darwin confirms with the result and an undo if one exists.
4. **Autonomy levels** (Settings + a command): `off` / `suggest` (default: only messages) / `auto-safe` (runs
   reversible actions itself and reports: drafts, dry-run PRs, simulations, pausing a clearly losing test) /
   `autopilot`. Even on autopilot, drastic actions (merge, real PR, publish to real traffic, ship, reset, anything
   touching payments, auth or CI) need either a tap or a **standing policy** the merchant wrote in plain English
   ("ship winners above 95% with at least 500 real visitors per arm", "never touch checkout on Fridays"). Compile each
   policy into a structured guard (zod-validated), show the compiled form back to the merchant to confirm, and log every
   policy-based action with the policy it used.
5. **Channels.** In-app Inbox first. Then pluggable outbound adapters behind one interface
   (`send(message, actions)` / `receive(reply)`): the external **Grok bot** (it can now call `GET /api/team/inbox` and
   `POST /api/team/chat` with its token, and reply with the action token; update `docs/GROK_BOT.md`), a Slack or
   Discord incoming webhook, and email (only if a provider key is set). Every adapter is off unless configured; replies
   from any channel go through the same confirm gate. Never put secrets in messages.
6. **Voice and persona.** Darwin's voice is Grok-like: direct, a bit witty, opinionated, never cute at the merchant's
   expense, one or two sentences, numbers with their source ("91% chance it's better, 1,240 real visitors").
   Keep the persona in one file (`src/lib/team/persona.ts`) with examples, used by every Darwin prompt. The heuristic
   path uses templates in the same voice. If a signal is synthetic, say so in the sentence.
7. **Talk to Darwin from anywhere.** Expose the team to outside agents: MCP tools `team_ask`, `team_inbox`,
   `team_decide` on the existing MCP server, and an A2A agent card for Darwin's team, all behind the admin token. The
   Grok bot (or Claude, or ChatGPT) becomes a remote for the merchant's team.
8. **Memory that makes it feel alive.** Darwin remembers what the merchant said yes and no to, what shipped and how
   it did afterwards (a follow-up signal 7 days after a ship: "the new checkout is still +8%"), and does not re-propose
   rejected ideas for 30 days unless the data changed a lot.
9. **Live console.** A compact "Darwin's watch" strip on the Overview: last check time, what the team looked at,
   signals found vs messages sent (show that he stays quiet on purpose), and the next check. Clicking a signal opens
   the group chat where the team worked on it.

## Rules

- Nothing invented: every number in a message comes from a tool result in that run, with its source; synthetic is
  labelled; if a tool fails, Darwin says what he could not check.
- Budgets per watch run (tool calls, tokens, 60 s wall time); a run that hits a budget ends cleanly and is logged.
- Idempotent: two overlapping runs never send the same message twice (a lease in `json-store`).
- No new dependencies unless you justify each one in the PR description.
- Do not edit the onboarding, mascots, bottom-chat UI or voice areas owned by other people (see AGENTS.md); add
  what you need through their public APIs or ask.

## Tests (vitest, mocked LLM and clock)

Signal detection for each kind with real and synthetic data; the notability gate (dedupe, rate limit, quiet hours,
digest); action tokens (single use, bound to args, expiry, replay rejected); autonomy levels including a drastic
action blocked on autopilot without a policy and allowed with a matching policy; policy compilation round-trip; the
Grok bot channel end to end against the route handlers; heuristic mode with no keys producing honest messages.

## Definition of done

`cd apps/web && npm run typecheck && npm run lint && npm test` pass. With no keys, `DARWIN_WATCH=1 npm run dev`,
send simulated traffic, run `curl -X POST localhost:3000/api/team/watch -H "authorization: Bearer $DARWIN_ADMIN_TOKEN"`,
and show: the signals found, the one Inbox message Darwin chose to send (labelled synthetic), tapping "Ship it" going
through the confirm gate and the team, and a second watch run that stays quiet. Update `docs/STATUS.md` and
`docs/GROK_BOT.md`. Stop and ask me before anything that changes existing API shapes, sends anything outside the app,
deletes data, or touches auth, payments or CI.
