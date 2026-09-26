/**
 * The browser's copy of what onboarding set up, so the console survives serverless instances.
 *
 * Vercel runs several instances, each with its own in-memory state: the plan (and the simulated shoppers)
 * made on one can be missing on the instance that serves /console/dashboards. The browser keeps a copy in
 * localStorage; the dashboards page sends it back with POST /api/onboarding/restore when the server has none.
 *
 * Client-safe: no server imports. Every storage call is wrapped (private mode, blocked storage, SSR).
 */
import type { TrackingPlan } from "@/lib/contracts";

const PLAN = (site: string) => `darwin.plan.${site}`;
const SIM = (site: string) => `darwin.sim.${site}`;
const LAST = "darwin.site.last";
const SITE_RE = /^[\w.-]{1,64}$/;

function store(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | undefined {
  try {
    return store()?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string) {
  try {
    store()?.setItem(key, value);
  } catch {
    /* full or blocked: the console just can't restore this one */
  }
}

/** Keep the browser's copy of a plan (call whenever the server hands one back). */
export function rememberPlan(plan: TrackingPlan): void {
  if (!plan || !SITE_RE.test(plan.site)) return;
  write(PLAN(plan.site), JSON.stringify(plan));
}

export function recallPlan(site: string): TrackingPlan | undefined {
  if (!SITE_RE.test(site)) return undefined;
  const raw = read(PLAN(site));
  if (!raw) return undefined;
  try {
    const plan = JSON.parse(raw) as TrackingPlan;
    return plan && plan.site === site && Array.isArray(plan.events) && Array.isArray(plan.dashboards) ? plan : undefined;
  } catch {
    return undefined;
  }
}

/** Add `visitors` simulated shoppers to the site's running total (so they can be re-sent to a fresh instance). */
export function rememberSimulated(site: string, visitors: number): void {
  if (!SITE_RE.test(site) || !Number.isFinite(visitors) || visitors <= 0) return;
  write(SIM(site), String(recallSimulated(site) + Math.floor(visitors)));
}

export function recallSimulated(site: string): number {
  if (!SITE_RE.test(site)) return 0;
  const n = Number(read(SIM(site)) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The site the merchant set up last (the console opens on it when the URL names none). */
export function rememberSite(site: string, url?: string): void {
  if (!SITE_RE.test(site)) return;
  write(LAST, JSON.stringify(url ? { site, url } : { site }));
}

export function recallLastSite(): { site: string; url?: string } | undefined {
  const raw = read(LAST);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as { site?: unknown; url?: unknown };
    if (typeof v?.site !== "string" || !SITE_RE.test(v.site)) return undefined;
    return typeof v.url === "string" ? { site: v.site, url: v.url } : { site: v.site };
  } catch {
    return undefined;
  }
}
