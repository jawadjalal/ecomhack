import type { ResearchListItem, ResearchReport } from "@/lib/contracts";
import { kvGet, kvUpdate } from "@/lib/db/json-store";

const KEY = "research-reports";
const MAX = 50;

export function listReports(): ResearchListItem[] {
  return kvGet<ResearchReport[]>(KEY, () => []).map((r) => ({
    id: r.id,
    kind: r.kind,
    query: r.query,
    createdAt: r.createdAt,
    demo: r.demo,
    competitors: r.competitors.length,
  }));
}

export function getReport(reportId: string): ResearchReport | undefined {
  return kvGet<ResearchReport[]>(KEY, () => []).find((r) => r.id === reportId);
}

/** Insert or replace (newest first). */
export function saveReport(report: ResearchReport): ResearchReport {
  kvUpdate<ResearchReport[]>(KEY, () => [], (all) => [report, ...all.filter((r) => r.id !== report.id)].slice(0, MAX));
  return report;
}

/** Sliding-window limiter per client (single process, like the rest of the demo state). */
const g = globalThis as unknown as { __darwinResearchHits?: Map<string, number[]> };
export function takeResearchToken(client: string, max: number, windowMs: number, now = Date.now()): boolean {
  const hits: Map<string, number[]> = (g.__darwinResearchHits ??= new Map());
  const recent = (hits.get(client) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(client, recent);
    return false;
  }
  hits.set(client, [...recent, now]);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return true;
}

export function clientOf(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
