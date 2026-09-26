/**
 * GitHub integration state in the shared KV: the connected repo and recent PRs.
 */
import { kvDelete, kvGet, kvSet, kvUpdate } from "@/lib/db/json-store";
import type { Framework } from "./install";

export type GithubMode = "live" | "dry-run" | "offline";

export interface PullRequestRecord {
  /** install: analytics PR · spec: ship-the-winner PR · edit: file edits proposed by the team (Pixel). */
  kind: "install" | "spec" | "edit";
  /** "owner/repo". */
  repo: string;
  title: string;
  branch: string;
  url?: string;
  number?: number;
  dryRun: boolean;
  /** An open PR already existed for the branch and was updated. */
  existing?: boolean;
  /** Nothing to change; no PR opened. */
  upToDate?: boolean;
  experimentId?: string;
  specVersion?: number;
  at: string;
}

export interface GithubConnection {
  /** "owner/repo". */
  repo: string;
  owner: string;
  name: string;
  base?: string;
  /** Darwin origin baked into the script tag. */
  host: string;
  siteId: string;
  framework: Framework;
  frameworkLabel: string;
  /** App root inside the repo ("" = repo root). */
  root: string;
  targets: string[];
  /** Detection was assumed (offline dry run) rather than read from the repo. */
  assumed?: boolean;
  mode: GithubMode;
  connectedAt: string;
  installPr?: PullRequestRecord;
}

const CONNECTION_KEY = "github-connection";
const PRS_KEY = "github-prs";
const MAX_PRS = 20;

export function getConnection(): GithubConnection | undefined {
  return kvGet<GithubConnection | null>(CONNECTION_KEY, () => null) ?? undefined;
}

export function saveConnection(conn: GithubConnection): GithubConnection {
  return kvSet(CONNECTION_KEY, conn);
}

/** Newest first. */
export function listPullRequests(): PullRequestRecord[] {
  return kvGet<PullRequestRecord[]>(PRS_KEY, () => []);
}

export function recordPullRequest(pr: PullRequestRecord): PullRequestRecord {
  kvUpdate<PullRequestRecord[]>(PRS_KEY, () => [], (all) =>
    [pr, ...all.filter((p) => !(p.repo === pr.repo && p.branch === pr.branch))].slice(0, MAX_PRS),
  );
  return pr;
}

export function resetGithubState() {
  kvDelete(CONNECTION_KEY);
  kvDelete(PRS_KEY);
}
