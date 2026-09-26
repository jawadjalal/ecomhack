import { clientKey, takeToken } from "@/lib/readiness";
import { checkAudio, MAX_AUDIO_BYTES, transcribe, voiceErrorResponse, voiceStatus } from "@/lib/voice/elevenlabs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

/**
 * POST /api/voice/transcribe (multipart: audio ≤ 10 MB, webm/ogg/mp4/wav) → { text } (admin).
 * ElevenLabs Speech-to-Text; the recording and the transcript are never logged.
 */
export async function POST(req: Request) {
  if (!voiceStatus().stt) return Response.json({ error: "Voice isn't set up on this deployment.", code: "not_configured" }, { status: 503 });

  // Refuse obviously oversized bodies before buffering them (multipart adds a little framing).
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_AUDIO_BYTES + 64 * 1024) return Response.json({ error: "That recording is too long (10 MB max).", code: "too_large" }, { status: 413 });

  if (!takeToken("voice-stt", clientKey(req), MAX_PER_WINDOW, WINDOW_MS)) {
    return Response.json({ error: "Too many voice requests. Try again in a minute.", code: "rate_limited" }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send multipart/form-data with the recording as `audio`.", code: "bad_request" }, { status: 400 });
  }
  const audio = form.get("audio");
  const blob = audio instanceof Blob ? audio : null;
  const bad = checkAudio(blob);
  if (bad) return voiceErrorResponse(bad);

  try {
    const { text } = await transcribe(blob!);
    return Response.json({ text }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
