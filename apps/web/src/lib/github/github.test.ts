import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Experiment, PageSpec, VariantStats } from "@/lib/contracts";
import { eventStore, track } from "@/lib/analytics/store";
import { resetExperiments, saveExperiment } from "@/lib/experiments/store";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";
import { applyPatch } from "@/lib/spec/patch";
import { promoteSpec, resetSpec } from "@/lib/spec/store";
import { GitHubError } from "./client";
import { FakeGitHub } from "./fake-github";
import {
  GithubIntegrationError,
  connectRepository,
  getGithubStatus,
  githubErrorStatus,
  openAnalyticsInstallPR,
  openSpecPR,
  shipWinningSpec,
} from "./index";
import { REPRESENTATIVE_LAYOUT } from "./install";
import { resetGithubState } from "./store";

const HOST = "https://darwin.example.com";
const REPO = { owner: "acme", repo: "storefront" };
const CONFIG = "apps/web/storefront.config.json";

function stats(variant: string, human: [number, number], agent: [number, number], revenue: number): VariantStats {
  const visitors = human[0] + agent[0];
  const conversions = human[1] + agent[1];
  return {
    variant,
    visitors,
    conversions,
    revenue,
    conversionRate: conversions / visitors,
    byKind: {
      human: { visitors: human[0], conversions: human[1], conversionRate: human[1] / human[0] },
      agent: { visitors: agent[0], conversions: agent[1], conversionRate: agent[1] / agent[0] },
    },
  };
}

function winner(): { spec: PageSpec; experiment: Experiment } {
  const spec = promoteSpec(applyPatch(DEFAULT_SPEC, { cart: { showShippingUpfront: true, freeShippingThreshold: 6000 } }), "Gen 1: Show shipping upfront");
  const experiment: Experiment = {
    id: "exp_test",
    name: "Show shipping upfront",
    status: "completed",
    createdAt: "2026-09-25T10:00:00.000Z",
    completedAt: "2026-09-25T10:30:00.000Z",
    proposalId: "prop_test",
    controlVersion: 0,
    treatmentSpec: { ...spec },
    allocation: 0.5,
    primaryMetric: "order_completed",
    result: {
      control: stats("control", [900, 30], [100, 10], 360000),
      treatment: stats("treatment", [900, 35], [100, 15], 450000),
      lift: 0.25,
      probabilityToBeat: 0.97,
      liftInterval: [0.05, 0.47],
      decision: "ship",
    },
  };
  return { spec, experiment };
}

const nextRepo = () =>
  new FakeGitHub({
    files: {
      "README.md": "# Storefront",
      "apps/web/package.json": "{}",
      "apps/web/next.config.ts": "export default {};\n",
      "apps/web/src/app/layout.tsx": REPRESENTATIVE_LAYOUT,
      [CONFIG]: `${JSON.stringify(DEFAULT_SPEC, null, 2)}\n`,
    },
  });

