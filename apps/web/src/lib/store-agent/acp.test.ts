import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore, track } from "@/lib/analytics/store";
import { resetIngestRate } from "@/lib/analytics/trust";
import { agentFunnel, recordDemoPayment, resetCatalog, resetStoreAgent, storeAgentCard } from ".";
import { acpHttp, resetAcp, type AcpOp, type CheckoutSession } from "./acp";
import { handleStoreMcpPost, resetStoreMcp } from "./mcp";

const ORIGIN = "https://darwin.example";

beforeEach(() => {
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
  eventStore().clear();
  resetCatalog();
  resetStoreAgent();
  resetAcp();
  resetStoreMcp();
  resetIngestRate();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
});

async function acp(op: AcpOp, opts: { id?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const path = opts.id ? `/acp/checkout_sessions/${opts.id}${op === "complete" || op === "cancel" ? `/${op}` : ""}` : "/acp/checkout_sessions";
  const req = new Request(`${ORIGIN}${path}`, {
    method: op === "retrieve" ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-agent-name": "ChatGPT", ...opts.headers },
    ...(op === "retrieve" ? {} : { body: JSON.stringify(opts.body ?? {}) }),
  });
  const res = await acpHttp(req, op, opts.id);
  return { res, json: (await res.json()) as CheckoutSession & { type?: string; code?: string; message?: string; param?: string } };
}

describe("ACP checkout sessions", () => {
  it("demo catalog: create → update quantity → complete gives an order, and the funnel counts it (channel acp)", async () => {
    const created = await acp("create", { body: { items: [{ id: "plan_demo_race", quantity: 1 }] }, headers: { "API-Version": "2025-09-29", "Request-Id": "req_1", authorization: "Bearer anything" } });
    expect(created.res.status).toBe(201);
    expect(created.res.headers.get("API-Version")).toBe("2025-09-29");
    expect(created.res.headers.get("Request-Id")).toBe("req_1");
    expect(created.res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const s = created.json;
    expect(s).toMatchObject({
      status: "ready_for_payment",
      currency: "gbp",
      line_items: [{ item: { id: "plan_demo_race", quantity: 1 }, base_amount: 4900, discount: 0, subtotal: 4900, tax: 0, total: 4900 }],
      fulfillment_options: [],
      payment_provider: { provider: "darwin_demo", supported_payment_methods: ["card"] },
      links: [],
    });
    expect(s.totals.find((t) => t.type === "total")?.amount).toBe(4900);
    expect(s.messages[0]).toMatchObject({ type: "info", content_type: "plain", param: "$.line_items[0]" });

    const updated = await acp("update", { id: s.id, body: { items: [{ id: "plan_demo_race", quantity: 2 }], buyer: { first_name: "Ada", email: "ada@example.com" } } });
    expect(updated.res.status).toBe(200);
    expect(updated.json.line_items[0]).toMatchObject({ item: { quantity: 2 }, total: 9800 });
    expect(updated.json.totals.map((t) => [t.type, t.amount])).toEqual([["items_base_amount", 9800], ["subtotal", 9800], ["tax", 0], ["total", 9800]]);
    expect(updated.json.buyer).toEqual({ first_name: "Ada", email: "ada@example.com" });

    const done = await acp("complete", { id: s.id, body: { payment_data: { token: "spt_123", provider: "stripe" } }, headers: { "Idempotency-Key": "k_complete" } });
    expect(done.res.status).toBe(200);
    expect(done.json.status).toBe("completed");
    expect(done.json.order).toMatchObject({ checkout_session_id: s.id, permalink_url: `${ORIGIN}/acp/checkout_sessions/${s.id}` });
    expect(done.json.order?.id).toMatch(/^ord_/);
    // Completing again (no key, or the same key) never pays twice.
    expect((await acp("complete", { id: s.id })).json.order?.id).toBe(done.json.order?.id);
    const replay = await acp("complete", { id: s.id, body: { payment_data: { token: "spt_123", provider: "stripe" } }, headers: { "Idempotency-Key": "k_complete" } });
    expect(replay.res.headers.get("Idempotent-Replayed")).toBe("true");
    expect(eventStore().all().filter((e) => e.event === "order_completed")).toHaveLength(2); // quantity 2, paid once
    expect((await acp("retrieve", { id: s.id })).json.status).toBe("completed");
    expect((await acp("cancel", { id: s.id })).res.status).toBe(405);

    const funnel = agentFunnel(eventStore().all());
    expect(funnel).toMatchObject({ conversations: 1, offersShown: 1, checkouts: 1, paid: 1, revenue: 9800, conversion: 1, simulated: 0 });
    expect(funnel.byAgent).toEqual([{ agent: "ChatGPT", conversations: 1, checkouts: 1, paid: 1 }]);
    const convEvents = eventStore().all().filter((e) => e.event !== "order_completed");
    expect(convEvents.map((e) => e.event)).toEqual(["agent_conversation_started", "product_viewed", "checkout_started"]);
    expect(convEvents.every((e) => e.properties.channel === "acp" && e.properties.darwin_ref === s.id && e.properties.visitor_kind === "agent" && e.properties.darwin_site === "whop" && e.properties.agent_name === "ChatGPT")).toBe(true);
  });

  it("honours Idempotency-Key on create: same key → same session; same key, different body → 409", async () => {
    const body = { items: [{ id: "plan_demo_gear", quantity: 1 }] };
    const a = await acp("create", { body, headers: { "Idempotency-Key": "idem_1" } });
    const b = await acp("create", { body, headers: { "Idempotency-Key": "idem_1" } });
    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(201);
    expect(b.json.id).toBe(a.json.id);
    expect(b.res.headers.get("Idempotency-Key")).toBe("idem_1");
    expect(b.res.headers.get("Idempotent-Replayed")).toBe("true");
    const clash = await acp("create", { body: { items: [{ id: "plan_demo_race", quantity: 1 }] }, headers: { "Idempotency-Key": "idem_1" } });
    expect(clash.res.status).toBe(409);
    expect(clash.json).toMatchObject({ type: "request_not_idempotent", code: "idempotency_conflict" });
    expect(agentFunnel(eventStore().all()).conversations).toBe(1);
    expect((await acp("create", { body, headers: { "Idempotency-Key": "idem_2" } })).json.id).not.toBe(a.json.id);
  });

  it("answers bad requests with ACP errors: unknown item → 400, unknown session → 404, cancel", async () => {
    const unknown = await acp("create", { body: { items: [{ id: "plan_nope", quantity: 1 }] } });
    expect(unknown.res.status).toBe(400);
    expect(unknown.json).toMatchObject({ type: "invalid_request", code: "unknown_item", param: "$.items[0].id" });
    expect(unknown.json.message).toMatch(/plan_nope/);
    expect((await acp("create", { body: { items: [] } })).json).toMatchObject({ type: "invalid_request", code: "missing", param: "$.items" });
    expect((await acp("create", { body: { items: [{ id: "plan_demo_gear", quantity: 0 }] } })).json).toMatchObject({ code: "invalid", param: "$.items[0].quantity" });
    const bad = await acpHttp(new Request(`${ORIGIN}/acp/checkout_sessions`, { method: "POST", body: "{nope" }), "create");
    expect(bad.status).toBe(400);
    expect((await acp("retrieve", { id: "cs_missing" })).res.status).toBe(404);
    expect(eventStore().all()).toHaveLength(0);

    const s = (await acp("create", { body: { items: [{ id: "plan_demo_gear" }] } })).json;
    const canceled = await acp("cancel", { id: s.id });
    expect(canceled.res.status).toBe(200);
    expect(canceled.json.status).toBe("canceled");
    expect((await acp("complete", { id: s.id })).res.status).toBe(405);
    expect((await acp("update", { id: s.id, body: { items: [{ id: "plan_demo_gear", quantity: 2 }] } })).res.status).toBe(405);
  });

  it("real Whop store: complete returns in_progress with a tagged Whop payment link; the webhook payment completes it", async () => {
    process.env.WHOP_API_KEY = "whop_test";
    process.env.WHOP_COMPANY_ID = "biz_test";
    const checkoutBodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/plans")) return Response.json({ data: [{ id: "plan_real", plan_type: "renewal", renewal_price: 29, billing_period: 30, currency: "gbp", title: "Coaching", visibility: "visible" }] });
      checkoutBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ purchase_url: "https://whop.com/checkout/tagged" });
    });
    const s = (await acp("create", { body: { items: [{ id: "plan_real", quantity: 1 }] }, headers: { "x-agent-name": "", "user-agent": "ChatGPT-User/1.0" } })).json;
    expect(s).toMatchObject({ status: "ready_for_payment", payment_provider: { provider: "whop" }, line_items: [{ total: 2900 }] });
    expect(s.messages.some((m) => /renews every month/.test(m.content))).toBe(true);

    const done = await acp("complete", { id: s.id, body: { payment_data: { token: "spt_1", provider: "stripe" } } });
    expect(done.res.status).toBe(200);
    expect(done.json.status).toBe("in_progress");
    expect(done.json.links).toEqual([{ type: "payment", url: "https://whop.com/checkout/tagged" }]);
    expect(done.json.messages.some((m) => m.type === "info" && /^Complete payment on Whop/.test(m.content))).toBe(true);
    expect(done.json.messages.some((m) => /payment token wasn't used/.test(m.content))).toBe(true);
    expect(done.json.order).toBeUndefined();
    expect(checkoutBodies).toEqual([{ plan_id: "plan_real", metadata: { visitor_kind: "agent", agent_name: "ChatGPT-User", darwin_ref: s.id, darwin_site: "whop" } }]);
    // Completing again reuses the link (no second Whop checkout configuration).
    await acp("complete", { id: s.id });
    expect(checkoutBodies).toHaveLength(1);
    expect(eventStore().all().some((e) => e.event === "order_completed")).toBe(false);

    // Whop's payment webhook (lib/whop/map.ts) carries the metadata back.
    track({ event: "order_completed", distinct_id: "whop_user", properties: { whop_event: "payment.succeeded", visitor_kind: "agent", revenue: 2900, whop_metadata: { darwin_ref: s.id, agent_name: "ChatGPT-User" }, synthetic: false } });
    const after = await acp("retrieve", { id: s.id });
    expect(after.json.status).toBe("completed");
    expect(after.json.order?.checkout_session_id).toBe(s.id);
    expect(agentFunnel(eventStore().all())).toMatchObject({ conversations: 1, checkouts: 1, paid: 1, revenue: 2900 });
  });
});

