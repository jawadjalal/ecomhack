/**
 * Darwin, the merchant's managing assistant. OWNED BY: assistant.
 *
 *   runAssistant({ messages, confirm?, context? }) → { reply, actions, pendingConfirm?, model, suggestions }
 *
 * With an LLM key: a short tool loop (≤ MAX_STEPS). Each step the model sees the persona, the tool catalog,
 * a compact live state snapshot (loop phase, KPIs, running experiments), the conversation and this turn's
 * tool results, and answers `{ thought, tool, args }` or `{ reply }`.
 * Without a key (or if the model fails before doing anything): a keyword intent router over the same tools.
 *
 * Tools marked `requiresConfirm` never run on the model's (or router's) say-so: the turn ends with a
 * `pendingConfirm` and the tool runs only when the merchant sends `confirm: { tool, args, approved: true }`.
 */
import { z } from "zod";
import type { AssistantAction, AssistantMessage, AssistantPendingConfirm, AssistantRequest, AssistantResponse } from "@/lib/contracts";
import { generateJson, llmAvailable, llmLabel } from "@/lib/llm/client";
import { confirmPromptFor, getTool, precheckFor, runTool, stateSnapshot, toolCatalog, type StateSnapshot, type ToolContext, type ToolName } from "./tools";

export const MAX_STEPS = 6;
const MAX_HISTORY = 14;
const MAX_MESSAGE_CHARS = 2000;

export interface RunAssistantInput extends AssistantRequest {
  /** Darwin's origin (server-side), for tools that fetch Darwin's own pages. */
  origin?: string;
}

/* ------------------------------------------------------------------ persona + prompt */

export const PERSONA = `You are Darwin, your store's managing assistant. You help an e-commerce merchant run their store: you read live analytics (human shoppers AND AI shopping agents), drive the self-improvement loop (observe → diagnose → propose → A/B test → decide → ship), manage experiments, dashboards, personalization and agent-readiness.

Style:
- Concise: at most 4 short sentences, or a few "- " bullets. Plain words, no jargon, no markdown headings.
- Proactive: end with ONE concrete next action you can take for them.
- Never invent numbers. Only cite numbers that appear in STATE or in tool results. If you don't have a number, call a tool or say you don't know.
- Say "simulated" whenever a number comes from synthetic traffic (traffic.synthetic > 0, or a result marked synthetic).
- Money in STATE and tool data is integer pence: £12.50 is 1250.

Acting:
- Call a tool when you need data you don't have or the merchant asks you to do something. One tool per step.
- Tools marked [asks the merchant to confirm first] are shown to the merchant as Confirm/Cancel: call them directly when asked; don't ask for permission in prose first.
- Don't repeat a tool call you already made this turn; use its result.

Answer with a single JSON object, either
{"thought": "<why, one line>", "tool": "<tool name>", "args": {…}}
or
{"reply": "<your message to the merchant>", "suggestions": ["<short follow-up the merchant might send>", …up to 3]}`;

const DecisionSchema = z
  .object({
    thought: z.string().max(600).optional(),
    tool: z.string().max(60).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    reply: z.string().max(3000).optional(),
    suggestions: z.array(z.string().max(80)).max(4).optional(),
  })
  .refine((d) => Boolean(d.tool) || Boolean(d.reply?.trim()), { message: "Give either a tool to call or a reply." });

type Decision = z.infer<typeof DecisionSchema>;

function transcript(messages: AssistantMessage[]): string {
  return messages.map((m) => `${m.role === "user" ? "Merchant" : "Darwin"}: ${m.content}`).join("\n");
}

function observations(actions: (AssistantAction & { data?: unknown })[]): string {
  if (!actions.length) return "(none yet)";
  return actions
    .map((a, i) => {
      let data = "";
      try {
        data = a.data === undefined ? "" : ` data: ${JSON.stringify(a.data).slice(0, 1800)}`;
      } catch {
        /* unserialisable: summary only */
      }
      return `${i + 1}. ${a.tool}(${JSON.stringify(a.args)}) → ${a.ok ? "ok" : "FAILED"}${a.synthetic ? " [synthetic]" : ""}: ${a.summary}${data}`;
    })
    .join("\n");
}

