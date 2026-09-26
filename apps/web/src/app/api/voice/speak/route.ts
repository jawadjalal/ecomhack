import { clientKey, takeToken } from "@/lib/readiness";
import { checkSpeakText, speak, voiceErrorResponse, voiceStatus } from "@/lib/voice/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

/**
 * POST /api/voice/speak { text ≤ 800 chars } → audio/mpeg (admin).
 * ElevenLabs Text-to-Speech for "Read replies aloud"; the text is never logged.
 */
export async function POST(req: Request) {
  if (!voiceStatus().tts) return Response.json({ error: "Voice isn't set up on this deployment.", code: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const bad = checkSpeakText(body?.text);
  if (bad) return voiceErrorResponse(bad);

  if (!takeToken("voice-tts", clientKey(req), MAX_PER_WINDOW, WINDOW_MS)) {
    return Response.json({ error: "Too many voice requests. Try again in a minute.", code: "rate_limited" }, { status: 429 });
  }

  try {
    const { audio, contentType } = await speak(body!.text as string);
    return new Response(audio, { headers: { "content-type": contentType, "cache-control": "no-store" } });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
