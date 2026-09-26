import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvSet } from "@/lib/db/json-store";
import { connectServerWhop, getWhopStatus } from "./index";

const env = { ...process.env };

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("connectServerWhop", () => {
  beforeEach(() => {
    kvSet("whop-connection", null);
    delete process.env.WHOP_API_KEY;
    delete process.env.WHOP_COMPANY_ID;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("does nothing without a server key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await connectServerWhop()).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getWhopStatus().connection).toBeUndefined();
  });

  it("connects the server key once, with the business's name (Settings shows it connected)", async () => {
    process.env.WHOP_API_KEY = "whop_test";
    process.env.WHOP_COMPANY_ID = "biz_abc";
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/companies/") ? answer({ id: "biz_abc", title: "Trail Club" }) : answer({ data: [{ id: "prod_1", title: "Coaching" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const c = await connectServerWhop();
    expect(c).toMatchObject({ mode: "live", accountId: "biz_abc", title: "Trail Club" });
    expect(getWhopStatus()).toMatchObject({ configured: true, connection: { title: "Trail Club" } });
    const calls = fetchMock.mock.calls.length;
    await connectServerWhop();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("never titles the business with its raw id", async () => {
    process.env.WHOP_API_KEY = "whop_test";
    process.env.WHOP_COMPANY_ID = "biz_abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).includes("/companies/") ? answer({ id: "biz_abc" }) : answer({ data: [] }))),
    );
    const c = await connectServerWhop();
    expect(c?.title).toBe("Whop business");
  });
});
