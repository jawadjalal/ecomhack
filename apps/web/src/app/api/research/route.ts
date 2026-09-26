import { z } from "zod";
import type { ResearchReport, ResearchStep, ResearchStreamEvent } from "@/lib/contracts";
import { llmLabel } from "@/lib/llm/client";
import { askResearch, clientOf, listReports, researchCompetitors, takeResearchToken, tavilyAvailable } from "@/lib/research";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  kind: z.enum(["competitors", "question"]).default("competitors"),
  query: z.string().trim().min(2).max(500),
  store: z.string().trim().max(500).optional(),
  parentId: z.string().regex(/^rsr_[a-z0-9]{6,20}$/).optional(),
});

const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 20;

/** GET /api/research → past reports + whether Tavily / an LLM are configured. */
export async function GET() {
  return Response.json({ reports: listReports(), status: { tavily: tavilyAvailable(), llm: llmLabel() } });
}

/** POST /api/research { kind, query, store?, parentId? } → ResearchReport (NDJSON stream with Accept: application/x-ndjson). */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Send { kind, query, store?, parentId? }." }, { status: 400 });
  if (!takeResearchToken(clientOf(req), MAX_PER_WINDOW, WINDOW_MS)) {
    return Response.json({ error: "Too many research runs from this address. Try again in a few minutes." }, { status: 429 });
  }
  const { kind, query, store, parentId } = parsed.data;
  const run = (onStep?: (step: ResearchStep) => void) =>
    kind === "question" || parentId ? askResearch({ question: query, store, parentId, onStep }) : researchCompetitors({ store, query, onStep });

  if (!(req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    try {
      return Response.json(await run());
    } catch (e) {
      return errorOut(e);
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: ResearchStreamEvent) => controller.enqueue(enc.encode(`${JSON.stringify(ev)}\n`));
      try {
        const report: ResearchReport = await run((step) => send({ type: "step", step }));
        send({ type: "report", report });
      } catch (e) {
        console.error("[research] failed", e);
        send({ type: "error", error: message(e) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

function message(e: unknown) {
  const m = (e as Error).message ?? "Research failed";
  return m === "Report not found" ? m : `Research failed: ${m.slice(0, 200)}`;
}

function errorOut(e: unknown) {
  const m = message(e);
  console.error("[research] failed", e);
  return Response.json({ error: m }, { status: m === "Report not found" ? 404 : 502 });
}