beforeEach(() => {
  for (const key of ["GITHUB_TOKEN", "DARWIN_GITHUB_DRY_RUN", "DARWIN_TARGET_REPO", "DARWIN_TARGET_CONFIG_PATH", "DARWIN_PUBLIC_URL"]) {
    vi.stubEnv(key, "");
  }
  resetGithubState();
  resetSpec();
  resetExperiments();
  eventStore().clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("offline dry run (no GITHUB_TOKEN)", () => {
  it("previews the install PR without touching the network", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const pr = await openAnalyticsInstallPR(REPO, { host: HOST });
    expect(fetch).not.toHaveBeenCalled();
    expect(pr).toMatchObject({ dryRun: true, branch: "darwin/install-analytics", title: "Install Darwin analytics (humans + AI agents)" });
    expect(pr.url).toBeUndefined();
    expect(pr.detection).toMatchObject({ framework: "nextjs-app", assumed: true });
    expect(pr.files).toHaveLength(1);
    expect(pr.files[0].path).toBe("app/layout.tsx");
    expect(pr.files[0].content).toContain('import Script from "next/script";');
    expect(pr.files[0].content).toContain('src="https://darwin.example.com/darwin.js"');
    expect(pr.files[0].content).toContain('data-darwin-site="acme-storefront"');
    expect(pr.files[0].content).toContain('strategy="afterInteractive"');
    expect(pr.body).toContain("No `GITHUB_TOKEN` is configured");
    expect(pr.body).toContain("assumes a Next.js (App Router) project");
  });

  it("previews the spec PR with title, results table and synthetic-data note", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { spec, experiment } = winner();
    track([
      { event: "$pageview", distinct_id: "v1", properties: { experiment_id: "exp_test", variant: "control", synthetic: true } },
      { event: "order_completed", distinct_id: "v2", properties: { experiment_id: "exp_test", variant: "treatment", synthetic: true } },
    ]);

    const pr = await openSpecPR(REPO, spec, { experiment, summary: "Shipping cost shown upfront stops checkout abandonment." });
    expect(fetch).not.toHaveBeenCalled();
    expect(pr.dryRun).toBe(true);
    expect(pr.title).toBe("Darwin Gen 1: show shipping upfront (+25.0% conversion, P=0.97)");
    expect(pr.branch).toBe("darwin/gen-1-show-shipping-upfront");
    expect(pr.files).toEqual([{ path: CONFIG, content: `${JSON.stringify(spec, null, 2)}\n` }]);
    expect(JSON.parse(pr.files[0].content)).toEqual(spec);

    const body = pr.body;
    expect(body).toContain("Shipping cost shown upfront stops checkout abandonment.");
    expect(body).toContain("| Arm | Spec | Visitors | Orders | Conversion rate | Revenue |");
    expect(body).toContain("| Control | v0 (live) | 1,000 | 40 | **4.00%** | £3,600.00 |");
    expect(body).toContain("| Treatment | v1 (this PR) | 1,000 | 50 | **5.00%** | £4,500.00 |");
    expect(body).toContain("| Humans | 3.33% (30 / 900) | 3.89% (35 / 900) | +16.7% |");
    expect(body).toContain("| AI agents | 10.00% (10 / 100) | 15.00% (15 / 100) | +50.0% |");
    expect(body).toContain("95% credible interval +5.0% to +47.0%");
    expect(body).toContain("`cart.showShippingUpfront` | `false` | `true` |");
    expect(body).toContain("`cart.freeShippingThreshold` | `null` | `6000` (£60.00) |");
    expect(body).toContain("**Simulated traffic.** All 2 events");
    expect(body).toContain("## How Darwin decided");
  });
});

