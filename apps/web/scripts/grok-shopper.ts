/**
 * grok-shopper: an AI buyer agent that shops the PACE store over MCP (Streamable HTTP).
 *
 *   npx tsx scripts/grok-shopper.ts --url http://localhost:3000 --goal "trail shoes UK 10 under £140 by Friday"
 *
 * Flow: initialize → notifications/initialized → tools/list → tools/call loop.
 * With XAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY (read from .env.local) the LLM picks each
 * tool call; without one (or with --scripted, or if the LLM errors) it runs the scripted buyer
 * policy, still over MCP. Every call is tracked by the store like any other agent.
 *
 * Options: --url, --goal, --name <agent name>, --agent-id <stable id>, --scripted, --max-steps <n>
 */
import { parseArgs } from "node:util";
import { runScriptedBuyer, sizeLabel, deadlineLabel, parseGoalBrief, type BuyerRunResult, type BuyerStep } from "@/lib/agent-commerce/buyer";
import { runLlmBuyer } from "@/lib/agent-commerce/buyer-llm";
import { connectMcp, type McpConnection } from "@/lib/agent-commerce/mcp-client";
import type { AgentOrder, AgentToolName, AgentToolResult, CartView, NegotiationOutcome, ToolCaller } from "@/lib/agent-commerce/types";
import type { AgentProduct, ShoppingGoal } from "@/lib/contracts";
import { llmLabel, llmProvider } from "@/lib/llm/client";
import { formatGBP } from "@/lib/money";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* optional */
  }
}

/* ------------------------------------------------------------------ output */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
  gray: paint("90"),
};
const log = (s = "") => console.log(s);
const indent = (s: string, n = 4) => s.replace(/^/gm, " ".repeat(n));

/* ------------------------------------------------------------------ MCP client */

async function connect(endpoint: string, headers: Record<string, string>) {
  return connectMcp(endpoint, { headers, clientName: headers["x-agent-name"] });
}

/* ------------------------------------------------------------------ transcript */

function summarise(tool: AgentToolName, r: AgentToolResult): string {
  const missing = r.missing?.length ? c.yellow(`  missing: ${r.missing.join(", ")}`) : "";
  if (!r.ok) return `${c.red("✗")} ${r.error ?? "failed"}${missing}`;
  switch (tool) {
    case "search_products": {
      const ps = (r.data as AgentProduct[]) ?? [];
      const top = ps.slice(0, 4).map((p) => {
        const extra = [
          p.deliveryEtaDays !== undefined ? `${p.deliveryEtaDays}d delivery` : undefined,
          p.landedPrice ? `landed ${formatGBP(p.landedPrice.amount)}` : undefined,
          p.returnPolicy ? `${p.returnPolicy.free ? "free" : "paid"} returns` : undefined,
        ].filter(Boolean);
        return `${p.name} ${formatGBP(p.price.amount)}${extra.length ? c.gray(` (${extra.join(", ")})`) : ""}`;
      });
      return `${c.green("✓")} ${ps.length} product${ps.length === 1 ? "" : "s"}: ${top.join("; ")}${missing}`;
    }
    case "get_product": {
      const p = r.data as AgentProduct & { tagline?: string };
      return `${c.green("✓")} ${p.name}, ${formatGBP(p.price.amount)} ${c.gray(`"${p.tagline ?? ""}"`)}${missing}`;
    }
    case "check_availability": {
      const a = r.data as { size: string; inStock: boolean; quantity: number };
      return a.inStock ? `${c.green("✓")} ${sizeLabel(a.size)} in stock (${a.quantity} left)` : `${c.red("✗")} ${sizeLabel(a.size)} sold out`;
    }
    case "add_to_cart":
    case "get_cart": {
      const cart = r.data as CartView;
      return `${c.green("✓")} cart: ${cart.items.map((l) => `${l.quantity}× ${l.name} @ ${formatGBP(l.unitPrice)}`).join(", ")} · subtotal ${formatGBP(cart.subtotal)}`;
    }
    case "negotiate": {
      const o = r.data as NegotiationOutcome;
      const tag = o.status === "accepted" ? c.green("DEAL") : o.status === "final" ? c.yellow("FINAL") : c.cyan("COUNTER");
      return `${tag} ${c.magenta(`merchant: "${o.message}"`)}`;
    }
    case "checkout": {
      const o = r.data as AgentOrder;
      return `${c.green("✓")} order ${o.orderId}: ${formatGBP(o.total)} (incl. ${formatGBP(o.shipping)} shipping), arrives in ${o.deliveryEtaDays} days`;
    }
    case "abandon":
      return c.gray("logged with the merchant");
  }
}

