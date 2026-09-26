/**
 * Minimal ElevenLabs REST client (server-side only: the key never leaves the server).
 *
 * TTS: POST /v1/text-to-speech/{voice_id}/stream  { text, model_id, voice_settings }  → audio/mpeg (chunked)
 * STT: POST /v1/speech-to-text  multipart { file, model_id }                          → { text, language_code, words }
 * Auth header: xi-api-key.
 */
import { cleanForSpeech } from "./clean";
import { voiceFor } from "./voices";

export const ELEVENLABS_BASE = "https://api.elevenlabs.io";
/** Lowest-latency multilingual TTS model (~75 ms). Override with ELEVENLABS_TTS_MODEL. */
export const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";
/** Batch transcription model. Override with ELEVENLABS_STT_MODEL; falls back to scribe_v1 if rejected. */
export const DEFAULT_STT_MODEL = "scribe_v2";
export const FALLBACK_STT_MODEL = "scribe_v1";
export const TTS_OUTPUT_FORMAT = "mp3_44100_128";

/** Largest upload we forward to speech-to-text (a minute of Opus is ~0.5 MB). */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** Below this, the recording is silence or a click. */
export const MIN_AUDIO_BYTES = 800;

const TTS_HEADERS_TIMEOUT_MS = 15_000;
const STT_TIMEOUT_MS = 45_000;

/** An error with an HTTP status to return and a message safe to show a merchant. */
export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Upstream detail for server logs (never contains the key). */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export function elevenLabsKey(env: Env = process.env): string | undefined {
  return env.ELEVENLABS_API_KEY?.trim() || undefined;
}

export function voiceAvailable(env: Env = process.env): boolean {
  return Boolean(elevenLabsKey(env));
}

function requireKey(env: Env): string {
  const key = elevenLabsKey(env);
  if (!key) throw new VoiceError("Voice isn't set up on this server yet.", 503);
  return key;
}

/**
 * Abort after `ms`, or whenever `parent` aborts. `done()` only clears the timer, so a client that
 * disconnects mid-stream still cancels the upstream request.
 */
function deadline(ms: number, parent?: AbortSignal | null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new VoiceError("Voice service timed out.", 504)), ms);
  const onParent = () => ctrl.abort(parent?.reason);
  if (parent?.aborted) ctrl.abort(parent.reason);
  else parent?.addEventListener("abort", onParent, { once: true });
  return {
    signal: ctrl.signal,
    done: () => clearTimeout(timer),
  };
}

async function upstreamError(res: Response): Promise<VoiceError> {
  const body = (await res.text().catch(() => "")).slice(0, 500);
  const status = res.status;
  if (status === 401) return new VoiceError("The voice service rejected our credentials.", 502, `${status} ${body}`);
  if (status === 403) return new VoiceError("The voice service refused the request.", 502, `${status} ${body}`);
  if (status === 429) return new VoiceError("The voice service is busy. Try again in a moment.", 429, body);
  if (status === 400 || status === 422) return new VoiceError("The voice service couldn't handle that request.", 400, `${status} ${body}`);
  return new VoiceError("The voice service is unavailable right now.", 502, `${status} ${body}`);
}

function wrapFetchError(err: unknown): VoiceError {
  if (err instanceof VoiceError) return err;
  if (err instanceof Error && err.name === "AbortError") return new VoiceError("Voice request was cancelled.", 499);
  return new VoiceError("Couldn't reach the voice service.", 502, err instanceof Error ? err.message : String(err));
}

export interface SynthesizeInput {
  text: string;
  agent?: string;
  signal?: AbortSignal | null;
  env?: Env;
  fetchImpl?: FetchLike;
}

export interface SynthesizeResult {
  /** audio/mpeg stream straight from ElevenLabs. */
  body: ReadableStream<Uint8Array>;
  contentType: string;
  voiceId: string;
  agent: string;
  /** The text actually spoken (cleaned + capped). */
  spoken: string;
}

