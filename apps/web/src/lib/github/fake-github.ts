/**
 * TEST HELPER: an in-memory fake of the slice of the GitHub REST API Darwin uses, exposed as a
 * `fetch` implementation. Records every call so tests can assert on exact request sequences.
 * Never imported by application code.
 */

export interface FakeCall {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

interface FakePull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  merged?: boolean;
}

export interface FakeGitHubOptions {
  owner?: string;
  repo?: string;
  defaultBranch?: string;
  /** Files on the default branch. */
  files: Record<string, string>;
}

let counter = 0;
const sha = (prefix: string) => `${prefix}${(++counter).toString(16).padStart(8, "0")}`;

export class FakeGitHub {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  readonly calls: FakeCall[] = [];
  readonly refs = new Map<string, string>(); // branch → commit sha
  readonly commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  readonly trees = new Map<string, Record<string, string>>(); // tree sha → path → blob sha
  readonly blobs = new Map<string, string>(); // blob sha → content
  readonly pulls: FakePull[] = [];

  constructor(opts: FakeGitHubOptions) {
    this.owner = opts.owner ?? "acme";
    this.repo = opts.repo ?? "storefront";
    this.defaultBranch = opts.defaultBranch ?? "main";
    const entries: Record<string, string> = {};
    for (const [path, content] of Object.entries(opts.files)) {
      const b = sha("b");
      this.blobs.set(b, content);
      entries[path] = b;
    }
    const tree = sha("t");
    this.trees.set(tree, entries);
    const commit = sha("c");
    this.commits.set(commit, { tree, parents: [], message: "initial" });
    this.refs.set(this.defaultBranch, commit);
  }

  /** Files at a branch or commit sha. */
  filesAt(ref: string): Record<string, string> {
    const commit = this.refs.get(ref) ?? ref;
    const c = this.commits.get(commit);
    if (!c) throw new Error(`unknown ref ${ref}`);
    return Object.fromEntries(Object.entries(this.trees.get(c.tree)!).map(([p, b]) => [p, this.blobs.get(b)!]));
  }