describe("live mode (mocked GitHub)", () => {
  beforeEach(() => vi.stubEnv("GITHUB_TOKEN", "ghp_test"));

  it("detects a monorepo Next.js app, commits via the Git Data API and opens a labelled PR", async () => {
    const gh = nextRepo();
    vi.stubGlobal("fetch", gh.fetch);
    const mainBefore = gh.filesAt("main");

    const pr = await openAnalyticsInstallPR(REPO, { host: HOST });
    expect(pr).toMatchObject({ dryRun: false, number: 1, url: "https://github.com/acme/storefront/pull/1", base: "main", repo: "acme/storefront" });
    expect(pr.detection).toMatchObject({ framework: "nextjs-app", root: "apps/web", targets: ["apps/web/src/app/layout.tsx"] });
    expect(gh.writes()).toEqual([
      "POST /git/refs",
      "POST /git/blobs",
      "POST /git/trees",
      "POST /git/commits",
      "PATCH /git/refs/heads/darwin/install-analytics",
      "POST /pulls",
      "POST /issues/1/labels",
    ]);
    const branch = gh.filesAt("darwin/install-analytics");
    expect(branch["apps/web/src/app/layout.tsx"]).toBe(pr.files[0].content);
    expect(branch["apps/web/src/app/layout.tsx"]).toContain("darwin.js");
    expect(gh.filesAt("main")).toEqual(mainBefore);
    expect(gh.pulls[0]).toMatchObject({ head: "darwin/install-analytics", base: "main", labels: ["darwin", "analytics"] });
    expect(gh.pulls[0].body).toContain("**Detected:** Next.js (App Router) in `apps/web/`");
  });

  it("is idempotent: a second connect updates the open PR instead of duplicating it", async () => {
    const gh = nextRepo();
    vi.stubGlobal("fetch", gh.fetch);
    await openAnalyticsInstallPR(REPO, { host: HOST });
    const before = gh.calls.length;

    const again = await openAnalyticsInstallPR(REPO, { host: HOST });
    expect(again).toMatchObject({ existing: true, number: 1 });
    expect(gh.pulls).toHaveLength(1);
    expect(gh.calls.slice(before).filter((c) => c.method !== "GET").map((c) => `${c.method} ${gh.rel(c.path)}`)).toEqual(["PATCH /pulls/1"]);
  });

  it("does nothing when darwin.js is already installed", async () => {
    const gh = new FakeGitHub({ files: { "index.html": '<head><script src="https://x/darwin.js" defer></script></head>' } });
    vi.stubGlobal("fetch", gh.fetch);
    const pr = await openAnalyticsInstallPR(REPO, { host: HOST });
    expect(pr).toMatchObject({ upToDate: true, dryRun: false, files: [] });
    expect(pr.url).toBeUndefined();
    expect(gh.writes()).toEqual([]);
  });

  it("DARWIN_GITHUB_DRY_RUN=1 reads the real repo but never writes", async () => {
    vi.stubEnv("DARWIN_GITHUB_DRY_RUN", "1");
    const gh = new FakeGitHub({ files: { "layout/theme.liquid": "<html>\n<head>\n  {{ content_for_header }}\n</head>\n</html>\n" } });
    vi.stubGlobal("fetch", gh.fetch);
    const pr = await openAnalyticsInstallPR(REPO, { host: HOST });
    expect(pr.dryRun).toBe(true);
    expect(pr.detection?.framework).toBe("shopify");
    expect(pr.files[0].path).toBe("layout/theme.liquid");
    expect(pr.files[0].content).toContain('data-darwin-site="acme-storefront" defer></script>\n</head>');
    expect(pr.body).toContain("DARWIN_GITHUB_DRY_RUN=1");
    expect(gh.writes()).toEqual([]);
  });

  it("ships a winning spec as a PR editing the config file", async () => {
    const gh = nextRepo();
    vi.stubGlobal("fetch", gh.fetch);
    const { spec, experiment } = winner();

    const pr = await openSpecPR(REPO, spec, { experiment, summary: "" });
    expect(pr).toMatchObject({ dryRun: false, number: 1, branch: "darwin/gen-1-show-shipping-upfront" });
    expect(JSON.parse(gh.filesAt(pr.branch)[CONFIG])).toEqual(spec);
    expect(gh.pulls[0]).toMatchObject({ title: pr.title, labels: ["darwin", "experiment-winner"] });
    expect(gh.pulls[0].body).toContain("Darwin A/B tested “Show shipping upfront” on 2,000 visitors (1,800 humans, 200 AI agents)");
    expect(gh.pulls[0].body).toContain("| Arm | Spec | Visitors |");
    const commit = gh.commits.get(gh.refs.get(pr.branch)!)!;
    expect(commit.message).toBe("Darwin Gen 1: show shipping upfront\n\nExperiment exp_test: +25.0% conversion, P(better) = 0.97.");

    const again = await openSpecPR(REPO, spec, { experiment, summary: "" });
    expect(again.existing).toBe(true);
    expect(gh.pulls).toHaveLength(1);
  });

  it("lists unmerged earlier generations separately and skips no-op ships", async () => {
    const gh = nextRepo();
    vi.stubGlobal("fetch", gh.fetch);
    promoteSpec(applyPatch(DEFAULT_SPEC, { productPage: { ctaPosition: "above-fold" } }), "Gen 1: CTA above the fold");
    const gen2 = promoteSpec(applyPatch(DEFAULT_SPEC, { productPage: { ctaPosition: "above-fold" }, checkout: { guestCheckout: true } }), "Gen 2: Guest checkout");
    const pr = await openSpecPR(REPO, gen2, { summary: "Guest checkout." });
    expect(pr.body).toContain("**Also in this PR**");
    expect(pr.body).toContain("`productPage.ctaPosition`");
    expect(pr.body).toContain("Revert this PR to restore spec v0 (“Baseline”)");

    const same = new FakeGitHub({ files: { [CONFIG]: JSON.stringify(gen2) } });
    vi.stubGlobal("fetch", same.fetch);
    const noop = await openSpecPR(REPO, gen2, { summary: "" });
    expect(noop.upToDate).toBe(true);
    expect(same.writes()).toEqual([]);
  });

  it("respects DARWIN_TARGET_CONFIG_PATH and creates the file if missing", async () => {
    vi.stubEnv("DARWIN_TARGET_CONFIG_PATH", "config/storefront.json");
    const gh = new FakeGitHub({ files: { "README.md": "x" } });
    vi.stubGlobal("fetch", gh.fetch);
    const { spec, experiment } = winner();
    const pr = await openSpecPR(REPO, spec, { experiment, summary: "x" });
    expect(pr.files[0].path).toBe("config/storefront.json");
    expect(pr.notes?.[0]).toMatch(/does not exist on main; this PR creates it/);
    expect(JSON.parse(gh.filesAt(pr.branch)["config/storefront.json"])).toEqual(spec);
  });
});

