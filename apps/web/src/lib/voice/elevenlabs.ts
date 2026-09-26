/**
 * Voice for "Ask Darwin": ElevenLabs Speech-to-Text (the merchant talks to the prompt bar) and
 * Text-to-Speech (Darwin reads its replies aloud).
 *
 * - Keys: ELEVENLABS_API_KEY (required), ELEVENLABS_MODEL (optional; a "scribe*" id is the STT model,
 *   anything else is the TTS model), ELEVENLABS_VOICE_ID (optional TTS voice).
 * - No key → `voiceStatus()` says so and the client falls back to the browser's own speech APIs.
 * - `fetch` is injectable for tests. Nothing here logs audio or text content.
 */

export const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
export const DEFAULT_STT_MODEL = "scribe_v1";
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";
/** "Rachel", ElevenLabs' default premade voice. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_SPEAK_CHARS = 800;
/** Recordings we accept (MediaRecorder gives webm/ogg in Chromium and Firefox, mp4 in Safari). */
export const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/wave", "video/webm"] as const;

const UPSTREAM_TIMEOUT_MS = 30_000;

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export interface VoiceOptions {
  fetch?: Fetch;
  env?: Env;
}

export type VoiceErrorCode = "not_configured" | "bad_request" | "empty" | "too_large" | "unsupported_type" | "too_long" | "upstream_auth" | "upstream_busy" | "upstream";

/** A voice failure with the HTTP status the route should answer with and a merchant-readable message. */
export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

const key = (env: Env) => env.ELEVENLABS_API_KEY?.trim() || undefined;

/** What the voice routes can do on this deployment (the client hides or falls back accordingly). */
export function voiceStatus(env: Env = process.env): { stt: boolean; tts: boolean } {
  const on = !!key(env);
  return { stt: on, tts: on };
}

/** The STT model: ELEVENLABS_MODEL when it's a Scribe model, else scribe_v1. */
export function sttModel(env: Env = process.env): string {
  const m = env.ELEVENLABS_MODEL?.trim();
  return m && m.toLowerCase().startsWith("scribe") ? m : DEFAULT_STT_MODEL;
}

/** The TTS model: ELEVENLABS_MODEL unless it's a Scribe (STT) model, else eleven_flash_v2_5. */
export function ttsModel(env: Env = process.env): string {
  const m = env.ELEVENLABS_MODEL?.trim();
  return m && !m.toLowerCase().startsWith("scribe") ? m : DEFAULT_TTS_MODEL;
}

export function voiceId(env: Env = process.env): string {
  const v = env.ELEVENLABS_VOICE_ID?.trim();
  return v && /^[A-Za-z0-9]{8,64}$/.test(v) ? v : DEFAULT_VOICE_ID;
}

/** The base MIME type ("audio/webm;codecs=opus" → "audio/webm"). */
export const baseType = (type: string) => type.split(";")[0].trim().toLowerCase();

/** Validate a recording before it leaves the server. Returns the error, or null when it's fine. */
export function checkAudio(audio: { size: number; type: string } | null | undefined): VoiceError | null {
  if (!audio) return new VoiceError("bad_request", 400, "Send the recording as the multipart field `audio`.");
  if (audio.size === 0) return new VoiceError("empty", 400, "The recording was empty. Hold the mic a little longer.");
  if (audio.size > MAX_AUDIO_BYTES) return new VoiceError("too_large", 413, "That recording is too long (10 MB max). Try a shorter question.");
  if (!(AUDIO_TYPES as readonly string[]).includes(baseType(audio.type))) {
    return new VoiceError("unsupported_type", 415, "Send webm, ogg, mp4 or wav audio.");
  }
  return null;
}

/** Validate text to read aloud: a non-empty string of at most MAX_SPEAK_CHARS. */
export function checkSpeakText(text: unknown): VoiceError | null {
  if (typeof text !== "string" || !text.trim()) return new VoiceError("bad_request", 400, "Send { text } to read aloud.");
  if (text.length > MAX_SPEAK_CHARS) return new VoiceError("too_long", 413, `Text to read aloud is limited to ${MAX_SPEAK_CHARS} characters.`);
  return null;
}

/** Map an ElevenLabs HTTP failure to our error (never echoing the upstream body, which can quote input). */
function upstreamError(status: number, what: "transcribe" | "speak"): VoiceError {
  if (status === 401 || status === 403) return new VoiceError("upstream_auth", 502, "The voice service rejected the key. Check ELEVENLABS_API_KEY.");
  if (status === 429) return new VoiceError("upstream_busy", 429, "The voice service is busy. Try again in a moment.");
  if (status === 400 || status === 422) {
    return new VoiceError("bad_request", 400, what === "transcribe" ? "Couldn't read that recording. Try again." : "Couldn't read that text aloud.");
  }
  return new VoiceError("upstream", 502, what === "transcribe" ? "Couldn't transcribe that just now. Try again." : "Couldn't read that aloud just now.");
}

async function call(f: Fetch, url: string, init: RequestInit, what: "transcribe" | "speak"): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new VoiceError("upstream", 502, "Couldn't reach the voice service. Try again.");
  }
  if (!res.ok) throw upstreamError(res.status, what);
  return res;
}

function requireKey(env: Env): string {
  const k = key(env);
  if (!k) throw new VoiceError("not_configured", 503, "Voice isn't set up on this deployment (ELEVENLABS_API_KEY).");
  return k;
}

const extFor = (type: string) => ({ "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" })[baseType(type)] ?? "webm";

/** Speech → text with ElevenLabs Scribe. */
export async function transcribe(audio: Blob, opts: VoiceOptions = {}): Promise<{ text: string }> {
  const env = opts.env ?? process.env;
  const apiKey = requireKey(env);
  const bad = checkAudio(audio);
  if (bad) throw bad;

  const form = new FormData();
  form.append("file", audio, `speech.${extFor(audio.type)}`);
  form.append("model_id", sttModel(env));
  // Plain words only: no "(background noise)" tags in what we send to the assistant.
  form.append("tag_audio_events", "false");

  const res = await call(opts.fetch ?? fetch, `${ELEVENLABS_API}/speech-to-text`, { method: "POST", headers: { "xi-api-key": apiKey }, body: form }, "transcribe");
  const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!body || typeof body.text !== "string") throw new VoiceError("upstream", 502, "The voice service answered without a transcript.");
  return { text: body.text.trim().slice(0, 2000) };
}

/** Text → speech (MP3) with ElevenLabs TTS. Returns the audio stream to pass straight through. */
export async function speak(text: string, opts: VoiceOptions = {}): Promise<{ audio: ReadableStream<Uint8Array>; contentType: string }> {
  const env = opts.env ?? process.env;
  const apiKey = requireKey(env);
  const bad = checkSpeakText(text);
  if (bad) throw bad;

  const res = await call(
    opts.fetch ?? fetch,
    `${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(voiceId(env))}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: text.trim(), model_id: ttsModel(env) }),
    },
    "speak",
  );
  if (!res.body) throw new VoiceError("upstream", 502, "The voice service answered without audio.");
  return { audio: res.body, contentType: res.headers.get("content-type")?.startsWith("audio/") ? res.headers.get("content-type")! : "audio/mpeg" };
}

/** A route's JSON answer for any error (VoiceError keeps its status; anything else is a generic 500). */
export function voiceErrorResponse(err: unknown): Response {
  if (err instanceof VoiceError) return Response.json({ error: err.message, code: err.code }, { status: err.status, headers: { "cache-control": "no-store" } });
  return Response.json({ error: "Voice failed unexpectedly." }, { status: 500, headers: { "cache-control": "no-store" } });
}