/** Text-to-speech with the agent's voice. Streams audio as it's generated. */
export async function synthesize({ text, agent, signal, env = process.env, fetchImpl = fetch }: SynthesizeInput): Promise<SynthesizeResult> {
  const key = requireKey(env);
  const spoken = cleanForSpeech(text);
  if (!spoken) throw new VoiceError("Nothing to say.", 400);
  const voice = voiceFor(agent, env);
  const model = env.ELEVENLABS_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const url = `${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/stream?output_format=${TTS_OUTPUT_FORMAT}`;

  // The timer covers connection + first byte only; once audio starts it streams at its own pace.
  const d = deadline(TTS_HEADERS_TIMEOUT_MS, signal);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text: spoken,
        model_id: model,
        voice_settings: {
          stability: voice.stability,
          similarity_boost: voice.similarityBoost,
          style: voice.style,
          use_speaker_boost: true,
        },
      }),
      signal: d.signal,
    });
  } catch (err) {
    d.done();
    throw wrapFetchError(err);
  }
  d.done();
  if (!res.ok || !res.body) throw await upstreamError(res);
  return { body: res.body, contentType: res.headers.get("content-type") || "audio/mpeg", voiceId: voice.voiceId, agent: voice.agent, spoken };
}

export interface TranscribeInput {
  audio: Blob;
  filename?: string;
  /** ISO-639 hint (e.g. "en"); omit to auto-detect. */
  languageCode?: string;
  signal?: AbortSignal | null;
  env?: Env;
  fetchImpl?: FetchLike;
}

export interface TranscribeResult {
  text: string;
  languageCode?: string;
  model: string;
}

/** Speech-to-text for one recorded clip. */
export async function transcribe({ audio, filename, languageCode, signal, env = process.env, fetchImpl = fetch }: TranscribeInput): Promise<TranscribeResult> {
  const key = requireKey(env);
  if (audio.size > MAX_AUDIO_BYTES) throw new VoiceError("That recording is too long. Try a shorter message.", 413);
  if (audio.size < MIN_AUDIO_BYTES) throw new VoiceError("I didn't catch that.", 422);
  const configured = env.ELEVENLABS_STT_MODEL?.trim() || DEFAULT_STT_MODEL;

  const attempt = async (model: string): Promise<Response> => {
    const form = new FormData();
    form.append("model_id", model);
    form.append("file", audio, filename || fileNameFor(audio.type));
    form.append("tag_audio_events", "false");
    if (languageCode) form.append("language_code", languageCode);
    const d = deadline(STT_TIMEOUT_MS, signal);
    try {
      return await fetchImpl(`${ELEVENLABS_BASE}/v1/speech-to-text`, {
        method: "POST",
        headers: { "xi-api-key": key, accept: "application/json" },
        body: form,
        signal: d.signal,
      });
    } catch (err) {
      throw wrapFetchError(err);
    } finally {
      d.done();
    }
  };

  let model = configured;
  let res = await attempt(model);
  // A newer model id the account can't use yet: retry once with the long-standing one.
  if ((res.status === 400 || res.status === 422) && model !== FALLBACK_STT_MODEL) {
    const body = await res.clone().text().catch(() => "");
    if (/model/i.test(body)) {
      model = FALLBACK_STT_MODEL;
      res = await attempt(model);
    }
  }
  if (!res.ok) throw await upstreamError(res);
  const json = (await res.json().catch(() => null)) as unknown;
  return { ...parseTranscript(json), model };
}

/** Pull the transcript out of an ElevenLabs STT response (single- or multi-channel). */
export function parseTranscript(json: unknown): { text: string; languageCode?: string } {
  if (!json || typeof json !== "object") throw new VoiceError("The voice service sent an unexpected reply.", 502);
  const o = json as { text?: unknown; language_code?: unknown; transcripts?: unknown };
  let text = typeof o.text === "string" ? o.text : "";
  let lang = typeof o.language_code === "string" ? o.language_code : undefined;
  if (!text && Array.isArray(o.transcripts)) {
    const parts = o.transcripts as { text?: unknown; language_code?: unknown }[];
    text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ");
    lang ??= parts.find((p) => typeof p?.language_code === "string")?.language_code as string | undefined;
  }
  // Drop audio-event tags like "(laughter)" / "[music]" and tidy whitespace.
  text = text.replace(/[([][^)\]]{1,40}[)\]]/g, " ").replace(/\s+/g, " ").trim();
  return { text, languageCode: lang };
}

export function fileNameFor(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg")) return "speech.ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "speech.mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "speech.mp3";
  if (m.includes("wav")) return "speech.wav";
  return "speech.webm";
}