describe("store MCP server", () => {
  const rpc = async (body: unknown, sessionId?: string) => {
    const headers = new Headers({ "content-type": "application/json", "user-agent": "Claude-User/1.0" });
    if (sessionId) headers.set("mcp-session-id", sessionId);
    const res = await handleStoreMcpPost(JSON.stringify(body), headers, ORIGIN);
    return res as { status: number; headers: Record<string, string>; body: { result?: Record<string, unknown>; error?: { code: number } } };
  };

  it("initialize → tools/list → search_offers → create_checkout is one conversation in the funnel (channel mcp)", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "Claude Desktop", version: "1" }, capabilities: {} } });
    expect(init.status).toBe(200);
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "whop-store-agent" } });
    const sid = init.headers["Mcp-Session-Id"];
    expect(sid).toMatch(/^mcp_/);
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, sid)).status).toBe(202);
    expect((await rpc({ jsonrpc: "2.0", id: "p", method: "ping" }, sid)).body.result).toEqual({});

    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, sid);
    expect((list.body.result!.tools as { name: string }[]).map((t) => t.name)).toEqual(["search_offers", "get_offer", "create_checkout", "store_info"]);

    const search = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_offers", arguments: { query: "Trail running coaching under £40 a month" } } }, sid);
    const found = search.body.result as { content: { type: string; text: string }[]; structuredContent: { offers: { id: string; price: number }[]; exact: boolean }; isError: boolean };
    expect(found.isError).toBe(false);
    expect(found.structuredContent.offers.map((o) => o.id)).toEqual(["plan_demo_coaching"]);
    expect(found.content[0]).toMatchObject({ type: "text" });
    expect(found.content[0].text).toMatch(/Trail Running Coaching \(monthly\) \(plan_demo_coaching\): £29\/month/);
    const capped = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_offers", arguments: { query: "anything", max_price: 1000 } } }, sid);
    expect((capped.body.result as { structuredContent: { offers: { id: string }[] } }).structuredContent.offers.map((o) => o.id)).toEqual(["plan_demo_gear"]);

    const buy = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "create_checkout", arguments: { offer_id: "plan_demo_coaching" } } }, sid);
    const checkout = (buy.body.result as { structuredContent: { checkout_url: string; ref: string; tagged: boolean; checkout_session: { id: string; status: string; url: string } } }).structuredContent;
    expect(checkout.checkout_url).toBe(`${ORIGIN}/checkout/demo?offer=plan_demo_coaching&ref=${sid}`);
    expect(checkout).toMatchObject({ ref: sid, tagged: true, checkout_session: { status: "in_progress" } });

    const unknown = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "create_checkout", arguments: { offer_id: "plan_nope" } } }, sid);
    expect(unknown.body.result).toMatchObject({ isError: true });
    expect((await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope" } }, sid)).body.error?.code).toBe(-32602);
    expect((await rpc({ jsonrpc: "2.0", id: 8, method: "resources/list" }, sid)).body.error?.code).toBe(-32601);

    // The buyer pays on the demo checkout page: credited to the MCP conversation and to the ACP session.
    expect(recordDemoPayment("plan_demo_coaching", checkout.ref).ok).toBe(true);
    const funnel = agentFunnel(eventStore().all());
    expect(funnel).toMatchObject({ conversations: 1, offersShown: 1, checkouts: 1, paid: 1, revenue: 2900 });
    expect(funnel.byAgent[0].agent).toBe("Claude Desktop");
    const conv = eventStore().all().filter((e) => e.event !== "order_completed");
    expect(conv.every((e) => e.properties.channel === "mcp" && e.properties.darwin_ref === sid)).toBe(true);
    expect(conv.filter((e) => e.event === "agent_conversation_started")).toHaveLength(1);
    const session = await acp("retrieve", { id: checkout.checkout_session.id });
    expect(session.json).toMatchObject({ status: "completed", order: { checkout_session_id: checkout.checkout_session.id } });
  });

  it("works without a session (one conversation per agent) and describes the store", async () => {
    const info = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "store_info", arguments: {} } });
    expect(info.body.result).toMatchObject({ isError: false, structuredContent: { catalog: "demo", endpoints: { acp: `${ORIGIN}/acp/checkout_sessions`, mcp: `${ORIGIN}/api/store-agent/mcp` } } });
    await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_offer", arguments: { id: "plan_demo_gear" } } });
    const funnel = agentFunnel(eventStore().all());
    expect(funnel).toMatchObject({ conversations: 1, offersShown: 1 });
    expect(funnel.byAgent[0].agent).toBe("Claude-User");
    expect((await handleStoreMcpPost("{", new Headers(), ORIGIN)).status).toBe(400);
  });

  it("the agent card advertises ACP checkout and the MCP tools", async () => {
    const card = await storeAgentCard(ORIGIN);
    expect(card.skills.map((s) => s.id)).toEqual(["find_offers", "checkout", "checkout_acp", "mcp_tools"]);
    expect(card.links).toEqual([
      { type: "acp", url: `${ORIGIN}/acp/checkout_sessions`, description: expect.any(String) },
      { type: "mcp", url: `${ORIGIN}/api/store-agent/mcp`, description: expect.any(String) },
    ]);
  });
});
