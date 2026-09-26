// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventStore } from "@/lib/analytics/store";
import { resetWebRules, simulateWebTraffic } from "@/lib/web";
import { POST as restoreRoute } from "@/app/api/onboarding/restore/route";
import { computeDashboards, getPlan, heuristicPlan, resetPlans, savePlan, TrackingPlanSchema } from ".";
import { recallLastSite, recallPlan, recallSimulated, rememberPlan, rememberSimulated, rememberSite } from "./remember";

const SITE = "eastfork-com";
const plan = () => heuristicPlan({ site: SITE, siteUrl: "https://www.eastfork.com", framework: "Any website (script tag)", prompt: "checkout feels slow on mobile" });
const post = (body: unknown) =>
  restoreRoute(new Request("http://localhost/api/onboarding/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  eventStore().clear();
  resetPlans();
  resetWebRules();
});

describe("POST /api/onboarding/restore (a plan made on another instance)", () => {
  it("saves the browser's copy on an empty instance, then getPlan and the dashboards use it", async () => {
    const made = plan(); // made on instance A…
    expect(getPlan(SITE)).toBeUndefined(); // …instance B has never heard of it

    const res = await post({ plan: made });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { restored: boolean; plan: typeof made };
    expect(body.restored).toBe(true);
    expect(body.plan).toEqual(made);
    expect(getPlan(SITE)).toEqual(made);

    const empty = computeDashboards(SITE, getPlan(SITE), eventStore().all());
    expect(empty.plan?.site).toBe(SITE);
    expect(empty.dashboards.map((d) => d.id)).toEqual(made.dashboards.map((d) => d.id));
    expect(empty.dashboards.map((d) => d.id)).toEqual(expect.arrayContaining(["checkout", "devices", "goals"]));

    // The re-sent simulated shoppers land in the plan's dashboards, labelled synthetic.
    simulateWebTraffic({ site: SITE, visitors: 60, rules: [], url: "https://www.eastfork.com/", extraEvents: ["checkout_step_viewed"] });
    const live = computeDashboards(SITE, getPlan(SITE), eventStore().all());
    expect(live.totalEvents).toBeGreaterThan(0);
    expect(live.syntheticEvents).toBe(live.totalEvents);
    expect(live.dashboards.find((d) => d.id === "kpis")?.empty).toBe(false);
  });

  it("never overwrites a plan the instance already has", async () => {
    const mine = savePlan({ ...plan(), prompt: "server copy" });
    const res = await post({ plan: { ...plan(), prompt: "stale browser copy" } });
    const body = (await res.json()) as { restored: boolean; plan: { prompt?: string } };
    expect(body).toMatchObject({ restored: false, plan: { prompt: "server copy" } });
    expect(getPlan(SITE)).toEqual(mine);
  });

  it("rejects anything that isn't a plan", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ plan: { ...plan(), site: "../../etc" } })).status).toBe(400);
    expect((await post({ plan: { ...plan(), admin: true } })).status).toBe(400);
    expect((await post({ plan: { ...plan(), events: [{ name: "x", label: "x", why: "x", category: "evil", automatic: false, enabled: true }] } })).status).toBe(400);
    expect(getPlan(SITE)).toBeUndefined();
    expect(TrackingPlanSchema.safeParse(plan()).success).toBe(true);
  });
});

describe("remember (the browser's copy)", () => {
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the plan, a running count of simulated shoppers, and the last site", () => {
    const p = plan();
    expect(recallPlan(SITE)).toBeUndefined();
    rememberPlan(p);
    expect(recallPlan(SITE)).toEqual(p);
    expect(recallPlan("other-site")).toBeUndefined();

    expect(recallSimulated(SITE)).toBe(0);
    rememberSimulated(SITE, 300);
    rememberSimulated(SITE, 150);
    expect(recallSimulated(SITE)).toBe(450);

    expect(recallLastSite()).toBeUndefined();
    rememberSite(SITE, "https://www.eastfork.com");
    expect(recallLastSite()).toEqual({ site: SITE, url: "https://www.eastfork.com" });
  });

  it("never throws when storage is blocked or holds junk", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(() => rememberPlan(plan())).not.toThrow();
    expect(recallPlan(SITE)).toBeUndefined();
    expect(recallSimulated(SITE)).toBe(0);
    expect(recallLastSite()).toBeUndefined();

    vi.stubGlobal("window", { localStorage: { getItem: () => "{not json", setItem: () => undefined } });
    expect(recallPlan(SITE)).toBeUndefined();
    expect(recallLastSite()).toBeUndefined();
  });
});
