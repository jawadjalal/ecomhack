import { beforeEach, describe, expect, it } from "vitest";
import { POST as plan } from "@/app/api/onboarding/plan/route";
import { POST as install } from "@/app/api/onboarding/install/route";
import { resetPlans } from ".";

const env = { ...process.env };
beforeEach(() => {
  process.env = { ...env };
  delete process.env.DARWIN_PUBLIC_URL;
  resetPlans();
});

const post = (body: unknown) => plan(new Request("https://darwin.example/api/onboarding/plan", { method: "POST", body: JSON.stringify(body) }));

describe("onboarding without GitHub", () => {
  it("plans from the store's address and hands back one script tag instead of a pull request", async () => {
    const res = await post({ siteUrl: "www.Trail-Shop.co.uk/products", prompt: "trail shoes; checkout feels slow on mobile" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { plan: { site: string; siteUrl: string; repo?: string; events: { name: string; fromPrompt?: boolean }[] }; reply: string; snippet: string };
    expect(out.plan).toMatchObject({ site: "trail-shop-co-uk", siteUrl: "https://www.Trail-Shop.co.uk/products" });
    expect(out.plan.repo).toBeUndefined();
    expect(out.plan.events.some((e) => e.fromPrompt)).toBe(true);
    expect(out.reply).toMatch(/^No GitHub needed: Darwin goes on www\.trail-shop\.co\.uk with one line of code\./);
    expect(out.snippet).toBe('<script src="https://darwin.example/darwin.js" data-darwin-site="trail-shop-co-uk" defer></script>');
    // There's no repo to open a pull request on.
    const pr = await install(new Request("https://darwin.example/api/onboarding/install", { method: "POST", body: JSON.stringify({ site: "trail-shop-co-uk" }) }));
    expect(pr.status).toBe(404);
  });

  it("needs exactly one of repoUrl / siteUrl, and a real web address", async () => {
    expect((await post({ prompt: "x" })).status).toBe(400);
    expect((await post({ repoUrl: "acme/shop", siteUrl: "https://acme.example" })).status).toBe(400);
    expect((await post({ siteUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await post({ siteUrl: "ftp://acme.example" })).status).toBe(400);
  });
});