function describeGoal(goal: ShoppingGoal): string {
  const parts: string[] = [goal.category ?? "any category"];
  if (goal.size) parts.push(sizeLabel(goal.size));
  if (goal.maxBudget !== undefined) parts.push(`≤ ${formatGBP(goal.maxBudget)}`);
  if (goal.deadlineDays !== undefined) parts.push(`delivered ${deadlineLabel(goal)} (${goal.deadlineDays}d)`);
  if (goal.requiresFreeReturns) parts.push("free returns");
  if (goal.negotiates) parts.push("will negotiate");
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ main */

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: process.env.DARWIN_URL ?? "http://localhost:3000" },
      goal: { type: "string", default: "Trail shoes, UK 10, under £140, delivered by Friday" },
      name: { type: "string" },
      "agent-id": { type: "string" },
      scripted: { type: "boolean", default: false },
      "max-steps": { type: "string", default: "8" },
    },
  });

  const provider = llmProvider();
  const useLlm = !values.scripted && provider !== "none";
  const defaultName = { xai: "grok-shopper", apinex: "luna-shopper", anthropic: "claude-shopper", openrouter: "openrouter-shopper", none: "scripted-shopper" }[provider];
  const agentName = values.name ?? (useLlm ? defaultName : "scripted-shopper");
  const endpoint = `${values.url!.replace(/\/$/, "")}/api/mcp`;
  const goal = parseGoalBrief(values.goal!);
  const headers: Record<string, string> = {
    "x-agent-name": agentName,
    "user-agent": `${agentName}/1.0 (+darwin)`,
    ...(values["agent-id"] ? { "x-agent-id": values["agent-id"] } : {}),
    // A scripted policy is simulated traffic: the console labels it SYNTHETIC, not REAL.
    ...(useLlm ? {} : { "x-darwin-synthetic": "1" }),
  };

  log(c.bold(`\n  PACE store over MCP  ${c.gray(endpoint)}`));
  log(`  ${c.bold("Agent")}  ${agentName} ${c.gray(useLlm ? `(${llmLabel()} picks every tool call)` : "(scripted policy: no LLM key or --scripted)")}`);
  log(`  ${c.bold("Goal")}   ${values.goal}`);
  log(`         ${c.gray(describeGoal(goal))}\n`);

  let session;
  try {
    session = await connect(endpoint, headers);
  } catch (err) {
    log(c.red(`  Could not reach ${endpoint}: ${String((err as Error).message ?? err)}`));
    log(c.gray("  Is the store running? cd apps/web && npm run dev"));
    process.exit(1);
  }
  const info = session.serverInfo ?? {};
  log(c.blue(`  ⇄ initialize  → ${info.name} ${info.version}, protocol ${session.protocolVersion}, session ${session.sessionId}`));
  log(c.blue(`  ⇄ tools/list  → ${session.tools.map((t) => t.name).join(", ")}\n`));

  let n = 0;
  const onThought = (text: string) => log(indent(c.cyan(`… ${text}`), 2));
  const onStep = (step: BuyerStep) => {
    n++;
    log(`  ${c.bold(`[${n}]`)} ${c.bold(step.tool)} ${c.gray(JSON.stringify(step.args))}`);
    if (step.tool === "negotiate" && typeof step.args.message === "string") log(indent(c.yellow(`buyer: "${step.args.message}"`), 6));
    log(indent(summarise(step.tool, step.result), 6));
  };

  const makeCaller = (client: McpConnection): ToolCaller => (tool, args) => client.call(tool, args);
  let result: BuyerRunResult | undefined;
  if (useLlm) {
    try {
      result = await runLlmBuyer(goal, makeCaller(session), {
        tools: session.tools,
        maxSteps: Number(values["max-steps"]) || 8,
        onStep,
        onThought,
      });
    } catch (err) {
      log(c.yellow(`\n  LLM unavailable (${String((err as Error).message ?? err).slice(0, 160)}); switching to the scripted policy on a fresh MCP session.\n`));
      session = await connect(endpoint, { ...headers, "x-darwin-synthetic": "1" });
    }
  }
  result ??= await runScriptedBuyer(goal, makeCaller(session), { seed: session.sessionId ?? agentName, onStep, onThought });

  log("");
  if (result.outcome === "purchased" && result.order) {
    const o = result.order;
    const items = o.items.map((l) => `${l.name} (${sizeLabel(l.size)})`).join(" + ");
    const saved = o.discount > 0 ? c.green(` · saved ${formatGBP(o.discount)} by negotiating`) : "";
    log(c.bold(c.green(`  ✓ PURCHASED  ${items} for ${formatGBP(o.total)}${saved}`)));
  } else {
    log(c.bold(c.red(`  ✗ ABANDONED  ${result.reason ?? "no reason"}`)));
  }
  log(c.gray(`  ${result.steps.length} tool calls · policy: ${result.policy} · session ${session.sessionId}\n`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
