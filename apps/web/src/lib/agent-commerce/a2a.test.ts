import { beforeEach, describe, expect, it } from "vitest";
import { GET as cardRoute, POST } from "@/app/api/a2a/route";
import { GET as llmsTxt } from "@/app/llms.txt/route";
import { listAgentSessions } from "./index";
import { eventsNamed, OPEN_SURFACE, resetWorld, useSpec } from "./test-utils";
import { merchantFloor } from "./negotiation";
import { PRODUCTS } from "@/lib/catalog/products";

beforeEach(resetWorld);

const URL_BASE = "http://localhost:3000";
const HEADERS = { "content-type": "application/json", "x-agent-name": "gemini-buyer", "x-agent-id": "agt_a2a" };

let rpcId = 0;
async function rpc(method: string, params: unknown, headers: Record<string, string> = HEADERS) {
  const res = await POST(new Request(`${URL_BASE}/api/a2a`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) }));
  expect(res.status).toBe(200);
  return res.json();
}

async function say(text: string, contextId?: string, data?: Record<string, unknown>) {
  const parts: unknown[] = [{ kind: "text", text }];
  if (data) parts.push({ kind: "data", data });
  const body = await rpc("message/send", { message: { kind: "message", role: "user", messageId: `m${rpcId}`, parts, ...(contextId ? { contextId } : {}) } });
  expect(body.error).toBeUndefined();
  const msg = body.result;
  const text_ = msg.parts.find((p: { kind: string }) => p.kind === "text").text as string;
  const data_ = msg.parts.find((p: { kind: string }) => p.kind === "data")?.data;
  return { msg, text: text_, data: data_, contextId: msg.contextId as string };
}

