import type { NextRequest } from "next/server";
import { z } from "zod";
import type { AnalyticsFilter, AnalyticsSummaryResponse } from "@/lib/contracts";
import { getAnalyticsSummaryShared } from "@/lib/analytics/summary";

export const dynamic = "force-dynamic";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const Query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  visitorKind: z.enum(["human", "agent"]).optional(),
  experimentId: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
  specVersion: z.coerce.number().int().nonnegative().optional(),
  includeSynthetic: bool.optional(),
});

/**
 * GET /api/analytics/summary?from=&to=&visitorKind=&experimentId=&variant=&specVersion=&includeSynthetic=
 * → AnalyticsSummary (contracts/analytics.ts)
 */
export function GET(req: NextRequest) {
  const raw = Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = Query.safeParse(raw);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });

  const filter: AnalyticsFilter = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as AnalyticsFilter;
  // Reused until the next event arrives, so polling consoles don't re-scan an unchanged store.
  const body: AnalyticsSummaryResponse = getAnalyticsSummaryShared(filter);
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
