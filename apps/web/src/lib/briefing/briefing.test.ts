import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { eventStore } from "@/lib/analytics/store";
import { getAgentTests, resetAgentTests, resetCatalog, resetStoreAgent, runSimulatedBuyers, startAgentTest } from "@/lib/store-agent";
import { createRule, forgetPages, getRule, listRules, outlineFromHtml, rememberPage, resetAutopilot, resetWebRules, simulateWebTraffic } from "@/lib/web";
import { GET as demoPage } from "@/app/demo/north-trail/route";
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
  forgetPages();
});

/** Darwin has read the demo store's page, so copy in its own words can go live. */
async function readDemoPage() {
  rememberPage("north-trail", outlineFromHtml(await (await demoPage(new Request(`${ORIGIN}/demo/north-trail`))).text()));
}

afterEach(() => {
  process.env = { ...env };
});

/** Simulated buyer agents shop until the running pitch test reaches `status` (the arm split depends on the random test id). */
async function agentTestAt(status: "winning" | "ready") {
  const test = startAgentTest("facts");
  let briefing: Briefing | undefined;
  for (let round = 0; round < 40; round++) {
    await runSimulatedBuyers(200, ORIGIN, 500 + round);
    briefing = await getBriefing({ origin: ORIGIN });
    const item = briefing.items.find((i) => i.id === `agent:${test.id}`);
    if (item?.status === status || item?.status === "ready") break;
  }
  return { test, briefing: briefing! };
}
const winningAgentTest = () => agentTestAt("ready");

