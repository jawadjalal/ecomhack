import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { isProtectedPath } from "@/lib/auth/admin";
import { COMMAND_NAMES } from "@/lib/commands/specs";
import { proxy } from "@/proxy";
import { GET, POST } from "./route";

const BASE = "http://localhost:3000";
const env = { ...process.env };

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request(`${BASE}/api/darwin/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

beforeEach(() => {
  delete process.env.DARWIN_ADMIN_TOKEN;
  delete process.env.DARWIN_REQUIRE_ADMIN;
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("Darwin control MCP (POST /api/darwin/mcp)", () => {
  it("initialize answers with the server info and tools capability", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", clientInfo: { name: "test" } } });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "darwin" } });
    expect(j.result.instructions).toMatch(/confirm: true/);
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
  });

  it("tools/list has every command as darwin_<name> with a valid JSON Schema, plus the read-only views", async () => {
    const j = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    const tools = j.result.tools as { name: string; description: string; inputSchema: Record<string, unknown>; annotations: { destructiveHint: boolean } }[];
    const names = tools.map((t) => t.name);
    for (const c of COMMAND_NAMES) expect(names).toContain(`darwin_${c}`);
    expect(names).toEqual(expect.arrayContaining(["darwin_state", "darwin_pages", "darwin_whats_left"]));
    expect(new Set(names).size).toBe(names.length);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
      // Round-trips through zod's JSON Schema reader: a schema clients can load.
      expect(() => z.fromJSONSchema(t.inputSchema as never)).not.toThrow();
    }
    const rollback = tools.find((t) => t.name === "darwin_rollback")!;
    expect(rollback.annotations.destructiveHint).toBe(true);
    expect(Object.keys(rollback.inputSchema.properties as object)).toEqual(expect.arrayContaining(["generation", "confirm"]));
  });

  it("tools/call runs a command headlessly against the request's origin (content + structuredContent)", async () => {
    const nav = await (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "darwin_navigate", arguments: { page: "experiments" } } })).json();
    expect(nav.result.isError).toBe(false);
    expect(nav.result.structuredContent).toMatchObject({ ok: true, href: `${BASE}/console/experiments` });
    expect(nav.result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`${BASE}/console/experiments`) });

    const fetchMock = vi.fn(async () => Response.json({ humans: 10, agents: 2, orders: 1, revenue: 12000 }));
    vi.stubGlobal("fetch", fetchMock);
    const sim = await (await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "darwin_simulate_traffic", arguments: { humans: 10, agents: 2 } } }, { authorization: "Bearer abc" })).json();
    expect(sim.result.isError).toBe(false);
    expect(sim.result.structuredContent).toMatchObject({ ok: true, synthetic: true });
    expect(sim.result.content[0].text).toMatch(/simulated/);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/simulate`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer abc");

    const pages = await (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "darwin_pages" } })).json();
    expect(pages.result.structuredContent.data.pages.length).toBeGreaterThan(10);
  });

  it("error paths: unknown tool, bad input, confirm required, bad JSON, unknown method", async () => {
    const unknown = await (await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "darwin_nope" } })).json();
    expect(unknown.error).toMatchObject({ code: -32602 });

    const bad = await (await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "darwin_step_loop", arguments: { times: 999 } } })).json();
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/Bad input/);

    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const risky = await (await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "darwin_rollback", arguments: { generation: 0 } } })).json();
    expect(risky.result.isError).toBe(true);
    expect(risky.result.structuredContent.data).toMatchObject({ needsConfirmation: true });
    expect(fetchMock.mock.calls.every((c) => ((c as unknown as [string, RequestInit])[1]?.method ?? "GET") === "GET")).toBe(true);

    expect((await rpc("{not json")).status).toBe(400);
    const method = await (await rpc({ jsonrpc: "2.0", id: 9, method: "resources/list" })).json();
    expect(method.error.code).toBe(-32601);
  });

  it("is admin-gated: proxy + handler both check DARWIN_ADMIN_TOKEN", async () => {
    expect(isProtectedPath("/api/darwin/mcp")).toBe(true);
    process.env.DARWIN_ADMIN_TOKEN = "s3cret";
    expect(proxy(new NextRequest(`${BASE}/api/darwin/mcp`, { method: "POST" })).status).toBe(401);
    expect(proxy(new NextRequest(`${BASE}/api/darwin/mcp`, { method: "POST", headers: { authorization: "Bearer s3cret" } })).headers.get("x-middleware-next")).toBe("1");

    const list = { jsonrpc: "2.0", id: 10, method: "tools/list" };
    expect((await rpc(list)).status).toBe(401);
    expect((await rpc(list, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await rpc(list, { authorization: "Bearer s3cret" })).status).toBe(200);
    expect((await rpc(list, { cookie: "darwin_admin=s3cret" })).status).toBe(200);
  });

  it("GET describes the server; event-stream clients get 405", async () => {
    expect(await (await GET(new Request(`${BASE}/api/darwin/mcp`))).json()).toMatchObject({ name: "darwin", endpoint: `${BASE}/api/darwin/mcp` });
    expect((await GET(new Request(`${BASE}/api/darwin/mcp`, { headers: { accept: "text/event-stream" } }))).status).toBe(405);
  });
});
