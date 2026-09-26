import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/github/status/route";
import { checkGithubStatus, connectRepository, getGithubStatus, githubMode, inspectRepository, openAnalyticsInstallPR, resetTokenChecks, verifyGithubToken, TOKEN_CHECK_TTL_MS } from "./index";
import { resetGithubState, saveConnection } from "./store";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** GitHub that rejects every token: 401 Bad credentials. */
const rejecting = () => vi.fn(async () => json(401, { message: "Bad credentials", documentation_url: "https://docs.github.com/rest" }));
/** GitHub that knows the token: GET /user → { login }. */
const accepting = (login = "octocat") => vi.fn(async (url: string | URL | Request) => (String(url).endsWith("/user") ? json(200, { login, id: 1 }) : json(404, { message: "Not Found" })));

beforeEach(() => {
  for (const key of ["GITHUB_TOKEN", "DARWIN_GITHUB_DRY_RUN", "DARWIN_TARGET_REPO"]) vi.stubEnv(key, "");
  resetGithubState();
  resetTokenChecks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the server's GitHub token is checked, not just present", () => {
  it("a token GitHub rejects (401) is reported invalid, and Darwin works in preview mode up front", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_revoked");
    const fetch = rejecting();
    vi.stubGlobal("fetch", fetch);
    expect(githubMode()).toBe("live"); // not checked yet: assume it works

    const status = await checkGithubStatus();
    expect(status).toMatchObject({ configured: true, valid: false, error: "GitHub rejected the token (401)", mode: "offline", dryRun: true });
    expect(status.login).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ghp_revoked");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(githubMode()).toBe("offline");
    expect(getGithubStatus()).toMatchObject({ configured: true, valid: false, mode: "offline" });

    // The onboarding says "preview" before trying, and why.
    const repo = await inspectRepository("acme/storefront");
    expect(repo).toMatchObject({ mode: "offline", assumed: true });
    expect(repo.note).toMatch(/rejected/i);
    // PRs are honest previews that say why, without another round trip.
    const pr = await openAnalyticsInstallPR({ owner: "acme", repo: "storefront" }, { host: "https://darwin.example.com" });
    expect(pr.dryRun).toBe(true);
    expect(pr.notes?.[0]).toMatch(/GitHub rejected the token \(401\)/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a token GitHub accepts is valid, with the account's login", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_good");
    vi.stubGlobal("fetch", accepting("acme-bot"));
    expect(await checkGithubStatus()).toMatchObject({ configured: true, valid: true, login: "acme-bot", mode: "live", dryRun: false });
    expect((await checkGithubStatus()).error).toBeUndefined();
  });

  it("caches the answer for ~5 minutes per token, then asks again", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_cached");
    const fetch = accepting();
    vi.stubGlobal("fetch", fetch);
    const t0 = Date.now();
    await verifyGithubToken(undefined, { now: t0 });
    await verifyGithubToken(undefined, { now: t0 + TOKEN_CHECK_TTL_MS - 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await verifyGithubToken(undefined, { now: t0 + TOKEN_CHECK_TTL_MS + 1000 });
    expect(fetch).toHaveBeenCalledTimes(2);
    // A different token is a different check.
    vi.stubEnv("GITHUB_TOKEN", "ghp_other");
    await verifyGithubToken(undefined, { now: t0 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("GitHub unreachable: not valid (can't confirm), but not treated as rejected", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_offline_network");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
    const status = await checkGithubStatus();
    expect(status).toMatchObject({ configured: true, valid: false, mode: "live" });
    expect(status.error).toMatch(/Couldn't reach GitHub/);
  });

  it("no token: not configured, not valid, no network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await checkGithubStatus()).toMatchObject({ configured: false, valid: false, mode: "offline", dryRun: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a 401 during a PR marks the token rejected, so the next one is a preview up front", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_revoked_later");
    const fetch = rejecting();
    vi.stubGlobal("fetch", fetch);
    const pr = await openAnalyticsInstallPR({ owner: "acme", repo: "storefront" }, { host: "https://darwin.example.com" });
    expect(pr.dryRun).toBe(true);
    expect(githubMode()).toBe("offline");
    const calls = fetch.mock.calls.length;
    await openAnalyticsInstallPR({ owner: "acme", repo: "storefront" }, { host: "https://darwin.example.com" });
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it("a repo connected while the token worked shows as previews once GitHub rejects it", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_later_revoked");
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { message: "Not Found" })));
    await connectRepository("acme/storefront", { host: "https://darwin.example.com" }).catch(() => undefined);
    saveConnection({ ...getGithubStatus().connection!, mode: "live" });
    expect(getGithubStatus().connection?.mode).toBe("live");
    vi.stubGlobal("fetch", rejecting());
    expect((await checkGithubStatus()).connection?.mode).toBe("offline");
  });

  it("GET /api/github/status reports the checked state", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_route_revoked");
    vi.stubGlobal("fetch", rejecting());
    const body = await (await GET()).json();
    expect(body).toMatchObject({ configured: true, valid: false, error: "GitHub rejected the token (401)", mode: "offline", dryRun: true });
    expect(JSON.stringify(body)).not.toContain("ghp_route_revoked");
  });
});
