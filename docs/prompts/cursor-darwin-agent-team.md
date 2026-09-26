# Cursor prompt: make Darwin's agent team truly agentic

Paste everything below the line into Cursor (Agent mode, strongest model). It is written for this repo as of
2026-09-26: `apps/web/src/lib/team/**` (orchestrator, router, store, tools, roster), `src/app/api/team/**`,
`src/lib/contracts/team.ts`, `src/lib/llm/client.ts`, `src/lib/github/**`.

---

You are working in the Darwin repo (`apps/web`, Next.js 16, TypeScript, Tailwind v4). Read `AGENTS.md` and
`apps/web/AGENTS.md` first and follow them exactly (Next 16 APIs are async; read `node_modules/next/dist/docs/`
before using any Next API; cross-module calls only through each area's public API; every LLM path needs a heuristic
fallback so the demo runs with no keys; simulated data is labelled `synthetic`, never faked; update `docs/STATUS.md`
and register user-facing actions as commands).

## Goal

Darwin is the team lead and the only agent the merchant talks to. Behind him are four specialists defined in
`src/lib/team/roster.ts`: Iris (observer: analytics, dashboards, research, readiness), Pixel (website editor:
personalisation rules, repo files, PRs; runs on the APINex editor model), Fizz (experimenter: A/B tests, optimiser
loop, simulations, store-agent tests) and Dash (shipper: ships winners as PRs, PR status, merges). Make the team work
like a real agentic team, not a keyword router with extra steps:

1. **Darwin plans, then delegates.** For each merchant message Darwin writes a short plan: a small DAG of tasks
   (`{id, agent, goal, dependsOn[], acceptance}`), not just a flat list. Tasks with no unmet dependencies run in
   parallel (keep `MAX_PARALLEL` bounded concurrency); dependants get their inputs' results. Darwin can re-plan once
   when a task fails or returns something unexpected. Show the plan in the group chat as a compact checklist that
   ticks live (`progress` events).
2. **Specialists talk to each other.** Every multi-agent job gets a group chat (Darwin creates it, or a specialist
   creates one for a side-conversation). Agents post short messages (≤140 chars) there: what they are doing, what they
   found, what they need. A specialist can `ask(agent, question)` a teammate and get an answer (depth 1, no ask chains,
   max 2 asks per task) and can `post(chatId, text)`. Add a shared per-chat **blackboard** (facts with source agent,
   tool and timestamp) that every agent in the chat reads before acting, so Iris's numbers are reused by Fizz instead of
   re-fetched or re-guessed.
3. **Darwin reports back.** One concise report in the merchant's chat: what was done, the numbers with their source
   (tool name, synthetic or real), what is waiting on the merchant, and links (`navigate` to in-app pages only, via
   the existing `safeHref` allow-list).
4. **Ask before anything drastic.** Replace the name-based confirm list with a risk classifier on every tool call:
   - `read`: runs freely.
   - `reversible` (draft a rule, open a branch, dry-run PR, a simulation): runs, and is reported.
   - `drastic`: waits for the merchant via the existing `confirm` message / `pendingConfirm` flow. Always drastic:
     merging a PR, writing files or opening a real (non-dry-run) PR, shipping a winner, publishing a live rule to more
     than 0% of real traffic, turning autopilot on, resetting the loop, deleting anything, touching payments/Whop
     settings. Also drastic by size: changes to more than 5 files or 200 changed lines, any edit to lockfiles, CI, env or
     auth code, or a PR targeting the default branch with failing checks.
   - The confirm card must carry a **preview**: the diff (files and hunks, truncated), the rule and the audience, or the
     exact setting change, plus "what happens if you say no". Approval is single-use, expires after 10 minutes, is
     bound to the exact arguments (hash them; any change needs a new confirm) and is recorded in an audit log
     (`who, what, args hash, approved/denied, at`). Never let the model approve its own confirm, and never execute a
     drastic call from a heuristic path without a confirm either.
   - Add an **undo** where possible (rule unpublish, loop rollback, PR close) and tell the merchant it exists.
5. **Reliable LLM tooling** (`src/lib/llm/client.ts`): validate every tool call's arguments with zod against the tool's
   schema; on invalid JSON or schema errors send the error back to the model once to repair; if the provider rejects
   native tool calling, fall back to JSON mode (already started; finish and test it). Keep the provider policy:
   DeepSeek V4 Flash via OpenRouter by default (Darwin always), APINex for Pixel, for tasks the plan flags `hard`, and
   for overflow when too many OpenRouter calls are in flight; on 402/429/5xx fall back across providers, then to the
   heuristic. Per-turn budgets: max tool calls per agent (8), max wall time per task (45 s), max total tokens per turn;
   when a budget runs out the agent returns what it has and says so. Support cancel: `POST /api/team/chat` with
   `{ chatId, cancel: true }` aborts in-flight tasks (AbortController through `runToolLoop`).
6. **Memory.** Per-agent short-term history per chat (summarise when it passes ~20 messages, keep the summary);
   merchant-level facts that persist in `json-store` (store name, stack, goals, things the merchant said no to) that
   Darwin reads at the start of every turn. Never store secrets or tokens in memory.
7. **Heuristic mode stays honest.** With no keys: keyword/intent routing (improve `router.ts` with a small scored
   intent table, not a chain of regexes), still creates the group chat and progress, still calls the real tools, and
   says plainly that it is running on built-in rules. Never invent a number, a PR URL or a test result.

## Deliverables

- Contract changes in `src/lib/contracts/team.ts` first (plan/task types, blackboard fact, risk level, confirm preview,
  cancel), documented in `contracts/api.ts`. Keep existing fields backward compatible; the onboarding and the bottom
  chat panel already read `TeamAgent.tools`, `TeamEvent` and `ChatMessage`.
- Implementation in `src/lib/team/**` and `src/app/api/team/**` only, plus the `llm/client.ts` and `lib/github`
  changes above. Do not edit `components/onboarding/**`, `components/mascots/**`, `public/mascots/**`,
  `components/console/assistant-*`, `components/team/**`, `lib/voice/**`.
- If you add, rename or re-risk a tool, update its entry in `roster.ts` (`tools[]`, `confirm`) so the onboarding intro
  stays true.
- Tests in `src/lib/team/team.test.ts` with a mocked LLM: DAG ordering with parallel branches and a dependency;
  bounded concurrency; a specialist asking a teammate (and the depth limit); blackboard reuse; every drastic class
  producing a confirm with a preview and nothing executing before approval; approval bound to args (changed args →
  new confirm); expiry; cancel mid-turn; provider fallback 429 → other provider → heuristic; JSON-mode fallback when
  tools are rejected; schema repair; heuristic path with no keys and no invented numbers.
- `docs/STATUS.md` (team area: done / left / limitations / next-run ideas, run log line) and the commands registry for
  any new merchant action (cancel, approve, deny, undo).

## Definition of done

`cd apps/web && npm run typecheck && npm run lint && npm test` pass. With no keys, stream a multi-part ask and paste
the NDJSON in your summary:
`curl -N -X POST localhost:3000/api/team/chat -H 'content-type: application/json' -d '{"text":"how are AI shoppers converting, and test a shorter checkout"}'`
It must show a group chat, Iris and Fizz working in parallel with progress, a real tool result, and Darwin's report.
Then ask it to "merge the open PR" and show that it stops at a confirm with a preview. Stop and ask me before any
change that would break the existing API shapes, delete data, or touch auth, payments or CI.
