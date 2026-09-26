import { beforeEach, describe, expect, it } from "vitest";
import { POST as plan, GET as getPlanRoute } from "@/app/api/onboarding/plan/route";
import { GET as rules } from "@/app/api/web/rules/route";
import { GET as llms } from "@/app/llms.txt/route";
import { resetPlans } from "@/lib/tracking";
import { installSnippet, installSnippetFor } from ".";

const env = { ...process.env };
beforeEach(() => {
  process.env = { ...env };
  delete process.env.DARWIN_PUBLIC_URL;
  resetPlans();
});

const req = (path: string, init?: RequestInit) => new Request(`http://localhost:3200${path}`, init);

describe("installSnippet: one canonical darwin.js tag", () => {
  it("builds the single darwin.js tag (it loads runtime.js itself), no version param", () => {
    const s = installSnippetFor("darwin.example.com/", "shop-example-com");
    expect(s).toEqual({
      origin: "https://darwin.example.com",
      src: "https://darwin.example.com/darwin.js",
      siteId: "shop-example-com",
      tag: '<script src="https://darwin.example.com/darwin.js" data-darwin-site="shop-example-com" defer></script>',
    });
    expect(s.tag).not.toContain("runtime.js");
  });

  it("uses DARWIN_PUBLIC_URL when set, else the request origin", () => {
    expect(installSnippet(req("/x"), "a").src).toBe("http://localhost:3200/darwin.js");
    expect(installSnippet(new Request("http://internal/x", { headers: { "x-forwarded-host": "usedarwin.app", "x-forwarded-proto": "https" } }), "a").src).toBe(
      "https://usedarwin.app/darwin.js",
    );
    process.env.DARWIN_PUBLIC_URL = "https://darwin-storefront.vercel.app/";
    expect(installSnippet(req("/x"), "a").src).toBe("https://darwin-storefront.vercel.app/darwin.js");
  });

  it("onboarding, Personalize (GET /api/web/rules) and llms.txt all show the same origin and path", async () => {
    process.env.DARWIN_PUBLIC_URL = "https://usedarwin.app";
    const onboarding = (await (await plan(req("/api/onboarding/plan", { method: "POST", body: JSON.stringify({ siteUrl: "https://www.UseDarwin.app" }) }))).json()) as {
      plan: { site: string };
      snippet: string;
      install: { src: string; tag: string };
    };
    expect(onboarding.plan.site).toBe("usedarwin-app");
    expect(onboarding.snippet).toBe(onboarding.install.tag);
    expect(onboarding.install.src).toBe("https://usedarwin.app/darwin.js");

    const again = (await (await getPlanRoute(req("/api/onboarding/plan?site=usedarwin-app"))).json()) as { install: { tag: string } };
    expect(again.install.tag).toBe(onboarding.snippet);

    const personalize = (await (await rules(req("/api/web/rules?site=usedarwin-app"))).json()) as {
      install: { src: string; tag: string; storeUrl?: string };
      sites: { site: string }[];
    };
    expect(personalize.install.tag).toBe(onboarding.snippet);
    expect(personalize.install.storeUrl).toBe("https://www.UseDarwin.app");
    // The plan's site is in Personalize's picker even before any event.
    expect(personalize.sites.map((s) => s.site)).toContain("usedarwin-app");

    const txt = await (await llms(req("/llms.txt"))).text();
    expect(txt).toContain('<script src="https://usedarwin.app/darwin.js"');
  });
});