export function buildPrompt(opts: {
  messages: AssistantMessage[];
  snapshot?: StateSnapshot;
  ctx: ToolContext;
  actions: (AssistantAction & { data?: unknown })[];
  note?: string;
  mustReply?: boolean;
}): string {
  return [
    `TOOLS:\n${toolCatalog()}`,
    `STATE (live, ${new Date().toISOString()}):\n${opts.snapshot ? JSON.stringify(opts.snapshot) : "(unavailable)"}`,
    opts.ctx.path || opts.ctx.site ? `PAGE: the merchant is on ${opts.ctx.path ?? "the console"}${opts.ctx.site ? ` (site "${opts.ctx.site}")` : ""}.` : "",
    `CONVERSATION:\n${transcript(opts.messages)}`,
    `TOOL RESULTS THIS TURN:\n${observations(opts.actions)}`,
    opts.note ?? "",
    opts.mustReply ? 'You are out of steps: answer now with {"reply": …} using the results above.' : "Decide the next step.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------------ proactive hints (from real state) */

export function nextStepHint(s: StateSnapshot | undefined): string {
  if (!s) return "";
  const { phase, generation } = s.loop;
  if (s.loop.autopilot) return "Autopilot is on, so the loop keeps running while the console is open.";
  switch (phase) {
    case "idle":
      return "Next: say “run the loop” and I'll start watching how shoppers and agents behave.";
    case "observe":
      return "Next: step the loop and I'll diagnose where shoppers drop off.";
    case "diagnose":
      return "Next: step the loop and I'll propose a page change for the top problem.";
    case "propose":
      return "Next: step the loop to start the A/B test.";
    case "experiment":
      return "The A/B test is collecting traffic: keep stepping, or turn autopilot on.";
    case "decide":
      return "Next: step the loop to act on the result.";
    case "ship":
      return s.lastCompleted?.decision === "ship"
        ? `Gen ${generation} is live. Want me to open the pull request shipping it?`
        : `Gen ${generation} is live. Step the loop to start the next generation.`;
  }
}

export function suggestionsFor(s: StateSnapshot | undefined, lastTool?: string): string[] {
  const out: string[] = [];
  const add = (x: string) => {
    if (!out.includes(x)) out.push(x);
  };
  if (s && !s.loop.autopilot) add(s.loop.phase === "idle" ? "Run the loop" : "Step the loop");
  if (s?.lastCompleted?.decision === "ship" && lastTool !== "ship_winner") add("Ship the winner");
  if (lastTool !== "get_kpis") add("How are we doing?");
  if (s && s.runningExperiments.length && lastTool !== "list_experiments") add("Show experiments");
  if (lastTool !== "send_test_shopper") add("Send a test shopper");
  add("Audit allbirds.com");
  return out.slice(0, 3);
}

/* ------------------------------------------------------------------ heuristic intent router */

export interface RoutedIntent {
  calls: { tool: ToolName; args: Record<string, unknown> }[];
  /** Answer without tools (help, greetings). */
  reply?: string;
}

export const HELP_TEXT = `I'm Darwin, your store's managing assistant. Try:
- “How are we doing?” (KPIs, humans vs AI agents)
- “Run the loop” / “Where's the loop?”
- “Show experiments” / “Ship the winner”
- “Autopilot on” / “Autopilot off”
- “Chart coupon codes per minute” / “Show my dashboards”
- “Suggest personalization ideas”
- “Simulate 200 shoppers” (synthetic traffic)
- “Send a shopper for trail shoes under £140”
- “Audit shop.example.com” / “Certify shop.example.com”
- “Agent funnel”`;

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i;

function extractUrl(text: string): string | undefined {
  const m = text.match(URL_RE)?.[1];
  return m?.replace(/[.,;:!?)]+$/, "");
}

function numberNear(text: string, words: RegExp): number | undefined {
  const m = text.match(new RegExp(`(\\d[\\d,]*)\\s*(?:simulated\\s+|synthetic\\s+|fake\\s+|test\\s+)?${words.source}`, "i"));
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

/** Map one merchant message to tool calls. Order matters: specific intents before broad ones. */
export function routeIntent(message: string): RoutedIntent {
  const text = message.trim();
  const t = ` ${text.toLowerCase()} `;
  const url = extractUrl(text);

  if (/^\s*(help|\?|what can you do|commands?)\b/.test(text.toLowerCase()) || /\bwhat can you do\b|\bhow do i use\b/.test(t)) return { calls: [], reply: HELP_TEXT };
  if (/^\s*(hi|hey|hello|yo|morning|good (morning|afternoon|evening))\b[\s!.]*$/i.test(text)) {
    return { calls: [{ tool: "get_kpis", args: {} }] };
  }

  if (/\bcertif(y|icate|ied|ication)\b/.test(t)) {
    return url ? { calls: [{ tool: "certify_store", args: { url } }] } : { calls: [], reply: "Which store should I certify? Send me its URL, e.g. “certify shop.example.com”." };
  }
  if (/\b(competitor|competition|rivals?|market research|research)\b/.test(t)) return { calls: [{ tool: "research_competitors", args: { question: text.trim().slice(0, 300) } }] };
  if (/\b(audit|readiness|agent[- ]ready|scan|check)\b/.test(t) && url) return { calls: [{ tool: "audit_readiness", args: { url } }] };
  if (/\b(audit|readiness)\b/.test(t)) return { calls: [], reply: "Which store should I audit? Send me its URL, e.g. “audit shop.example.com”." };

  if (/\bauto ?pilot\b/.test(t)) {
    const off = /\b(off|stop|disable|pause|halt|turn it off)\b/.test(t);
    const on = /\b(on|start|enable|resume|turn it on|go)\b/.test(t);
    if (off || on) return { calls: [{ tool: "set_autopilot", args: { on: !off } }] };
    return { calls: [{ tool: "loop_status", args: {} }] };
  }
  if (/\breset\b|\bstart over\b|\bback to gen ?0\b/.test(t)) return { calls: [{ tool: "reset_loop", args: {} }] };
  if (/\bship\b|\bopen (a |the )?(pr|pull request)\b|\bmerge the winner\b/.test(t)) {
    const exp = text.match(/\b(exp_[a-z0-9]+)\b/i)?.[1];
    return { calls: [{ tool: "ship_winner", args: exp ? { experimentId: exp } : {} }] };
  }

  if (/\b(chart|graph|plot|visuali[sz]e)\b/.test(t) || /\b(add|show)\b.*\bper (minute|hour|day)\b/.test(t)) {
    return { calls: [{ tool: "add_chart", args: { request: text.slice(0, 300) } }] };
  }
  if (/\bdashboards?\b/.test(t)) return { calls: [{ tool: "list_dashboards", args: {} }] };

  if (/\b(simulat|synthetic traffic|fake traffic|generate traffic)/.test(t)) {
    const humans = numberNear(text, /(humans?|shoppers?|visitors?|people|users?)/);
    const agents = numberNear(text, /(agents?|bots?|ai)/);
    const args: Record<string, unknown> = {};
    if (humans !== undefined) args.humans = Math.min(2000, humans);
    if (agents !== undefined) args.agents = Math.min(200, agents);
    return { calls: [{ tool: "run_simulation", args }] };
  }
  if (/\b(send|run|launch|try)\b.*\b(shopper|buyer|agent)\b|\btest shopper\b|\bmystery shop/.test(t)) {
    const brief = text.match(/\b(?:for|looking for|to buy|wants?)\s+(.{3,200})$/i)?.[1];
    return { calls: [{ tool: "send_test_shopper", args: brief ? { brief } : {} }] };
  }
  if (/\bdemo (store|mode|data)\b|\bis (this|it|any of this) real\b|\bconnect(ed)? (my|a|your) (site|store)\b/.test(t)) return { calls: [{ tool: "explore_demo_store", args: {} }] };
  if (/\bagent (funnel|sales|conversations?)\b|\ba2a\b|\bstore agent\b/.test(t)) return { calls: [{ tool: "agent_funnel", args: {} }] };

  if (/\b(step|advance|next phase|run the loop|run loop|kick off|start the loop|run a generation|next generation|improve)\b/.test(t)) {
    return { calls: [{ tool: "step_loop", args: {} }] };
  }
  if (/\b(loop|phase|generation|where are we|what'?s darwin doing|status|insights?|proposal)\b/.test(t)) return { calls: [{ tool: "loop_status", args: {} }] };
  if (/\b(experiments?|a\/b|ab tests?|split tests?|tests?|winner|lift)\b/.test(t)) return { calls: [{ tool: "list_experiments", args: {} }] };
  if (/\b(personali[sz]|web rules?|rules?|ideas?|suggest)/.test(t)) return { calls: [{ tool: "suggest_web_rules", args: {} }] };

  if (/\b(how are we|how'?s (it|the store|business)|doing|kpis?|metrics|numbers|stats|conversion|revenue|sales|orders|visitors|traffic|performance|overview|summary)\b/.test(t)) {
    return { calls: [{ tool: "get_kpis", args: /\breal\b/.test(t) ? { realOnly: true } : {} }] };
  }

  return { calls: [{ tool: "get_kpis", args: {} }], reply: "I'm not sure what you meant, so here's where things stand. Say “help” to see what I can do." };
}

/* ------------------------------------------------------------------ running tools */

type ActionWithData = AssistantAction & { data?: unknown };

async function execute(tool: string, args: unknown, ctx: ToolContext): Promise<ActionWithData> {
  const out = await runTool(tool, args, ctx);
  return { tool, args: out.args, ok: out.ok, summary: out.summary, synthetic: out.synthetic || undefined, link: out.link, data: out.data };
}

function publicAction(a: ActionWithData): AssistantAction {
  const { tool, args, ok, summary, synthetic, link } = a;
  return { tool, args, ok, summary, ...(synthetic ? { synthetic } : {}), ...(link ? { link } : {}) };
}

function pending(tool: string, args: unknown): AssistantPendingConfirm | undefined {
  const c = confirmPromptFor(tool, args);
  return c ? { tool, args: c.args, prompt: c.prompt } : undefined;
}

function safeSnapshot(): StateSnapshot | undefined {
  try {
    return stateSnapshot();
  } catch (err) {
    console.warn("[assistant] state snapshot failed:", String(err).slice(0, 200));
    return undefined;
  }
}

/** After these, a "what to do next in the loop" hint helps; after anything else it's noise. */
const LOOP_TOOLS = new Set(["get_kpis", "loop_status", "step_loop", "list_experiments", "run_simulation", "reset_loop", "explore_demo_store"]);

/** Reply built only from tool summaries + a next-step hint (heuristic path, and LLM failure fallback). */
function composeReply(actions: ActionWithData[], snapshot: StateSnapshot | undefined, lead?: string): string {
  const lines: string[] = [];
  if (lead) lines.push(lead);
  for (const a of actions) lines.push(a.summary);
  const last = actions.at(-1);
  const hint = last && LOOP_TOOLS.has(last.tool) ? nextStepHint(snapshot) : "";
  if (hint && !(last && !last.ok)) lines.push(hint);
  return lines.join("\n\n");
}

function cleanMessages(messages: AssistantMessage[]): AssistantMessage[] {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

/* ------------------------------------------------------------------ entry point */

export async function runAssistant(input: RunAssistantInput): Promise<AssistantResponse> {
  const messages = cleanMessages(input.messages ?? []);
  const ctx: ToolContext = { origin: input.origin, site: input.context?.site, path: input.context?.path };
  const useLlm = llmAvailable();

  /* ---- the merchant answered a pending confirmation */
  if (input.confirm) {
    const { tool, args = {}, approved } = input.confirm;
    const t = getTool(tool);
    if (!t?.requiresConfirm) {
      return { reply: `There's nothing to confirm for “${tool}”.`, actions: [], model: "heuristic", suggestions: suggestionsFor(safeSnapshot()) };
    }
    if (!approved) {
      return { reply: "Okay, cancelled. Nothing changed.", actions: [], model: "heuristic", suggestions: suggestionsFor(safeSnapshot()) };
    }
    const action = await execute(tool, args, ctx);
    if (useLlm) {
      const done = await llmLoop(messages, ctx, [action], `The merchant confirmed ${tool}; it has run (result 1). Tell them the outcome and the next step.`);
      if (done) return done;
    }
    const snapshot = safeSnapshot();
    return { reply: composeReply([action], snapshot), actions: [publicAction(action)], model: "heuristic", suggestions: suggestionsFor(snapshot, tool) };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    const snapshot = safeSnapshot();
    return { reply: HELP_TEXT, actions: [], model: useLlm ? llmLabel() : "heuristic", suggestions: suggestionsFor(snapshot) };
  }

  if (useLlm) {
    const done = await llmLoop(messages, ctx, []);
    if (done) return done;
  }
  return heuristicTurn(lastUser.content, ctx);
}

/** The keyword router's turn: run what it picked (stopping at anything that needs confirmation). */
export async function heuristicTurn(message: string, ctx: ToolContext = {}): Promise<AssistantResponse> {
  const routed = routeIntent(message);
  const actions: ActionWithData[] = [];
  for (const call of routed.calls) {
    const blocked = precheckFor(call.tool, call.args);
    if (blocked) {
      actions.push({ tool: call.tool, args: call.args, ok: false, summary: blocked });
      continue;
    }
    const ask = pending(call.tool, call.args);
    if (ask) {
      const snapshot = safeSnapshot();
      return {
        reply: [...actions.map((a) => a.summary), ask.prompt].join("\n\n"),
        actions: actions.map(publicAction),
        pendingConfirm: ask,
        model: "heuristic",
        suggestions: suggestionsFor(snapshot, call.tool),
      };
    }
    actions.push(await execute(call.tool, call.args, ctx));
  }
  const snapshot = safeSnapshot();
  const reply = actions.length ? composeReply(actions, snapshot, routed.reply) : (routed.reply ?? HELP_TEXT);
  return { reply, actions: actions.map(publicAction), model: "heuristic", suggestions: suggestionsFor(snapshot, actions.at(-1)?.tool) };
}

/**
 * The LLM tool loop. Returns undefined when the model failed before anything ran (caller falls back to the
 * heuristic router); once tools have run, a failure still returns a reply composed from their results.
 */
async function llmLoop(messages: AssistantMessage[], ctx: ToolContext, seed: ActionWithData[], note?: string): Promise<AssistantResponse | undefined> {
  const actions: ActionWithData[] = [...seed];
  const model = llmLabel();
  const seen = new Set(seed.map((a) => `${a.tool}:${JSON.stringify(a.args)}`));
  let repeats = 0;

  const finish = (reply: string, extra: Partial<AssistantResponse> = {}, suggestions?: string[]): AssistantResponse => {
    const snapshot = safeSnapshot();
    return {
      reply: reply.trim(),
      actions: actions.map(publicAction),
      model,
      suggestions: suggestions?.length ? suggestions.slice(0, 3) : suggestionsFor(snapshot, actions.at(-1)?.tool),
      ...extra,
    };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const mustReply = step === MAX_STEPS - 1 || repeats >= 2;
    let decision: Decision;
    try {
      decision = await generateJson({
        system: PERSONA,
        prompt: buildPrompt({ messages, snapshot: safeSnapshot(), ctx, actions, note, mustReply }),
        schema: DecisionSchema,
        maxTokens: 1200,
      });
    } catch (err) {
      console.warn("[assistant] LLM step failed:", String(err).slice(0, 200));
      if (!actions.length) return undefined;
      const snapshot = safeSnapshot();
      return { ...finish(composeReply(actions, snapshot)), model: "heuristic" };
    }

    if (decision.reply?.trim() && (!decision.tool || mustReply)) return finish(decision.reply, {}, decision.suggestions);
    if (!decision.tool || mustReply) {
      // Wanted another tool with no steps left: summarise what ran.
      return { ...finish(composeReply(actions, safeSnapshot())), model: actions.length ? model : "heuristic" };
    }

    const t = getTool(decision.tool);
    if (!t) {
      actions.push({ tool: decision.tool, args: decision.args ?? {}, ok: false, summary: `There is no tool called “${decision.tool}”. Use one from TOOLS.` });
      repeats++;
      continue;
    }
    if (t.requiresConfirm) {
      const blocked = precheckFor(decision.tool, decision.args ?? {});
      if (blocked) {
        actions.push({ tool: decision.tool, args: decision.args ?? {}, ok: false, summary: blocked });
        repeats++;
        continue;
      }
      const ask = pending(decision.tool, decision.args ?? {});
      if (!ask) {
        actions.push({ tool: decision.tool, args: decision.args ?? {}, ok: false, summary: `Invalid arguments for ${decision.tool}.` });
        repeats++;
        continue;
      }
      const done = actions.filter((a) => a.ok).map((a) => a.summary);
      return finish([...done, ask.prompt].join("\n\n"), { pendingConfirm: ask });
    }
    const key = `${decision.tool}:${JSON.stringify(decision.args ?? {})}`;
    if (seen.has(key)) {
      repeats++;
      note = `${note ? `${note}\n` : ""}You already called ${decision.tool} with those arguments this turn; its result is above. Reply now.`;
      continue;
    }
    seen.add(key);
    actions.push(await execute(decision.tool, decision.args ?? {}, ctx));
  }
  return { ...finish(composeReply(actions, safeSnapshot())), model: actions.length ? model : "heuristic" };
}
