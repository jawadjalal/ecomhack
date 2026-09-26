import { beforeEach, describe, expect, it } from "vitest";
import { callAgentTool, listAgentSessions } from "./index";
import { MAX_SESSIONS, REAL_SESSION_PIN_MS } from "./state";
import { ctx, resetWorld } from "./test-utils";

beforeEach(resetWorld);

describe("agent session list", () => {
  it("keeps a recent real agent at the front of the list, above newer simulated sessions", async () => {
    await callAgentTool("search_products", { query: "trail" }, ctx("real", { agentName: "cursor", synthetic: false }));
    for (let i = 0; i < 5; i++) await callAgentTool("search_products", { query: "road" }, ctx(`sim${i}`));

    const list = listAgentSessions(4);
    expect(list.map((s) => s.agentName)).toEqual(["cursor", "test-agent", "test-agent", "test-agent"]);
    expect(list[1].sessionId).toBe("ses_test_sim4");
    // After a few quiet minutes it falls back into plain newest-first order.
    const later = listAgentSessions(6, Date.now() + REAL_SESSION_PIN_MS + 1000);
    expect(later.at(-1)?.agentName).toBe("cursor");
  });

  it("trims simulated sessions first when the list is full", async () => {
    await callAgentTool("search_products", { query: "trail" }, ctx("real", { agentName: "cursor", synthetic: false }));
    for (let i = 0; i < MAX_SESSIONS + 20; i++) await callAgentTool("get_cart", {}, ctx(`sim${i}`));

    const all = listAgentSessions(1000, Date.now() + REAL_SESSION_PIN_MS + 1000);
    expect(all).toHaveLength(MAX_SESSIONS);
    expect(all.some((s) => s.agentName === "cursor")).toBe(true);
    expect(all[0].sessionId).toBe(`ses_test_sim${MAX_SESSIONS + 19}`);
  });
});