describe("connect, ship and status", () => {
  it("rejects non-GitHub URLs", async () => {
    const err = await connectRepository("https://gitlab.com/a/b", { host: HOST }).catch((e) => e);
    expect(err).toBeInstanceOf(GithubIntegrationError);
    expect(err.status).toBe(400);
  });

  it("remembers the connection and recent PRs", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const pr = await connectRepository("git@github.com:Acme/Storefront.git", { host: "darwin.example.com/" });
    expect(pr.dryRun).toBe(true);
    const status = getGithubStatus();
    expect(status).toMatchObject({
      configured: false,
      mode: "offline",
      dryRun: true,
      repo: "Acme/Storefront",
      framework: "Next.js (App Router)",
      targetConfigPath: CONFIG,
    });
    expect(status.connection).toMatchObject({ siteId: "acme-storefront", host: "https://darwin.example.com", assumed: true });
    expect(status.connection?.installPr).toMatchObject({ kind: "install", dryRun: true });
    expect(status.recentPullRequests[0]).toMatchObject({ kind: "install", repo: "Acme/Storefront", branch: "darwin/install-analytics" });
  });

  it("ships the latest completed experiment to the target repo", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(shipWinningSpec()).rejects.toMatchObject({ status: 412 });

    vi.stubEnv("DARWIN_TARGET_REPO", "jawadjalal/ecomhack");
    await expect(shipWinningSpec()).rejects.toMatchObject({ status: 409 });
    await expect(shipWinningSpec({ experimentId: "exp_missing" })).rejects.toMatchObject({ status: 404 });

    const { experiment } = winner();
    saveExperiment({ ...experiment, id: "exp_running", status: "running", result: undefined, createdAt: "2026-09-25T11:00:00.000Z" });
    await expect(shipWinningSpec({ experimentId: "exp_running" })).rejects.toMatchObject({ status: 409 });
    saveExperiment(experiment);

    const pr = await shipWinningSpec();
    expect(pr).toMatchObject({ dryRun: true, repo: "jawadjalal/ecomhack", branch: "darwin/gen-1-show-shipping-upfront" });
    expect(getGithubStatus().recentPullRequests[0]).toMatchObject({ kind: "spec", experimentId: "exp_test", specVersion: 1 });
  });

  it("maps GitHub errors to HTTP statuses", () => {
    const limited = new GitHubError("rate limited", { status: 403, method: "GET", path: "/x", rateLimited: true });
    expect(githubErrorStatus(limited).status).toBe(429);
    expect(githubErrorStatus(new GitHubError("nope", { status: 404, method: "GET", path: "/x" })).status).toBe(404);
    expect(githubErrorStatus(new GitHubError("boom", { status: 500, method: "GET", path: "/x" })).status).toBe(502);
    expect(githubErrorStatus(new GithubIntegrationError("bad", 400))).toEqual({ status: 400, error: "bad" });
  });
});
