// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET as getAccount, POST as postAccount } from "@/app/api/account/route";
import { GET as resume } from "@/app/api/account/resume/route";
import { ACCOUNT_COOKIE, ACCOUNT_DAYS, initialsFor, sealAccount, unsealAccount, withSite } from "./account";
import { seal } from "./oauth";

const ORIGIN = "https://darwin.example";
const post = (body: unknown, cookie?: string) =>
  postAccount(new Request(`${ORIGIN}/api/account`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));

/** "darwin_account=<value>" from a Set-Cookie header. */
function setCookie(res: Response): { value: string; header: string } {
  const header = res.headers.get("set-cookie") ?? "";
  const m = header.match(new RegExp(`${ACCOUNT_COOKIE}=([^;]*)`));
  return { value: m ? decodeURIComponent(m[1]) : "", header };
}

describe("account (sealed cookie, no database)", () => {
  it("seals and unseals an account, and refuses tampered, foreign or expired tokens", () => {
    const token = sealAccount({ email: "jawad@eastfork.com", sites: ["eastfork-com"] });
    expect(unsealAccount(token)).toEqual({ email: "jawad@eastfork.com", sites: ["eastfork-com"] });
    expect(unsealAccount(`${token.slice(0, -2)}AA`)).toBeUndefined();
    expect(unsealAccount(seal(JSON.stringify({ login: "someone" })))).toBeUndefined();
    const old = sealAccount({ email: "a@b.co", sites: [] }, Date.now() - (ACCOUNT_DAYS + 1) * 86_400_000);
    expect(unsealAccount(old)).toBeUndefined();
    expect(unsealAccount(undefined)).toBeUndefined();
  });

  it("makes initials and keeps the newest site first", () => {
    expect(initialsFor("jawad.jalal@x.com")).toBe("JJ");
    expect(initialsFor("sam@x.com")).toBe("S");
    expect(initialsFor("mary-jane_watson@x.com")).toBe("MJ");
    expect(withSite(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(withSite(["a"])).toEqual(["a"]);
  });

  it("POST sets a sealed httpOnly cookie and returns initials and a resume link; GET reads it back", async () => {
    const res = await post({ email: "  Jawad.Jalal@EastFork.com ", site: "eastfork-com" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; initials: string; resumeUrl: string };
    expect(body).toMatchObject({ email: "jawad.jalal@eastfork.com", initials: "JJ" });
    expect(body.resumeUrl).toMatch(/^https:\/\/darwin\.example\/api\/account\/resume\?token=/);
    expect(body).not.toHaveProperty("sent");

    const cookie = setCookie(res);
    expect(cookie.header).toMatch(/HttpOnly/i);
    expect(cookie.header).toMatch(/Secure/i);
    expect(cookie.value).not.toContain("jawad"); // sealed, not readable
    expect(unsealAccount(cookie.value)).toEqual({ email: "jawad.jalal@eastfork.com", sites: ["eastfork-com"] });

    const me = await getAccount(new Request(`${ORIGIN}/api/account`, { headers: { cookie: `${ACCOUNT_COOKIE}=${encodeURIComponent(cookie.value)}` } }));
    expect(await me.json()).toEqual({ email: "jawad.jalal@eastfork.com", initials: "JJ", sites: ["eastfork-com"] });

    // A second store for the same email is added; a different email starts over.
    const again = await post({ email: "jawad.jalal@eastfork.com", site: "second-shop" }, `${ACCOUNT_COOKIE}=${encodeURIComponent(cookie.value)}`);
    expect(unsealAccount(setCookie(again).value)?.sites).toEqual(["second-shop", "eastfork-com"]);
    const other = await post({ email: "other@x.co" }, `${ACCOUNT_COOKIE}=${encodeURIComponent(cookie.value)}`);
    expect(unsealAccount(setCookie(other).value)).toEqual({ email: "other@x.co", sites: [] });
  });

  it("GET without a cookie (or with a forged one) is anonymous", async () => {
    expect(await (await getAccount(new Request(`${ORIGIN}/api/account`))).json()).toEqual({ sites: [] });
    const forged = await getAccount(new Request(`${ORIGIN}/api/account`, { headers: { cookie: `${ACCOUNT_COOKIE}=${encodeURIComponent(btoa('{"email":"x@y.z"}'))}` } }));
    expect(await forged.json()).toEqual({ sites: [] });
  });

  it("rejects bad emails and bad site ids", async () => {
    for (const email of ["", "not-an-email", "a@b", "<script>@x.com", 42]) {
      const res = await post({ email });
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await post({ email: "a@b.co", site: "../etc" })).status).toBe(400);
  });

  it("resume sets the cookie and opens the first site's dashboards, or onboarding", async () => {
    const token = sealAccount({ email: "jawad@eastfork.com", sites: ["eastfork-com", "b"] });
    const res = resume(new Request(`${ORIGIN}/api/account/resume?token=${encodeURIComponent(token)}`));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/console/dashboards?site=eastfork-com`);
    expect(unsealAccount(setCookie(res).value)).toEqual({ email: "jawad@eastfork.com", sites: ["eastfork-com", "b"] });

    const none = resume(new Request(`${ORIGIN}/api/account/resume?token=${encodeURIComponent(sealAccount({ email: "a@b.co", sites: [] }))}`));
    expect(none.headers.get("location")).toBe(`${ORIGIN}/onboarding`);

    const bad = resume(new Request(`${ORIGIN}/api/account/resume?token=nope`));
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/onboarding?resume=expired`);
    expect(setCookie(bad).value).toBe("");
  });
});
