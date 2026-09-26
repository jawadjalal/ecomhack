import { z } from "zod";
import { eventStore } from "@/lib/analytics/store";
import { LEVER_ORDER, runSimulatedBuyers, setAgentAutopilot, startAgentTest, stepAgentTests, agentTestsView } from "@/lib/store-agent";

function origin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const dynamic = "force-dynamic";

/** GET /api/store-agent/tests → { state, results }: A/B tests on how the store agent sells. */
export function GET() {
  return Response.json(agentTestsView(eventStore().all()));
}

const Body = z.object({
  autopilot: z.boolean().optional(),
  start: z.enum(LEVER_ORDER as [string, ...string[]]).optional(),
  /** Simulated buyer agents to send first (labelled synthetic). */
  buyers: z.number().int().min(1).max(500).optional(),
  /** Decide the running test (and start the next one when autopilot is on). */
  step: z.boolean().optional(),
});

/** POST /api/store-agent/tests { autopilot?, start?, buyers?, step? } → { state, results, did, buyers? } */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.autopilot !== undefined) setAgentAutopilot(b.autopilot);
    if (b.start) startAgentTest(b.start as Parameters<typeof startAgentTest>[0]);
    const sent = b.buyers ? await runSimulatedBuyers(b.buyers, origin(req)) : undefined;
    const did = b.step || b.autopilot ? stepAgentTests(eventStore().all()) : [];
    return Response.json({ ...agentTestsView(eventStore().all()), did, buyers: sent });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