  /** Non-GET calls, as "METHOD /path" strings relative to the repo. */
  writes(): string[] {
    return this.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${this.rel(c.path)}`);
  }

  rel(path: string) {
    return path.replace(`/repos/${this.owner}/${this.repo}`, "").replace(/\?.*$/, "") || "/";
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    this.calls.push({ method, path: url.pathname + url.search, body, headers });
    return this.route(method, url, body);
  };

  private json(status: number, data: unknown) {
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  }

  private notFound() {
    return this.json(404, { message: "Not Found", documentation_url: "https://docs.github.com/rest" });
  }

  private pullJson(p: FakePull) {
    return {
      number: p.number,
      html_url: `https://github.com/${this.owner}/${this.repo}/pull/${p.number}`,
      title: p.title,
      body: p.body,
      state: p.state,
      head: { ref: p.head },
      base: { ref: p.base },
    };
  }

  private route(method: string, url: URL, body?: Record<string, unknown>): Response {
    const prefix = `/repos/${this.owner}/${this.repo}`;
    if (!url.pathname.startsWith(prefix)) return this.notFound();
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    const key = `${method} ${path}`;
    let m: RegExpMatchArray | null;

    if (key === "GET ") {
      return this.json(200, {
        full_name: `${this.owner}/${this.repo}`,
        default_branch: this.defaultBranch,
        html_url: `https://github.com/${this.owner}/${this.repo}`,
        private: false,
      });
    }
    if ((m = key.match(/^GET \/git\/ref\/heads\/(.+)$/))) {
      const s = this.refs.get(m[1]);
      return s ? this.json(200, { ref: `refs/heads/${m[1]}`, object: { sha: s, type: "commit" } }) : this.notFound();
    }
    if ((m = key.match(/^GET \/git\/trees\/(.+)$/))) {
      const commit = this.refs.get(m[1]) ?? m[1];
      const c = this.commits.get(commit);
      if (!c) return this.notFound();
      const tree = Object.entries(this.trees.get(c.tree)!).map(([p, b]) => ({ path: p, type: "blob", sha: b, mode: "100644" }));
      return this.json(200, { sha: c.tree, truncated: false, tree });
    }
    if ((m = key.match(/^GET \/contents\/(.+)$/))) {
      const ref = url.searchParams.get("ref") ?? this.defaultBranch;
      let files: Record<string, string>;
      try {
        files = this.filesAt(ref);
      } catch {
        return this.notFound();
      }
      const content = files[m[1]];
      if (content === undefined) return this.notFound();
      return this.json(200, {
        type: "file",
        path: m[1],
        sha: sha("b"),
        encoding: "base64",
        content: Buffer.from(content, "utf8").toString("base64"),
      });
    }
    if ((m = key.match(/^GET \/git\/commits\/(.+)$/))) {
      const c = this.commits.get(m[1]);
      return c ? this.json(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((p) => ({ sha: p })) }) : this.notFound();
    }
    if (key === "POST /git/refs") {
      const branch = String(body!.ref).replace(/^refs\/heads\//, "");
      if (this.refs.has(branch)) return this.json(422, { message: "Reference already exists" });
      this.refs.set(branch, String(body!.sha));
      return this.json(201, { ref: body!.ref, object: { sha: body!.sha } });
    }
    if ((m = key.match(/^PATCH \/git\/refs\/heads\/(.+)$/))) {
      if (!this.refs.has(m[1])) return this.json(422, { message: "Reference does not exist" });
      const next = String(body!.sha);
      const current = this.refs.get(m[1])!;
      const fastForward = this.commits.get(next)?.parents.includes(current);
      if (!body!.force && !fastForward) return this.json(422, { message: "Update is not a fast forward" });
      this.refs.set(m[1], next);
      return this.json(200, { object: { sha: next } });
    }
    if (key === "POST /git/blobs") {
      const b = sha("b");
      this.blobs.set(b, String(body!.content));
      return this.json(201, { sha: b });
    }
    if (key === "POST /git/trees") {
      const base = body!.base_tree ? { ...this.trees.get(String(body!.base_tree))! } : {};
      for (const e of body!.tree as { path: string; sha: string }[]) base[e.path] = e.sha;
      const t = sha("t");
      this.trees.set(t, base);
      return this.json(201, { sha: t });
    }
    if (key === "POST /git/commits") {
      const c = sha("c");
      this.commits.set(c, { tree: String(body!.tree), parents: body!.parents as string[], message: String(body!.message) });
      return this.json(201, { sha: c });
    }
    if (key === "GET /pulls") {
      const head = url.searchParams.get("head")?.split(":")[1];
      const state = url.searchParams.get("state") ?? "open";
      return this.json(
        200,
        this.pulls.filter((p) => (!head || p.head === head) && (state === "all" || p.state === state)).map((p) => this.pullJson(p)),
      );
    }
    if (key === "POST /pulls") {
      const pr: FakePull = {
        number: this.pulls.length + 1,
        head: String(body!.head),
        base: String(body!.base),
        title: String(body!.title),
        body: String(body!.body),
        state: "open",
        labels: [],
      };
      this.pulls.push(pr);
      return this.json(201, this.pullJson(pr));
    }
    if ((m = key.match(/^PATCH \/pulls\/(\d+)$/))) {
      const pr = this.pulls.find((p) => p.number === Number(m![1]));
      if (!pr) return this.notFound();
      if (body!.title) pr.title = String(body!.title);
      if (body!.body) pr.body = String(body!.body);
      return this.json(200, this.pullJson(pr));
    }
    if ((m = key.match(/^POST \/issues\/(\d+)\/labels$/))) {
      const pr = this.pulls.find((p) => p.number === Number(m![1]));
      if (!pr) return this.notFound();
      pr.labels.push(...(body!.labels as string[]));
      return this.json(200, pr.labels.map((name) => ({ name })));
    }
    if ((m = key.match(/^GET \/pulls\/(\d+)$/))) {
      const pr = this.pulls.find((p) => p.number === Number(m![1]));
      if (!pr) return this.notFound();
      const j = this.pullJson(pr);
      return this.json(200, { ...j, head: { ...j.head, sha: this.refs.get(pr.head) }, merged: Boolean(pr.merged), mergeable: true, draft: false });
    }
    if ((m = key.match(/^PUT \/pulls\/(\d+)\/merge$/))) {
      const pr = this.pulls.find((p) => p.number === Number(m![1]));
      if (!pr || pr.state !== "open") return this.json(405, { message: "Pull Request is not mergeable" });
      if (body!.sha && body!.sha !== this.refs.get(pr.head)) return this.json(409, { message: "Head branch was modified" });
      const c = sha("c");
      const head = this.commits.get(this.refs.get(pr.head)!)!;
      this.commits.set(c, { tree: head.tree, parents: [this.refs.get(pr.base)!], message: `${pr.title} (#${pr.number})` });
      this.refs.set(pr.base, c);
      pr.state = "closed";
      pr.merged = true;
      return this.json(200, { merged: true, sha: c, message: "Pull Request successfully merged" });
    }
    if ((m = key.match(/^GET \/commits\/([^/]+)\/status$/))) return this.json(200, { state: "success", statuses: [] });
    if ((m = key.match(/^GET \/commits\/([^/]+)\/check-runs$/))) return this.json(200, { check_runs: [] });
    return this.json(500, { message: `FakeGitHub: unhandled ${key}` });
  }
}
