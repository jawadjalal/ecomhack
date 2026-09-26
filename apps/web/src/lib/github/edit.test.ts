/** Repo editing for the agent team: changesets, commits, PRs, status and merge (live against FakeGitHub). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeGitHub } from "./fake-github";
import {
  commitChangeset,
  getChangeset,
  listRepoFiles,
  mergePullRequest,
  openChangesetPR,
  pullRequestStatus,
  readRepoFile,
  repoPathError,
  searchRepoCode,
  stageFileEdits,
  stageFileWrite,
  unifiedDiff,
} from "./index";
import { resetGithubState } from "./store";

const PAGE = `export default function Page() {\n  return <h1>Run further</h1>;\n}\n`;
const env = { ...process.env };

beforeEach(() => {
  resetGithubState();
  delete process.env.GITHUB_TOKEN;
  delete process.env.DARWIN_GITHUB_DRY_RUN;
  process.env.DARWIN_TARGET_REPO = "acme/storefront";
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("paths and diffs", () => {
  it("refuses traversal, git internals, workflows and env files", () => {
    expect(repoPathError("src/app/page.tsx")).toBeUndefined();
    for (const bad of ["../x", "/etc/passwd", ".git/config", ".github/workflows/ci.yml", ".env.local", "a//b"]) expect(repoPathError(bad)).toBeTruthy();
  });

  it("builds a compact unified diff", () => {
    const d = unifiedDiff("a\nb\nc\nd\ne\nf\ng", "a\nb\nc\nD\ne\nf\ng");
    expect(d).toMatchObject({ added: 1, removed: 1 });
    expect(d.preview).toBe(" b\n c\n-d\n+D\n e\n f");
    expect(unifiedDiff(null, "x\ny").added).toBe(2);
  });
});

describe("offline (no token)", () => {
  it("never touches the network and previews a PR", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await readRepoFile({ path: "a.ts" })).ok).toBe(false);
    await expect(stageFileEdits("cs1", { path: "a.ts", edits: [{ find: "x", replace: "y" }] })).rejects.toThrow(/GITHUB_TOKEN/);
    await stageFileWrite("cs1", { path: "notes/returns.md", content: "Free returns\n" });
    const pr = await openChangesetPR("cs1", { title: "Add returns note" });
    expect(pr).toMatchObject({ dryRun: true, repo: "acme/storefront", preview: [{ path: "notes/returns.md", added: 2 }] });
    expect((await mergePullRequest({ number: 3 })).merged).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("live", () => {
  it("stages exact edits, commits once, opens a PR, reports status and merges", async () => {
    const gh = new FakeGitHub({ files: { "src/app/page.tsx": PAGE, "README.md": "hi\n" } });
    vi.stubGlobal("fetch", gh.fetch);
    process.env.GITHUB_TOKEN = "t";

    expect((await listRepoFiles()).files).toEqual(["src/app/page.tsx", "README.md"]);
    expect((await readRepoFile({ path: "src/app/page.tsx" })).content).toBe(PAGE);
    const found = await searchRepoCode({ query: "Run further" });
    expect(found.matches).toContainEqual({ path: "src/app/page.tsx", line: 2, text: "return <h1>Run further</h1>;" });

    await expect(stageFileEdits("cs", { path: "src/app/page.tsx", edits: [{ find: "Walk", replace: "x" }] })).rejects.toThrow(/isn't in/);
    const s = await stageFileEdits("cs", { path: "src/app/page.tsx", edits: [{ find: "Run further", replace: "Run further, for less" }] });
    expect(s.files[0]).toMatchObject({ added: 1, removed: 1, committed: false });
    await stageFileWrite("cs", { path: "src/returns.ts", content: "export const RETURNS = 60;\n" });
    expect(gh.writes()).toEqual([]); // staging never writes

    const c = await commitChangeset("cs", { message: "Copy + returns" });
    expect(c.commit?.files).toEqual(["src/app/page.tsx", "src/returns.ts"]);
    const branch = getChangeset("cs")!.branch;
    expect(gh.filesAt(branch)["src/app/page.tsx"]).toContain("for less");
    expect(gh.writes().filter((w) => w === "POST /git/commits")).toHaveLength(1);

    const pr = await openChangesetPR("cs", { title: "Sharper headline" });
    expect(pr).toMatchObject({ dryRun: false, number: 1, branch });
    expect(gh.writes().filter((w) => w === "POST /git/commits")).toHaveLength(1); // nothing new to commit

    const st = await pullRequestStatus({ number: 1 });
    expect(st).toMatchObject({ ok: true, state: "open", mergeable: true, checks: { state: "none" } });

    const m = await mergePullRequest({ number: 1 });
    expect(m).toMatchObject({ ok: true, merged: true });
    expect(gh.filesAt("main")["src/returns.ts"]).toBe("export const RETURNS = 60;\n");
    expect((await pullRequestStatus({ number: 1 })).state).toBe("merged");
  });

  it("dry-run mode reads but never writes or merges", async () => {
    const gh = new FakeGitHub({ files: { "src/app/page.tsx": PAGE } });
    vi.stubGlobal("fetch", gh.fetch);
    process.env.GITHUB_TOKEN = "t";
    process.env.DARWIN_GITHUB_DRY_RUN = "1";
    await stageFileEdits("d", { path: "src/app/page.tsx", edits: [{ find: "Run further", replace: "Go" }] });
    const pr = await openChangesetPR("d", { title: "x" });
    expect(pr.dryRun).toBe(true);
    expect(gh.writes()).toEqual([]);
  });
});
