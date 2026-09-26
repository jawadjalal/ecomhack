import { ask, type AskResponse, type AskTurn } from "@/lib/ask";

export const dynamic = "force-dynamic";

const MAX_QUESTION = 500;
const MAX_TURNS = 12;

function parseHistory(raw: unknown): AskTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { role: string; text: string } => !!t && typeof t === "object" && typeof (t as AskTurn).text === "string")
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role === "user" ? "user" : "darwin", text: t.text.slice(0, 2000) }));
}

/**
 * POST /api/ask { question, history? } → { answer, cards?: { label, value }[], source: "llm" | "heuristic" }
 * The Overview chat ("Ask Darwin about your shoppers"). Admin-gated like the rest of mission control.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { question }" }, { status: 400 });
  }
  const question = typeof (body as { question?: unknown })?.question === "string" ? (body as { question: string }).question.trim() : "";
  if (!question) return Response.json({ error: "Ask a question." }, { status: 400 });
  if (question.length > MAX_QUESTION) return Response.json({ error: `Keep questions under ${MAX_QUESTION} characters.` }, { status: 400 });
  const res: AskResponse = await ask({ question, history: parseHistory((body as { history?: unknown }).history) });
  return Response.json(res, { headers: { "cache-control": "no-store" } });
}