describe("merchant briefing", () => {
  it("says there's nothing to decide when nothing is running", async () => {
    const b = await getBriefing({ origin: ORIGIN });
    expect(b.items).toEqual([]);
    expect(b.ask).toBeUndefined();
    expect(b.text.split(/(?<=[.?!])\s+/).length).toBeGreaterThanOrEqual(2);
  });

  it("asks to ship a store agent test only once it's past the ship bar, labelled as simulated traffic", async () => {
    const { test, briefing } = await winningAgentTest();
    const item = briefing.items.find((i) => i.id === `agent:${test.id}`)!;
    expect(item).toMatchObject({ kind: "agent", title: "Facts up front", traffic: "simulated", status: "ready", actions: ["ship", "stop"], url: `${ORIGIN}/console/agents` });
    expect(item.probabilityToBeat).toBeGreaterThanOrEqual(0.97);
    expect(item.sample).toBeGreaterThan(0);
    expect(item.say).toMatch(/\(simulated traffic\), past the \d+(\.\d+)?% bar to ship\.$/);
    expect(briefing.ask).toEqual({ id: item.id, action: "ship" });
    expect(briefing.headline).toMatch(/“Facts up front” is ready to ship/);
    expect(briefing.headline).toContain("want me to ship it?");
    expect(briefing.text).toContain("(simulated traffic)");
    expect(briefing.text.split(/(?<=[.?!])\s+(?=[“A-Z0-9])/).length).toBeLessThanOrEqual(5);
  }, 60_000);

  it("ships the agent test's lever when the merchant says yes, and won't ship it twice", async () => {
    const { test } = await winningAgentTest();
    const res = await actOnBriefing(`agent:${test.id}`, "ship");
    expect(res.ok).toBe(true);
    expect(res.text).toBe("Shipped “Facts up front”: your store agent now pitches every buyer agent this way.");
    const s = getAgentTests();
    expect(s.levers).toContain("facts");
    expect(s.tests[0]).toMatchObject({ status: "shipped", reason: expect.stringMatching(/^Approved by the merchant/) });
    expect(s.log[0].text).toMatch(/^Shipped “Facts up front” \(approved by the merchant\)/);

    const after = await getBriefing({ origin: ORIGIN });
    expect(after.items.find((i) => i.id === `agent:${test.id}`)).toMatchObject({ status: "shipped", actions: [] });
    expect(after.ask).toBeUndefined();
    expect(await actOnBriefing(`agent:${test.id}`, "ship")).toMatchObject({ ok: false });
  }, 60_000);

  it("never offers to ship a test that's only winning (80%), and won't ship it from chat", async () => {
    const test = startAgentTest("facts");
    for (let round = 0; round < 40; round++) {
      await runSimulatedBuyers(40, ORIGIN, 900 + round);
      const b = await getBriefing({ origin: ORIGIN });
      const item = b.items.find((i) => i.id === `agent:${test.id}`)!;
      if (item.status === "ready") break; // the random arm split got there first: nothing to check this time
      expect(item.actions).toEqual(["stop"]);
      expect(b.ask?.action).not.toBe("ship");
      expect(b.headline).not.toContain("want me to ship it?");
      if (item.status === "winning") {
        expect(b.headline).toMatch(/Darwin ships it by itself once it clears the bar/);
        const res = await actOnBriefing(item.id, "ship");
        expect(res).toMatchObject({ ok: false, text: expect.stringMatching(/only ships a store agent test once it clears the 97% bar/) });
        expect(getAgentTests().tests[0].status).toBe("running");
        return;
      }
    }
  }, 60_000);

  it("keeps an ended test's traffic label and sample after its simulated conversations are gone (a restart)", async () => {
    const { test } = await winningAgentTest();
    expect((await actOnBriefing(`agent:${test.id}`, "ship")).ok).toBe(true);
    const before = (await getBriefing({ origin: ORIGIN })).items.find((i) => i.id === `agent:${test.id}`)!;
    expect(before).toMatchObject({ status: "shipped", traffic: "simulated" });
    eventStore().clear(); // simulated events aren't kept on disk
    const after = (await getBriefing({ origin: ORIGIN })).items.find((i) => i.id === `agent:${test.id}`)!;
    expect(after).toMatchObject({ status: "shipped", traffic: "simulated", sample: before.sample });
    expect(after.sample).toBeGreaterThan(0);
    expect(after.say).toContain("(simulated traffic)");
  }, 60_000);

  it("a test decided before decisions were stamped, whose simulated conversations are gone, isn't shown as real with 0", async () => {
    const { kvSet } = await import("@/lib/db/json-store");
    const at = new Date().toISOString();
    kvSet("store-agent-tests", {
      levers: ["facts"],
      autopilot: false,
      log: [],
      tests: [{ id: "at_legacy", lever: "facts", base: [], status: "shipped", startedAt: at, endedAt: at, reason: "Winner: 18% → 27% of conversations paid, 98% chance better, 640 conversations" }],
    });
    const item = (await getBriefing({ origin: ORIGIN })).items.find((i) => i.id === "agent:at_legacy")!;
    expect(item).toMatchObject({ status: "shipped", traffic: "simulated" });
    expect(item.sample).toBeUndefined();
    expect(item.say).toContain("(simulated traffic)");
  });

  it("stops an agent test without changing the pitch", async () => {
    const test = startAgentTest("upsell");
    await runSimulatedBuyers(50, ORIGIN, 3);
    const res = await actOnBriefing(`agent:${test.id}`, "stop");
    expect(res).toMatchObject({ ok: true, text: expect.stringMatching(/^Stopped “Upsell the yearly plan”/) });
    expect(getAgentTests().levers).toEqual([]);
    expect(getAgentTests().tests[0].status).toBe("stopped");
  });

  it("ships a web test to its audience through lib/web, once it's past the ship bar", async () => {
    await readDemoPage();
    // Which visitors see the banner depends on the rule's random id, and with some ids the simulated effect stays
    // under the 97% bar for all 20 rounds (about 1 run in 8). A fresh rule (new id, clean slate) gets another go,
    // so the test checks the ship bar, not the luck of one split.
    let rule!: ReturnType<typeof createRule>;
    let item!: Awaited<ReturnType<typeof getBriefing>>["items"][number];
    for (let attempt = 0; attempt < 4 && item?.status !== "ready"; attempt++) {
      if (attempt) {
        eventStore().clear();
        resetWebRules();
      }
      rule = createRule(
        { site: "north-trail", name: "Free delivery banner", audience: { sources: ["ai"] }, changes: [{ action: "banner", value: "Free UK delivery over £60 · Free 60-day returns · Dispatched within 24 hours" }] },
        "running",
      );
      simulateWebTraffic({ site: "north-trail", visitors: 600, rules: [rule], url: `${ORIGIN}/demo/north-trail`, seed: 5 });
      item = (await getBriefing({ origin: ORIGIN })).items.find((i) => i.id === `web:north-trail:${rule.id}`)!;
      expect(item).toMatchObject({ kind: "web", title: "Free delivery banner", actions: ["stop"], traffic: "simulated" });
      expect(item.status).not.toBe("ready");
      expect(item.say).toContain("(simulated traffic)");
      expect(await actOnBriefing(item.id, "ship")).toMatchObject({ ok: false, text: expect.stringMatching(/only ships a web test once it clears the 97% bar/) });

      for (let round = 0; round < 20 && item.status !== "ready"; round++) {
        simulateWebTraffic({ site: "north-trail", visitors: 3000, rules: listRules("north-trail"), url: `${ORIGIN}/demo/north-trail`, seed: 50 + round });
        item = (await getBriefing({ origin: ORIGIN })).items.find((i) => i.id === `web:north-trail:${rule.id}`)!;
      }
    }
    expect(item).toMatchObject({ status: "ready", actions: ["ship", "stop"] });
    const res = await actOnBriefing(item.id, "ship");
    expect(res).toMatchObject({ ok: true, text: "Shipped “Free delivery banner” on north-trail: it's live for visitors from AI assistants." });
    expect(getRule(rule.id)).toMatchObject({ status: "shipped", outcome: { decision: "shipped", by: "manual", traffic: "simulated" } });
    expect(await actOnBriefing(`web:other-site:${rule.id}`, "stop")).toMatchObject({ ok: false });

    // After a restart (simulated visitors gone), the decision still says what it was made on.
    eventStore().clear();
    const ended = (await getBriefing({ origin: ORIGIN })).items.find((i) => i.id === `web:north-trail:${rule.id}`)!;
    expect(ended).toMatchObject({ status: "shipped", traffic: "simulated" });
    expect(ended.sample).toBeGreaterThan(0);
  }, 180_000);

  it("never offers to ship a web test whose copy the page doesn't back up: it's paused instead", async () => {
    await readDemoPage();
    const rule = createRule({ site: "north-trail", name: "Ships today", changes: [{ action: "banner", value: "Dispatched within 24 hours" }] }, "running");
    // An older Darwin changed its copy behind the gate's back.
    const { kvUpdate } = await import("@/lib/db/json-store");
    kvUpdate<ReturnType<typeof listRules>>("web-rules", () => [], (all) => all.map((r) => (r.id === rule.id ? { ...r, changes: [{ action: "banner", value: "Ships today · 4.8★ from 2,000+ customers" }] } : r)));
    const b = await getBriefing({ origin: ORIGIN });
    expect(b.ask).toBeUndefined();
    expect(b.items.find((i) => i.id === `web:north-trail:${rule.id}`)).toMatchObject({ status: "stopped", actions: [] });
    expect(getRule(rule.id)?.outcome?.reason).toMatch(/^Paused: it claimed “Ships today · 4\.8★ from 2,000\+ customers” and nothing on your site backs that up/);
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

    // 60 buyers is nowhere near the ship bar: Darwin won't ship it from chat, but the merchant can stop it.
    expect(await (await post({ id: `agent:${test.id}`, action: "ship" })).json()).toMatchObject({ ok: false, text: expect.stringMatching(/clears the 97% bar/) });
    const stopped = await post({ id: `agent:${test.id}`, action: "stop" });
    const body = await stopped.json();
    expect(body).toMatchObject({ ok: true, text: expect.stringMatching(/^Stopped “Facts up front”/) });
    expect(body.briefing.items[0]).toMatchObject({ id: `agent:${test.id}`, status: "stopped", actions: [] });
  });
});
