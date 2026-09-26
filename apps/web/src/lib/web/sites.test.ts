import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";
import { GET as traffic } from "@/app/api/traffic/route";
import { eventStore } from "@/lib/analytics/store";
import { resetPlans, savePlan, heuristicPlan } from "@/lib/tracking";
import { installStatus, INSTALL_STATUS_LABEL } from "./install-status";
import { knownSites } from "./results";
import { siteDirectory, siteIdForUrl } from "./sites";

const ev = (site: string | undefined, id = "v1"): AnalyticsEvent =>
  ({ event: "$pageview", distinct_id: id, timestamp: new Date().toISOString(), properties: site ? { darwin_site: site } : {} }) as AnalyticsEvent;

describe("siteIdForUrl", () => {
  it("is case- and www-insensitive", () => {
    expect(siteIdForUrl("https://usedarwin.app")).toBe("usedarwin-app");
    expect(siteIdForUrl("https://WWW.UseDarwin.App/products?x=1")).toBe("usedarwin-app");
    expect(siteIdForUrl("usedarwin.app")).toBe("usedarwin-app");
    expect(siteIdForUrl("www.Trail-Shop.co.uk/x")).toBe("trail-shop-co-uk");
    expect(siteIdForUrl("::::")).toBe("");
  });
});

describe("siteDirectory: one site list for every picker", () => {
  it("is plans ∪ rules ∪ sites with events ∪ extra, sorted, no duplicates", () => {
    expect(
      siteDirectory({ plans: ["usedarwin-app", "b"], rules: [{ site: "north-trail" }, { site: "b" }], events: [ev("c"), ev(undefined)], extra: ["pace-store", undefined] }),
    ).toEqual(["b", "c", "north-trail", "pace-store", "usedarwin-app"]);
  });

  it("knownSites (Personalize) includes plan sites with 0 visitors", () => {
    expect(knownSites([], [ev("c")], ["usedarwin-app"]).map((s) => [s.site, s.visitors])).toEqual([
      ["c", 1],
      ["usedarwin-app", 0],
    ]);
  });
});

describe("Traffic's site picker", () => {
  beforeEach(() => resetPlans());
  it("lists tracking-plan sites that have no events yet (e.g. usedarwin-app)", async () => {
    savePlan(heuristicPlan({ site: "usedarwin-app", siteUrl: "https://usedarwin.app" }));
    eventStore();
    const res = (await (await traffic(new Request("http://localhost/api/traffic?site=all"))).json()) as { sites: string[] };
    expect(res.sites).toContain("usedarwin-app");
  });
});

describe("install status words", () => {
  it("never says verified without a real event; tag alone is installed", () => {
    expect(installStatus({})).toBe("waiting");
    expect(installStatus({ verify: { verified: false } })).toBe("waiting");
    expect(installStatus({ verify: { verified: true, via: "tag" } })).toBe("installed");
    expect(installStatus({ verify: { verified: true, via: "events" } })).toBe("verified");
    expect(installStatus({ realVisitors: 2 })).toBe("verified");
    expect(INSTALL_STATUS_LABEL.waiting).toBe("Waiting for first event");
  });
});
