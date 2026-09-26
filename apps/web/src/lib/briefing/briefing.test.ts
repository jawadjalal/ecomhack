import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { eventStore } from "@/lib/analytics/store";
import { getAgentTests, resetAgentTests, resetCatalog, resetStoreAgent, runSimulatedBuyers, startAgentTest } from "@/lib/store-agent";
import { createRule, getRule, resetAutopilot, resetWebRules, simulateWebTraffic } from "@/lib/web";
import { GET } from "@/app/api/briefing/route";
import { POST } from "@/app/api/briefing/act/route";
import { actOnBriefing, getBriefing, type Briefing } from ".";

const ORIGIN = "https://darwin.example";
const env = { ...process.env };

beforeEach(() => {
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_COMPANY_ID;
  delete process.env.DARWIN_ADMIN_TOKEN;
  delete process.env.DARWIN_REQUIRE_ADMIN;
  delete process.env.DARWIN_PUBLIC_URL;
  eventStore().clear();
  resetCatalog();
  resetStoreAgent();
  resetAgentTests();
  resetWebRules();
  resetAutopilot();
});

afterEach(() => {
  process.env = { ...env };
});

/** Simulated buyer agents shop until the running pitch test is winning (the arm split depends on the random test id). */
async function winningAgentTest() {
  const test = startAgentTest("facts");
  let briefing: Briefing | undefined;
  for (let round = 0; round < 30; round++) {
    await runSimulatedBuyers(200, ORIGIN, 500 + round);
    briefing = await getBriefing({ origin: ORIGIN });
    const item = briefing.items.find((i) => i.id === `agent:${test.id}`);
    if (item?.status === "winning" || item?.status === "ready") break;
  }
  return { test, briefing: briefing! };
}

describe("merchant briefing", () => {
  it("says there's nothing to decide when nothing is running", async () => {
    const b = await getBriefing({ origin: ORIGIN });
    expect(b.items).toEqual([]);
    expect(b.ask).toBeUndefined();
    expect(b.text.split(/(?<=[.?!])\s+/).length).toBeGreaterThanOrEqual(2);
  });

  it("asks to ship a winning store agent test, labelled as simulated traffic", async () => {
    const { test, briefing } = await winningAgentTest();
    const item = briefing.items.find((i) => i.id === `agent:${test.id}`)!;
    expect(item).toMatchObject({ kind: "agent", title: "Facts up front", traffic: "simulated", actions: ["ship", "stop"], url: `${ORIGIN}/console/agents` });
    expect(["winning", "ready"]).toContain(item.status);
    expect(item.probabilityToBeat).toBeGreaterThanOrEqual(0.8);
    expect(item.sample).toBeGreaterThan(0);
    expect(item.say).toMatch(/\(simulated traffic\)\.$/);
    expect(briefing.ask).toEqual({ id: item.id, action: "ship" });
    expect(briefing.headline).toMatch(/“Facts up front” is (winning at|ready to ship)/);
    expect(briefing.headline).toContain("want me to ship it?");
    expect(briefing.text).toContain("(simulated traffic)");
    expect(briefing.text.split(/(?<=[.?!])\s+(?=[“A-Z0-9])/).length).toBeLessThanOrEqual(5);
  }, 60_000);

  it("ships the agent test's lever when the merchant says yes, and won't ship it twice", async () => {
    const { test } = await winningAgentTest();
    const res = await actOnBriefing(`agent:${test.id}`, "ship");
    expect(res.ok).toBe(true);
    expect(res.text).toMatch(/^Shipped “Facts up front” \(approved by the merchant\)/);
    const s = getAgentTests();
    expect(s.levers).toContain("facts");
    expect(s.tests[0]).toMatchObject({ status: "shipped", reason: expect.stringMatching(/^Approved by the merchant/) });
    expect(s.log[0].text).toMatch(/^Shipped “Facts up front” \(approved by the merchant\)/);

    const after = await getBriefing({ origin: ORIGIN });
    expect(after.items.find((i) => i.id === `agent:${test.id}`)).toMatchObject({ status: "shipped", actions: [] });
    expect(after.ask).toBeUndefined();
    expect(await actOnBriefing(`agent:${test.id}`, "ship")).toMatchObject({ ok: false });
  }, 60_000);

  it("stops an agent test without changing the pitch", async () => {
    const test = startAgentTest("upsell");
    await runSimulatedBuyers(50, ORIGIN, 3);
    const res = await actOnBriefing(`agent:${test.id}`, "stop");
    expect(res).toMatchObject({ ok: true, text: expect.stringMatching(/^Stopped “Upsell the yearly plan”/) });
    expect(getAgentTests().levers).toEqual([]);
    expect(getAgentTests().tests[0].status).toBe("stopped");
  });

  it("ships a web test to its audience through lib/web", async () => {
    const rule = createRule({ site: "north-trail", name: "Free delivery banner", changes: [{ action: "banner", value: "Free UK delivery over £60" }] }, "running");
    simulateWebTraffic({ site: "north-trail", visitors: 600, rules: [rule], url: `${ORIGIN}/demo/north-trail`, seed: 5 });
    const b = await getBriefing({ origin: ORIGIN });
    const item = b.items.find((i) => i.id === `web:north-trail:${rule.id}`)!;
    expect(item).toMatchObject({ kind: "web", title: "Free delivery banner", actions: ["ship", "stop"], traffic: "simulated" });
    expect(item.say).toContain("(simulated traffic)");

    const res = await actOnBriefing(item.id, "ship");
    expect(res).toMatchObject({ ok: true, text: "Shipped “Free delivery banner” on north-trail: it's live for all visitors." });
    expect(getRule(rule.id)).toMatchObject({ status: "shipped", outcome: { decision: "shipped", by: "manual" } });
    expect(await actOnBriefing(`web:other-site:${rule.id}`, "stop")).toMatchObject({ ok: false });
  });

  it("refuses unknown ids without throwing", async () => {
    for (const id of ["nope", "agent:", "agent:at_missing", "web:north-trail", "web:north-trail:wr_missing", "loop:exp_missing", "loop:a:b", ""]) {
      const res = await actOnBriefing(id, "ship");
      expect(res.ok, id).toBe(false);
      expect(res.text.length).toBeGreaterThan(10);
    }
  });
});

