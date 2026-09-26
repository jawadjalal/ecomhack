import { beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/mcp/route";
import { GET as llmsTxt } from "@/app/llms.txt/route";
import { GET as agentCard } from "@/app/.well-known/agent-card.json/route";
import { GET as searchRoute } from "@/app/api/agent/products/route";
import { POST as availabilityRoute } from "@/app/api/agent/availability/route";
import { listAgentSessions } from "./index";
import { eventsNamed, OPEN_SURFACE, resetWorld, useSpec } from "./test-utils";

beforeEach(resetWorld);

const URL_BASE = "http://localhost:3000";

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request(`${URL_BASE}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function initialize(headers: Record<string, string> = {}) {
  const res = await rpc(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok-shopper", version: "1.0" } },
    },
    headers,
  );
  return { res, sessionId: res.headers.get("mcp-session-id")!, body: await res.json() };
}

describe("MCP server (POST /api/mcp)", () => {
  it("initializes, issues a session id and accepts notifications/initialized", async () => {
    const { res, sessionId, body } = await initialize();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(sessionId).toMatch(/^mcp_/);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "pace-store" }, capabilities: { tools: {} } },
    });

    const note = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": sessionId });
    expect(note.status).toBe(202);
    expect(await note.text()).toBe("");

    const ping = await rpc({ jsonrpc: "2.0", id: "p", method: "ping" }, { "mcp-session-id": sessionId });
    expect(await ping.json()).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
  });

  it("lists tools with JSON Schemas", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const { result } = await res.json();
    const names = result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["search_products", "get_product", "check_availability", "add_to_cart", "negotiate", "checkout"]),
    );
    const search = result.tools.find((t: { name: string }) => t.name === "search_products");
    expect(search.inputSchema).toMatchObject({ type: "object", properties: { want: { type: "array" }, maxPrice: { type: "number" } } });
    const negotiate = result.tools.find((t: { name: string }) => t.name === "negotiate");
    expect(negotiate.inputSchema.required).toEqual(["id", "offer"]);
    expect(negotiate.annotations).toMatchObject({ readOnlyHint: false });
  });

  it("calls tools in the MCP session (cart persists) and tracks them as the MCP client", async () => {
    useSpec(OPEN_SURFACE);
    const { sessionId } = await initialize();
    const call = async (id: number, name: string, args: Record<string, unknown>) =>
      (await rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, { "mcp-session-id": sessionId })).json();

    const search = await call(3, "search_products", { category: "trail", want: ["deliveryEtaDays"] });
    expect(search.result.isError).toBe(false);
    expect(search.result.structuredContent.ok).toBe(true);
    expect(JSON.parse(search.result.content[0].text)).toEqual(search.result.structuredContent);
    expect(search.result.structuredContent.data[0].deliveryEtaDays).toBe(3);

    await call(4, "add_to_cart", { id: "p_ridge", size: 10 });
    const order = await call(5, "checkout", { maxTotal: 14000 });
    expect(order.result.structuredContent).toMatchObject({ ok: true, data: { total: 13995 } });

    const [session] = listAgentSessions(1);
    expect(session).toMatchObject({ sessionId, agentName: "grok-shopper", outcome: "purchased", synthetic: false });
    expect(eventsNamed("agent_request").every((e) => e.properties.channel === "mcp")).toBe(true);
  });

  it("labels our own scripted clients as synthetic (x-darwin-synthetic: 1)", async () => {
    const h = { "x-darwin-synthetic": "1" };
    const { sessionId } = await initialize(h);
    await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_cart", arguments: {} } }, { ...h, "mcp-session-id": sessionId });
    expect(listAgentSessions(1)[0]).toMatchObject({ sessionId, synthetic: true });
    expect(eventsNamed("agent_request").every((e) => e.properties.synthetic === true)).toBe(true);
  });

  it("reports tool-level failures as isError results with missing fields", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "check_availability", arguments: { id: "p_ridge", size: "10" } } });
    const { result } = await res.json();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false, missing: ["stock"] });
  });

  it("returns JSON-RPC errors for bad input and supports batches", async () => {
    const parse = await rpc("{not json");
    expect(parse.status).toBe(400);
    expect((await parse.json()).error.code).toBe(-32700);

    const unknownTool = await (await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "steal" } })).json();
    expect(unknownTool.error.code).toBe(-32602);

    const unknownMethod = await (await rpc({ jsonrpc: "2.0", id: 8, method: "resources/list" })).json();
    expect(unknownMethod.error.code).toBe(-32601);

    const batch = await rpc([
      { jsonrpc: "2.0", id: 9, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 10, method: "tools/list" },
    ]);
    const responses = await batch.json();
    expect(responses.map((r: { id: number }) => r.id)).toEqual([9, 10]);

    const onlyNotifications = await rpc([{ jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(onlyNotifications.status).toBe(202);
  });

  it("GET describes the endpoint (405 for SSE); DELETE ends the session", async () => {
    const desc = await GET(new Request(`${URL_BASE}/api/mcp`));
    expect(await desc.json()).toMatchObject({ name: "pace-store", endpoint: `${URL_BASE}/api/mcp` });
    const sse = await GET(new Request(`${URL_BASE}/api/mcp`, { headers: { accept: "text/event-stream" } }));
    expect(sse.status).toBe(405);
    const { sessionId } = await initialize();
    const del = await DELETE(new Request(`${URL_BASE}/api/mcp`, { method: "DELETE", headers: { "mcp-session-id": sessionId } }));
    expect(del.status).toBe(204);
  });
});

describe("REST + discovery", () => {
  it("identifies agents from headers and sets CORS", async () => {
    const res = await searchRoute(
      new Request(`${URL_BASE}/api/agent/products?category=trail&want=deliveryEtaDays,landedPrice`, {
        headers: { "x-agent-name": "curl-bot", "x-agent-id": "agt_curl", "x-agent-session": "ses_curl" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-agent-session")).toBe("ses_curl");
    expect(await res.json()).toMatchObject({ ok: true, missing: ["deliveryEtaDays", "landedPrice"] });
    expect(eventsNamed("agent_request")[0]).toMatchObject({
      distinct_id: "agt_curl",
      properties: { agent_name: "curl-bot", $session_id: "ses_curl", channel: "rest" },
    });

    const bad = await availabilityRoute(new Request(`${URL_BASE}/api/agent/availability`, { method: "POST", body: "[1]" }));
    expect(bad.status).toBe(400);
  });

  it("llms.txt and the agent card reflect the live spec", async () => {
    const before = await (await llmsTxt(new Request(`${URL_BASE}/llms.txt`))).text();
    expect(before).toContain("# PACE Running");
    expect(before).toContain("Delivery ETA (`deliveryEtaDays`): not exposed");
    expect(before).not.toContain("/api/agent/negotiate");

    useSpec(OPEN_SURFACE);
    const after = await (await llmsTxt(new Request(`${URL_BASE}/llms.txt`))).text();
    expect(after).toContain("Delivery ETA (`deliveryEtaDays`): yes");
    expect(after).toContain("up to 15% off");

    const card = await (await agentCard(new Request(`${URL_BASE}/.well-known/agent-card.json`))).json();
    expect(card).toMatchObject({ url: `${URL_BASE}/api/mcp`, commerce: { negotiation: { enabled: true } } });
    expect(card.skills.map((s: { id: string }) => s.id)).toContain("negotiate");
  });
});
