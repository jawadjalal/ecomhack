import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { POST } from "./route";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost:3000/api/simulate/events", { method: "POST", body: JSON.stringify(body), headers }));

beforeEach(() => eventStore().clear());
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/simulate/events", () => {
  it("always labels events synthetic and drops experiment claims", async () => {
    const res = await post({
      events: [
        { event: "$pageview", distinct_id: "v1", properties: { synthetic: false, experiment_id: "exp_x", variant: "treatment", spec_version: 3, darwin_site: "orchard" } },
        { event: "agent_request", distinct_id: "a1", properties: { visitor_kind: "agent", agent_name: "ChatGPT-User", missing: ["delivery_eta"] } },
      ],
    });
    expect(res.status).toBe(200);
    const [human, agent] = eventStore().all();
    expect(human.properties).toMatchObject({ synthetic: true, spec_version: 3, visitor_kind: "human", darwin_site: "orchard" });
    expect(human.properties.experiment_id).toBeUndefined();
    expect(human.properties.variant).toBeUndefined();
    expect(agent.properties).toMatchObject({ synthetic: true, visitor_kind: "agent", agent_name: "ChatGPT-User", spec_version: 0 });
  });

  it("requires the admin token when one is configured", async () => {
    vi.stubEnv("DARWIN_ADMIN_TOKEN", "secret");
    const body = { events: [{ event: "$pageview", distinct_id: "v1" }] };
    expect((await post(body)).status).toBe(401);
    expect((await post(body, { authorization: "Bearer secret" })).status).toBe(200);
    expect(eventStore().all()).toHaveLength(1);
  });

  it("rejects malformed bodies", async () => {
    expect((await post({ events: [] })).status).toBe(400);
    expect((await POST(new Request("http://x/api/simulate/events", { method: "POST", body: "nope" }))).status).toBe(400);
  });
});
