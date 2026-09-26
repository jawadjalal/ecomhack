import { describe, expect, it, vi } from "vitest";
import { GitHubClient, GitHubError, parseRepoUrl } from "./client";
import { FakeGitHub } from "./fake-github";

describe("parseRepoUrl", () => {
  it.each([
    ["https://github.com/acme/storefront", "acme", "storefront"],
    ["https://github.com/acme/storefront.git", "acme", "storefront"],
    ["https://www.github.com/acme/storefront/", "acme", "storefront"],
    ["https://github.com/acme/storefront/tree/main/apps/web?tab=readme#top", "acme", "storefront"],
    ["github.com/acme/storefront", "acme", "storefront"],
    ["acme/storefront", "acme", "storefront"],
    ["  acme/store.front-2  ", "acme", "store.front-2"],
    ["git@github.com:acme/storefront.git", "acme", "storefront"],
    ["ssh://git@github.com/acme/storefront.git", "acme", "storefront"],
  ])("parses %s", (input, owner, repo) => {
    expect(parseRepoUrl(input)).toEqual({ owner, repo });
  });

  it.each([
    "",
    "storefront",
    "acme/storefront/extra",
    "https://gitlab.com/acme/storefront",
    "https://github.com/acme",
    "git@gitlab.com:acme/storefront.git",
    "acme!/storefront",
    "-acme/storefront",
    "not a url",
  ])("rejects %j", (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});

describe("GitHubClient", () => {
  it("sends auth and API version headers", async () => {
    const gh = new FakeGitHub({ files: { "README.md": "hi" } });
    const client = new GitHubClient({ token: "tok_123", fetch: gh.fetch });
    const info = await client.getRepo("acme", "storefront");
    expect(info).toMatchObject({ fullName: "acme/storefront", defaultBranch: "main" });
    expect(gh.calls[0].headers).toMatchObject({
      authorization: "Bearer tok_123",
      "x-github-api-version": "2022-11-28",
      accept: "application/vnd.github+json",
    });
  });

  it("decodes file contents and returns null for missing files and branches", async () => {
    const gh = new FakeGitHub({ files: { "app/layout.tsx": "export default 1 // £ ✓\n" } });
    const client = new GitHubClient({ token: "t", fetch: gh.fetch });
    expect((await client.getFileContent("acme", "storefront", "app/layout.tsx", "main"))?.content).toBe("export default 1 // £ ✓\n");
    expect(await client.getFileContent("acme", "storefront", "nope.txt", "main")).toBeNull();
    expect(await client.getBranchSha("acme", "storefront", "does-not-exist")).toBeNull();
  });

  it("explains rate limits clearly", async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded for user." }), {
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1790000000" },
      }),
    );
    const client = new GitHubClient({ token: "t", fetch });
    const err = await client.getRepo("acme", "storefront").catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.rateLimited).toBe(true);
    expect(err.message).toMatch(/rate limit exceeded on GET \/repos\/acme\/storefront \(resets at \d\d:\d\d:\d\d UTC\)/);
  });

  it("explains 401, 404 and 422 errors", async () => {
    const respond = (status: number, body: object) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
    const e401 = await new GitHubClient({ fetch: respond(401, { message: "Bad credentials" }) }).getRepo("a", "b").catch((e) => e);
    expect(e401.message).toMatch(/rejected the token.*Check GITHUB_TOKEN/);
    const e404 = await new GitHubClient({ fetch: respond(404, { message: "Not Found" }) }).getRepo("a", "b").catch((e) => e);
    expect(e404.message).toMatch(/404.*may not exist, or GITHUB_TOKEN cannot access it/);
    const e422 = await new GitHubClient({
      fetch: respond(422, { message: "Validation Failed", errors: [{ message: "A pull request already exists" }] }),
    })
      .createPullRequest("a", "b", { title: "t", body: "b", head: "h", base: "main" })
      .catch((e) => e);
    expect(e422.message).toMatch(/422: Validation Failed — A pull request already exists/);
  });

  it("commits multiple files via blobs → tree → commit → ref", async () => {
    const gh = new FakeGitHub({ files: { "README.md": "hi", "app/layout.tsx": "old" } });
    const client = new GitHubClient({ token: "t", fetch: gh.fetch });
    const base = gh.refs.get("main")!;
    await client.createBranch("acme", "storefront", "darwin/test", base);
    gh.calls.length = 0;

    const commit = await client.commitFiles("acme", "storefront", {
      branch: "darwin/test",
      message: "Darwin: test",
      files: [
        { path: "app/layout.tsx", content: "new" },
        { path: "DARWIN.md", content: "# Darwin" },
      ],
    });

    expect(gh.calls.map((c) => `${c.method} ${gh.rel(c.path)}`)).toEqual([
      "GET /git/ref/heads/darwin/test",
      `GET /git/commits/${base}`,
      "POST /git/blobs",
      "POST /git/blobs",
      "POST /git/trees",
      "POST /git/commits",
      "PATCH /git/refs/heads/darwin/test",
    ]);
    const treeCall = gh.calls[4].body!;
    expect(treeCall.base_tree).toBe(gh.commits.get(base)!.tree);
    expect(treeCall.tree).toEqual([
      expect.objectContaining({ path: "app/layout.tsx", mode: "100644", type: "blob" }),
      expect.objectContaining({ path: "DARWIN.md", mode: "100644", type: "blob" }),
    ]);
    expect(gh.calls[5].body).toMatchObject({ message: "Darwin: test", parents: [base] });
    expect(gh.calls[6].body).toEqual({ sha: commit, force: false });
    expect(gh.filesAt("darwin/test")).toEqual({ "README.md": "hi", "app/layout.tsx": "new", "DARWIN.md": "# Darwin" });
    expect(gh.filesAt("main")["app/layout.tsx"]).toBe("old");
  });

  it("finds an existing open PR for a branch and treats labels as best-effort", async () => {
    const gh = new FakeGitHub({ files: { "README.md": "hi" } });
    const client = new GitHubClient({ token: "t", fetch: gh.fetch });
    expect(await client.findOpenPullRequest("acme", "storefront", "darwin/x")).toBeNull();
    const pr = await client.createPullRequest("acme", "storefront", { title: "T", body: "B", head: "darwin/x", base: "main" });
    expect(await client.findOpenPullRequest("acme", "storefront", "darwin/x")).toMatchObject({ number: pr.number, head: "darwin/x" });
    expect(await client.addLabels("acme", "storefront", 999, ["darwin"])).toBe(false); // 404, swallowed
  });

  it("read-only clients refuse to write", async () => {
    const fetch = vi.fn();
    const client = new GitHubClient({ token: "t", fetch, readOnly: true });
    await expect(client.createBranch("a", "b", "x", "sha")).rejects.toThrow(/Dry run: refusing to POST/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
