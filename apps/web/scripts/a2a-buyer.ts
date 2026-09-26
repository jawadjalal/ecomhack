/**
 * a2a-buyer: a buyer agent that talks to PACE's merchant agent in plain English over A2A (JSON-RPC).
 *
 *   npx tsx scripts/a2a-buyer.ts --url http://localhost:3000 --brief "trail shoes UK 10 under £150 by Friday"
 *
 * Flow: read the agent card → send the brief → (haggle if the merchant offers it) → buy the first option.
 * The conversation shows in the console's agent-to-agent panel. It is scripted, so it is labelled
 * synthetic (x-darwin-synthetic: 1); a real A2A agent pointed at /api/a2a shows as REAL.
 *
 * Options: --url, --brief, --name <agent name>, --no-haggle
 */
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    brief: { type: "string", default: "Trail shoes, UK 10, under £150, delivered by Friday" },
    name: { type: "string", default: "a2a-buyer" },
    "no-haggle": { type: "boolean", default: false },
  },
});

const base = values.url!.replace(/\/$/, "");
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint("1"), dim: paint("2"), pink: paint("35"), green: paint("32"), cyan: paint("36") };

type Part = { text?: string; data?: Record<string, unknown> };
interface Reply {
  contextId: string;
  text: string;
  data: Record<string, unknown>;
}

let rpcId = 0;
async function send(text: string, contextId?: string): Promise<Reply> {
  console.log(`\n  ${c.pink("🤖 buyer")}     ${text}`);
  const res = await fetch(`${base}/api/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-name": values.name!, "x-darwin-synthetic": "1" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "SendMessage",
      params: { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], ...(contextId ? { contextId } : {}) } },
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  const parts: Part[] = body.result.message.parts;
  const reply = {
    contextId: body.result.message.contextId,
    text: parts.map((p) => p.text).filter(Boolean).join("\n"),
    data: Object.assign({}, ...parts.map((p) => p.data ?? {})),
  };
  const [first, ...rest] = reply.text.split("\n");
  console.log(`  ${c.cyan("🏪 merchant")}  ${first}`);
  for (const line of rest) console.log(`               ${line}`);
  return reply;
}

async function main() {
  const card = await fetch(`${base}/.well-known/agent-card.json`).then((r) => r.json());
  console.log(c.bold(`\n  ${card.name}`) + c.dim(`  ${card.url}  (A2A ${card.supportedInterfaces?.map((i: { protocolVersion: string }) => i.protocolVersion).join(", ") ?? card.protocolVersion})`));
  console.log(c.dim(`  skills: ${card.skills.map((s: { id: string }) => s.id).join(", ")}`));

  let reply = await send(values.brief!);
  const products = (reply.data.products as { name: string; price: { amount: number } }[] | undefined) ?? [];
  if (!products.length) return;
  const ctx = reply.contextId;

  if (!values["no-haggle"] && /make me an offer/.test(reply.text)) {
    let offer = Math.floor((products[0].price.amount * 0.85) / 100);
    for (let round = 0; round < 3; round++) {
      reply = await send(`Would you take £${offer} for the ${products[0].name}?`, ctx);
      const deal = reply.data.negotiation as { status: string; counterOffer?: number } | undefined;
      if (!deal || deal.status === "accepted" || deal.status === "final" || !deal.counterOffer) break;
      offer = Math.round((offer * 100 + deal.counterOffer) / 2 / 100);
    }
  }
  reply = await send("Great, buy it.", ctx);
  if (!/^Done/.test(reply.text) && /Which size/.test(reply.text)) reply = await send("UK 10 please.", ctx);
  console.log(/^Done/.test(reply.text) ? c.green(c.bold("\n  ✓ Bought over A2A\n")) : c.dim("\n  No purchase.\n"));
}

main().catch((e) => {
  console.error(`\n  ${String(e.message ?? e)}\n  Is the store running? cd apps/web && npm run dev\n`);
  process.exit(1);
});
