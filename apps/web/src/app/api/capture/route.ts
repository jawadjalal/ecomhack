import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/analytics/store";
import { classifyVisitor } from "@/lib/analytics/classify";

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
    .max(500),
});

/** Simple first-party ingestion: POST { events: [...] }. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const ua = req.headers.get("user-agent");
  const { kind, agentName } = classifyVisitor({ userAgent: ua, declaredAgent: req.headers.get("x-agent-name") });
  const stored = track(
    parsed.data.events.map((e) => ({
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
