/**
 * GitHub integration — public API. OWNED BY: github PR. Keep these signatures stable.
 *
 * Without GITHUB_TOKEN every call runs in dry-run mode and returns the would-be PR
 * (files + body) so the demo still works offline.
 */
import type { Experiment, PageSpec } from "@/lib/contracts";

export interface RepoRef {
  owner: string;
  repo: string;
  /** Base branch. Default: repo default branch. */
  base?: string;
}

export interface PullRequestResult {
  dryRun: boolean;
  url?: string;
  number?: number;
  branch: string;
  title: string;
  body: string;
  files: { path: string; content: string }[];
}

/** Onboarding: open a PR that installs Darwin analytics into the connected storefront repo. */
export async function openAnalyticsInstallPR(_repo: RepoRef, _opts: { host: string }): Promise<PullRequestResult> {
  throw new Error("not implemented");
}

/** Ship: open a PR that makes the winning spec the new storefront config. */
export async function openSpecPR(
  _repo: RepoRef,
  _spec: PageSpec,
  _ctx: { experiment?: Experiment; summary: string },
): Promise<PullRequestResult> {
  throw new Error("not implemented");
}