describe("briefing routes", () => {
  it("are admin-gated: 401 without the bearer token when DARWIN_ADMIN_TOKEN is set", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/api/briefing", "/api/briefing/:path*"]));
    process.env.DARWIN_ADMIN_TOKEN = "s3cret";
    expect(proxy(new NextRequest(`${ORIGIN}/api/briefing`)).status).toBe(401);
    expect(proxy(new NextRequest(`${ORIGIN}/api/briefing/act`, { method: "POST", body: "{}" })).status).toBe(401);
    expect(proxy(new NextRequest(`${ORIGIN}/api/briefing`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const ok = proxy(new NextRequest(`${ORIGIN}/api/briefing`, { headers: { authorization: "Bearer s3cret" } }));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
  });

  it("GET returns the briefing uncached; POST validates, acts and returns the fresh briefing", async () => {
    const test = startAgentTest("facts");
    await runSimulatedBuyers(60, ORIGIN, 9);

    const get = await GET(new Request(`${ORIGIN}/api/briefing`));
    expect(get.headers.get("cache-control")).toBe("no-store");
    const briefing = (await get.json()) as Briefing;
    expect(briefing.items[0]).toMatchObject({ id: `agent:${test.id}`, url: `${ORIGIN}/console/agents` });

    const post = (body: unknown) => POST(new Request(`${ORIGIN}/api/briefing/act`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    expect((await post({ id: `agent:${test.id}`, action: "maybe" })).status).toBe(400);
    expect((await post({ action: "ship" })).status).toBe(400);

    const unknown = await post({ id: "agent:at_missing", action: "ship" });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toMatchObject({ ok: false });

    const shipped = await post({ id: `agent:${test.id}`, action: "ship" });
    const body = await shipped.json();
    expect(body).toMatchObject({ ok: true, text: expect.stringMatching(/^Shipped “Facts up front”/) });
    expect(body.briefing.items[0]).toMatchObject({ id: `agent:${test.id}`, status: "shipped", actions: [] });
  });
});
