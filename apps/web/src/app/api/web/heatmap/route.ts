import { eventStore } from "@/lib/analytics/store";
import { TRAFFIC_SOURCES, type TrafficSource } from "@/lib/contracts";
import { computeHeatmap, SiteSchema } from "@/lib/web";

export const dynamic = "force-dynamic";

/** GET /api/web/heatmap?site=…&path=/demo/north-trail&source=social → WebHeatmap (clicks per element). */
export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const site = SiteSchema.safeParse(params.get("site") ?? "");
  if (!site.success) return Response.json({ error: "?site= is required" }, { status: 400 });
  const path = params.get("path")?.slice(0, 300) || undefined;
  const raw = params.get("source");
  const source = raw && (TRAFFIC_SOURCES as readonly string[]).includes(raw) ? (raw as TrafficSource) : undefined;
  return Response.json(computeHeatmap(site.data, eventStore().all(), { path, source }));
}
