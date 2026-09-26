import { z } from "zod";
import { synthesize, takeVoiceToken, voiceAvailable, voiceClient, VoiceError } from "@/lib/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  text: z.string().trim().min(1).max(6000),
  agent: z.string().trim().max(32).optional(),
});

const WINDOW_MS = 60_000;
const PER_CLIENT = 40;
const GLOBAL = 200;

/** POST /api/voice/tts { text, agent? } → audio/mpeg stream in that agent's voice (admin, rate-limited). */
export async function POST(req: Request) {
  if (!voiceAvailable()) return Response.json({ error: "Voice isn't set up on this server yet." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { text, agent? }." }, { status: 400 });
  if (!takeVoiceToken(`tts:${voiceClient(req)}`, PER_CLIENT, WINDOW_MS) || !takeVoiceToken("tts:*", GLOBAL, WINDOW_MS)) {
    return Response.json({ error: "Too many voice replies at once. Try again in a moment." }, { status: 429 });
  }
  try {
    const out = await synthesize({ text: parsed.data.text, agent: parsed.data.agent, signal: req.signal });
    return new Response(out.body, {
      headers: {
        "content-type": out.contentType,
        "cache-control": "no-store",
        "x-voice-agent": out.agent,
      },
    });
  } catch (err) {
    return voiceErrorResponse(err, "tts");
  }
}

function voiceErrorResponse(err: unknown, what: string) {
  if (err instanceof VoiceError) {
    if (err.status >= 500 || err.status === 429) console.error(`[voice] ${what} failed: ${err.status} ${err.detail ?? err.message}`);
    return Response.json({ error: err.message }, { status: err.status === 499 ? 400 : err.status });
  }
  console.error(`[voice] ${what} failed`, err);
  return Response.json({ error: "Voice is unavailable right now." }, { status: 500 });
}
