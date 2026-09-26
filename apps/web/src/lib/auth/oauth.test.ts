import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as start } from "@/app/api/auth/github/start/route";
import { GET as callback } from "@/app/api/auth/github/callback/route";
import { GET as session } from "@/app/api/auth/session/route";
import { githubMode } from "@/lib/github";
import { githubTokenFor, safeReturnPath, seal, unseal } from "./oauth";

const env = { ...process.env };
beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "Iv1.test";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "shh";
  process.env.DARWIN_SESSION_SECRET = "session-secret";
  delete process.env.DARWIN_PUBLIC_URL;
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].split("=").slice(1).join("=");

describe("GitHub sign-in", () => {
  it("keeps tokens encrypted and only returns to same-site paths", () => {
    const sealed = seal("gho_secret");
    expect(sealed).not.toContain("gho_secret");
    expect(unseal(sealed)).toBe("gho_secret");
    // Tamper with the first ciphertext character (the last one can be padding bits that decode the same).
    const [iv, tag, body] = sealed.split(".");
    expect(unseal([iv, tag, (body[0] === "A" ? "B" : "A") + body.slice(1)].join("."))).toBeUndefined();
    expect(safeReturnPath("/onboarding")).toBe("/onboarding");
    for (const bad of ["//evil.example", "https://evil.example", "javascript:alert(1)", undefined]) expect(safeReturnPath(bad)).toBe("/onboarding");
  });

  it("runs the OAuth web flow: state cookie, code exchange, encrypted session, repos with the merchant's token", async () => {
    const begin = start(new Request("https://darwin.example/api/auth/github/start?return=/onboarding"));
    expect(begin.status).toBe(307);
    const to = new URL(begin.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(to.searchParams.get("redirect_uri")).toBe("https://darwin.example/api/auth/github/callback");
    expect(to.searchParams.get("scope")).toBe("repo read:user");
    const state = to.searchParams.get("state")!;
    const stateCookie = cookieOf(begin, "darwin_oauth_state")!;

    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_merchant" });
      if (u === "https://api.github.com/user") return Response.json({ login: "octo", name: "Octo Cat", avatar_url: "https://avatars/octo" });
      throw new Error(`unexpected ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    // Wrong state → back to onboarding with an error, no session.
    const forged = await callback(new Request(`https://darwin.example/api/auth/github/callback?code=c&state=nope`, { headers: { cookie: `darwin_oauth_state=${stateCookie}` } }));
    expect(forged.headers.get("location")).toMatch(/\/onboarding\?github_error=/);
    expect(cookieOf(forged, "darwin_session")).toBeUndefined();

    const ok = await callback(new Request(`https://darwin.example/api/auth/github/callback?code=c&state=${state}`, { headers: { cookie: `darwin_oauth_state=${stateCookie}` } }));
    expect(ok.headers.get("location")).toBe("https://darwin.example/onboarding?github=connected");
    const sid = cookieOf(ok, "darwin_session")!;
    expect(ok.headers.getSetCookie().find((c) => c.startsWith("darwin_session="))).toMatch(/HttpOnly/i);

    const withSession = new Request("https://darwin.example/api/auth/session", { headers: { cookie: `darwin_session=${sid}` } });
    expect(await session(withSession).json()).toEqual({ providers: { github: true }, github: { login: "octo", name: "Octo Cat", avatarUrl: "https://avatars/octo" } });
    expect(githubTokenFor(withSession)).toBe("gho_merchant");
    expect(JSON.stringify(await session(withSession).json())).not.toContain("gho_");
    // With the merchant's token, GitHub work runs live even without a server GITHUB_TOKEN.
    delete process.env.GITHUB_TOKEN;
    expect(githubMode()).toBe("offline");
    expect(githubMode("gho_merchant")).toBe("live");
  });

  it("says when sign-in isn't configured", () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    expect(start(new Request("https://darwin.example/api/auth/github/start")).status).toBe(503);
  });
});
