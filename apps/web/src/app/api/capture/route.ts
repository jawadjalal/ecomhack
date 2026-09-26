import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/analytics/store";
import { classifyVisitor } from "@/lib/analytics/classify";
import { allowIngest, sanitizeClientEvents } from "@/lib/analytics/trust";

const MAX_BODY_BYTES = 256 * 1024;

const Body = z.object({
  events: z
    .array(
      z.object({
        event: z.string().min(1),
        distinct_id: z.string().min(1),
        timestamp: z.string().optional(),
        uuid: z.string().optional(),
        properties: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(200),
});

/** Simple first-party ingestion: POST { events: [...] }. */
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    /* handled below */
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  if (!allowIngest(req, parsed.data.events.length)) return NextResponse.json({ error: "Too many events" }, { status: 429 });

  const ua = req.headers.get("user-agent");
  const { kind, agentName } = classifyVisitor({ userAgent: ua, declaredAgent: req.headers.get("x-agent-name") });
  const stored = track(
    sanitizeClientEvents(parsed.data.events, "storefront").map((e) => ({
      ...e,
      properties: {
        $user_agent: ua ?? undefined,
        ...e.properties,
        // Server-side classification wins over whatever the client claims.
        visitor_kind: kind,
        ...(agentName ? { agent_name: agentName } : {}),
      },
    })),
  );
  return NextResponse.json({ ok: true, count: stored.length });
}