describe("A2A merchant agent (POST /api/a2a)", () => {
  it("shortlists from a plain-English brief, then orders in the same conversation", async () => {
    useSpec(OPEN_SURFACE);
    const first = await say("Trail shoes, UK 10, under £150, delivered by Friday");
    expect(first.msg).toMatchObject({ kind: "message", role: "agent" });
    expect(first.contextId).toMatch(/^ctx_/);
    expect(first.data.products.length).toBeGreaterThan(0);
    expect(first.data.products.every((p: { category: string; price: { amount: number } }) => p.category === "trail" && p.price.amount <= 15000)).toBe(true);
    expect(first.text).toMatch(/1\. Ridge Trail Pro: £135\.00/);
    expect(first.text).toMatch(/arrives in \d+ days?/);

    const order = await say("Great, buy the first one", first.contextId);
    expect(order.text).toMatch(/^Done: order ord_\w+ for Ridge Trail Pro \(UK 10\), £139\.95/);
    expect(order.data.order).toMatchObject({ total: 13995 });

    const [session] = listAgentSessions(1);
    expect(session).toMatchObject({ sessionId: `a2a_${first.contextId}`, agentName: "gemini-buyer", outcome: "purchased", synthetic: false });
    expect(session.goal?.brief).toBe("Trail shoes, UK 10, under £150, delivered by Friday");
    // The conversation shows in the console: buyer and merchant turns.
    expect(session.negotiation?.map((t) => t.from)).toEqual(["buyer", "merchant", "buyer", "merchant"]);
    expect(eventsNamed("agent_request").every((e) => e.properties.channel === "a2a" && e.properties.agent_name === "gemini-buyer")).toBe(true);
    expect(eventsNamed("order_completed")).toHaveLength(1);
  });

  it("only tells agents what the store exposes, and the gaps count as agent demand", async () => {
    const hidden = await say("Trail shoes, UK 10, delivered by Friday");
    expect(hidden.text).not.toMatch(/arrives in/);
    expect(hidden.text).toMatch(/not able to share stock levels and delivery times/);
    const search = eventsNamed("agent_request").find((e) => e.properties.tool === "search_products")!;
    expect(search.properties.missing).toEqual(expect.arrayContaining(["sizes", "deliveryEtaDays"]));
  });

  it("negotiates only when the spec allows it, never below the merchant floor", async () => {
    const closed = await say("Road shoes UK 9");
    const refused = await say("Would you take £80 for the first one?", closed.contextId);
    expect(refused.text).toMatch(/does not negotiate/);

    useSpec(OPEN_SURFACE);
    const open = await say("Road shoes UK 9, best price please");
    expect(open.text).toMatch(/make me an offer/);
    const aurora = PRODUCTS.find((p) => p.id === open.data.products[0].id)!;
    const floor = merchantFloor(aurora, 15);
    let last = await say(`Would you take £${Math.floor(aurora.price / 200)}?`, open.contextId);
    for (let i = 0; i < 4 && !last.data?.negotiation?.agreedPrice; i++) {
      const counter = last.data?.negotiation?.counterOffer ?? aurora.price;
      last = await say(`How about £${Math.round((counter - 500) / 100)}?`, open.contextId);
    }
    const deal = last.data?.negotiation;
    expect(deal).toBeDefined();
    for (const price of [deal.counterOffer, deal.agreedPrice].filter((v) => v !== undefined)) expect(price).toBeGreaterThanOrEqual(floor);
  });

  it("asks for a size before ordering and answers product questions by ordinal", async () => {
    useSpec(OPEN_SURFACE);
    const first = await say("I need racing shoes for a marathon");
    const details = await say("Tell me about the first one", first.contextId);
    expect(details.data.product.id).toBe(first.data.products[0].id);
    const ask = await say("buy it", first.contextId);
    expect(ask.text).toMatch(/Which size/);
    const done = await say("UK 9 please, go ahead", first.contextId);
    expect(done.text).toMatch(/^Done: order/);
  });

  it("speaks A2A v1.0 too (SendMessage, proto-JSON parts) in the same conversation store", async () => {
    useSpec(OPEN_SURFACE);
    const send = (text: string, contextId?: string) =>
      rpc("SendMessage", { message: { messageId: `v1_${rpcId}`, role: "ROLE_USER", parts: [{ text }], ...(contextId ? { contextId } : {}) } });
    const first = await send("Carbon racing shoes, UK 9");
    expect(first.result.message).toMatchObject({ role: "ROLE_AGENT", parts: [{ text: expect.stringMatching(/Velocity Carbon/) }, { data: { products: expect.any(Array) } }] });
    const done = await send("buy the first one", first.result.message.contextId);
    expect(done.result.message.parts[0].text).toMatch(/^Done: order ord_/);
    expect((await rpc("GetTask", { id: "t1" })).error.code).toBe(-32001);
    expect((await rpc("SendMessage", { message: { role: "ROLE_AGENT", parts: [{ text: "hi" }] } })).error.code).toBe(-32602);
  });

  it("speaks JSON-RPC errors the A2A way", async () => {
    expect((await rpc("tasks/get", { id: "t1" })).error.code).toBe(-32001);
    expect((await rpc("message/stream", {})).error.code).toBe(-32004);
    expect((await rpc("nope", {})).error.code).toBe(-32601);
    expect((await rpc("message/send", { message: { role: "agent", parts: [] } })).error.code).toBe(-32602);
    const bad = await POST(new Request(`${URL_BASE}/api/a2a`, { method: "POST", headers: HEADERS, body: "{" }));
    expect((await bad.json()).error.code).toBe(-32700);
  });

  it("is advertised in the agent card and llms.txt", async () => {
    const card = await (await cardRoute(new Request(`${URL_BASE}/api/a2a`))).json();
    expect(card).toMatchObject({ protocolVersion: "0.3.0", url: `${URL_BASE}/api/a2a`, preferredTransport: "JSONRPC" });
    expect(card.supportedInterfaces).toEqual([
      { url: `${URL_BASE}/api/a2a`, protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: `${URL_BASE}/api/a2a`, protocolBinding: "JSONRPC", protocolVersion: "0.3" },
    ]);
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(["shop", "product_details", "checkout"]);
    const txt = await (await llmsTxt(new Request(`${URL_BASE}/llms.txt`))).text();
    expect(txt).toContain(`POST ${URL_BASE}/api/a2a`);
  });
});
