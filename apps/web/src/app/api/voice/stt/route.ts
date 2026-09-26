import { MAX_AUDIO_BYTES, takeVoiceToken, transcribe, voiceAvailable, voiceClient, VoiceError } from "@/lib/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW_MS = 60_000;
const PER_CLIENT = 20;
const GLOBAL = 100;
const AUDIO_TYPE = /^(audio|video)\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|x-m4a|m4a)\b/i;

/**
 * POST /api/voice/stt  multipart { audio: Blob (webm/ogg/mp4 from MediaRecorder), language? } → { text, language? }
 * Admin, rate-limited, 10 MB max.
 */
export async function POST(req: Request) {
  if (!voiceAvailable()) return Response.json({ error: "Voice isn't set up on this server yet." }, { status: 503 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) return Response.json({ error: "That recording is too long. Try a shorter message." }, { status: 413 });
  if (!takeVoiceToken(`stt:${voiceClient(req)}`, PER_CLIENT, WINDOW_MS) || !takeVoiceToken("stt:*", GLOBAL, WINDOW_MS)) {
    return Response.json({ error: "Too many voice messages at once. Try again in a moment." }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("audio") ?? form?.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "Send the recording as multipart field 'audio'." }, { status: 400 });
  if (file.type && !AUDIO_TYPE.test(file.type)) return Response.json({ error: "That doesn't look like an audio recording." }, { status: 415 });
  const lang = form?.get("language");
  const languageCode = typeof lang === "string" && /^[a-z]{2,3}$/i.test(lang) ? lang.toLowerCase() : undefined;

  try {
    const out = await transcribe({ audio: file, filename: file.name || undefined, languageCode, signal: req.signal });
    return Response.json({ text: out.text, language: out.languageCode }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof VoiceError) {
      if (err.status >= 500 || err.status === 429) console.error(`[voice] stt failed: ${err.status} ${err.detail ?? err.message}`);
      return Response.json({ error: err.message }, { status: err.status === 499 ? 400 : err.status });
    }
    console.error("[voice] stt failed", err);
    return Response.json({ error: "Voice is unavailable right now." }, { status: 500 });
  }
}
