import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { getLiveSpec } from "@/lib/spec/store";
import { resetLoop } from "@/lib/optimizer";
import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://darwin.test/api/loop/baseline", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

const other = {
  ...DEFAULT_SPEC,
  label: "Baseline",
  hero: { ...DEFAULT_SPEC.hero, headline: "Vintage stock, by the bundle", ctaText: "Learn more" },
};

describe("POST /api/loop/baseline", () => {
  beforeEach(async () => {
    await resetLoop();
  });

  it("makes another store's config the live baseline", async () => {
    const res = await post({ spec: other });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spec.hero.headline).toBe("Vintage stock, by the bundle");
    expect(getLiveSpec().hero.ctaText).toBe("Learn more");
    expect(getLiveSpec().version).toBe(DEFAULT_SPEC.version + 1);
    expect((await GET().json()).spec.hero.headline).toBe("Vintage stock, by the bundle");
  });

  it("rejects an invalid spec and non-JSON bodies", async () => {
    expect((await post({ spec: { ...other, hero: { ...other.hero, layout: "diagonal" } } })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(getLiveSpec().hero.headline).toBe(DEFAULT_SPEC.hero.headline);
  });
});
