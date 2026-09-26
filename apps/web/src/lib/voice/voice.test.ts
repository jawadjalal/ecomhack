import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanForSpeech,
  DEFAULT_STT_MODEL,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICES,
  MAX_SPEECH_CHARS,
  parseTranscript,
  resetVoiceLimits,
  synthesize,
  takeVoiceToken,
  transcribe,
  voiceAvailable,
  VoiceError,
  voiceFor,
} from "./index";

const KEY = "test-key-not-real";
const env = { ELEVENLABS_API_KEY: KEY };

function audioResponse(bytes = 32) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/mpeg" } });
}
const clip = (size = 4000, type = "audio/webm") => new Blob([new Uint8Array(size)], { type });

describe("voices", () => {
  it("gives the five agents distinct stock voices", () => {
    const ids = Object.values(DEFAULT_VOICES).map((v) => v.voiceId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });
  it("honours ELEVENLABS_VOICE_<NAME> and falls back to Darwin for unknown agents", () => {
    expect(voiceFor("Iris", { ELEVENLABS_VOICE_IRIS: "abcdefghij1234567890" }).voiceId).toBe("abcdefghij1234567890");
    expect(voiceFor("iris", { ELEVENLABS_VOICE_IRIS: "bad id!" }).voiceId).toBe(DEFAULT_VOICES.iris.voiceId);
    expect(voiceFor("mallory", {}).agent).toBe("darwin");
    expect(voiceFor(undefined, {}).voiceId).toBe(DEFAULT_VOICES.darwin.voiceId);
  });
});

describe("cleanForSpeech", () => {
  it("strips markdown, links, code and emoji", () => {
    const out = cleanForSpeech(
      "## Result\n**Conversion** is up _12%_ 🎉\n- See [the dashboard](https://x.test/d)\n- Raw: https://x.test/raw\n```js\nconsole.log(1)\n```\nUse `ship_winner` → done",
    );
    expect(out).not.toMatch(/[*#_`[\]()]|https?:|console\.log|🎉/);
    expect(out).toContain("Conversion is up 12%");
    expect(out).toContain("See the dashboard.");
    expect(out).toContain("the link");
    expect(out).toContain("ship winner to done");
  });
  it("turns lines into sentences", () => {
    expect(cleanForSpeech("First point\nSecond point")).toBe("First point. Second point.");
  });
  it("caps long text at a sentence boundary", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const out = cleanForSpeech(long);
    expect(out.length).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
    expect(out.endsWith(".")).toBe(true);
  });
  it("returns empty for code-only input", () => {
    expect(cleanForSpeech("```\nfoo()\n```")).toBe("");
  });
});

describe("missing key", () => {
  it("reports unavailable and refuses calls with a 503 VoiceError", async () => {
    expect(voiceAvailable({})).toBe(false);
    expect(voiceAvailable({ ELEVENLABS_API_KEY: "  " })).toBe(false);
    expect(voiceAvailable(env)).toBe(true);
    const fetchImpl = vi.fn();
    await expect(synthesize({ text: "hi", env: {}, fetchImpl })).rejects.toMatchObject({ status: 503 });
    await expect(transcribe({ audio: clip(), env: {}, fetchImpl })).rejects.toBeInstanceOf(VoiceError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("synthesize (TTS)", () => {
  it("posts cleaned text to the agent's voice stream endpoint with the key header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => audioResponse(64));
    const out = await synthesize({ text: "**Hello** from [Pixel](https://x.test)", agent: "pixel", env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICES.pixel.voiceId}/stream?output_format=mp3_44100_128`,
    );
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe(KEY);
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ text: "Hello from Pixel.", model_id: DEFAULT_TTS_MODEL });
    expect(body.voice_settings).toMatchObject({ stability: expect.any(Number), similarity_boost: expect.any(Number) });
    expect(out.agent).toBe("pixel");
    expect(out.contentType).toBe("audio/mpeg");
    const bytes = new Uint8Array(await new Response(out.body).arrayBuffer());
    expect(bytes.length).toBe(64);
  });
  it("uses ELEVENLABS_TTS_MODEL when set", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => audioResponse());
    await synthesize({ text: "hi", env: { ...env, ELEVENLABS_TTS_MODEL: "eleven_turbo_v2_5" }, fetchImpl });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).model_id).toBe("eleven_turbo_v2_5");
  });
  it("maps upstream failures to friendly errors without leaking the key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ detail: { status: "invalid_api_key" } }), { status: 401 }));
    const err = (await synthesize({ text: "hi", env, fetchImpl }).catch((e) => e)) as VoiceError;
    expect(err).toBeInstanceOf(VoiceError);
    expect(err.status).toBe(502);
    expect(err.message).not.toContain(KEY);
    const busy = vi.fn(async () => new Response("slow down", { status: 429 }));
    await expect(synthesize({ text: "hi", env, fetchImpl: busy })).rejects.toMatchObject({ status: 429 });
  });
  it("wraps network errors and rejects empty text before calling out", async () => {
    const boom = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(synthesize({ text: "hi", env, fetchImpl: boom })).rejects.toMatchObject({ status: 502 });
    const never = vi.fn();
    await expect(synthesize({ text: "```\ncode\n```", env, fetchImpl: never })).rejects.toMatchObject({ status: 400 });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("transcribe (STT)", () => {
  it("sends multipart { model_id, file } and parses the transcript", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ language_code: "en", language_probability: 0.99, text: " Show me the  winning test (laughs) ", words: [] }),
    );
    const out = await transcribe({ audio: clip(5000, "audio/webm;codecs=opus"), env, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    const form = init?.body as FormData;
    expect(form.get("model_id")).toBe(DEFAULT_STT_MODEL);
    const file = form.get("file") as File;
    expect(file.size).toBe(5000);
    expect(file.name).toBe("speech.webm");
    expect(out).toEqual({ text: "Show me the winning test", languageCode: "en", model: DEFAULT_STT_MODEL });
  });
  it("retries once with scribe_v1 when the model is rejected", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>(async () => Response.json({ text: "hello" }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "invalid model_id" }), { status: 400 }));
    const out = await transcribe({ audio: clip(), env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1][1]?.body as FormData).get("model_id")).toBe("scribe_v1");
    expect(out.text).toBe("hello");
  });
  it("rejects clips that are too small or too big before calling out", async () => {
    const fetchImpl = vi.fn();
    await expect(transcribe({ audio: clip(100), env, fetchImpl })).rejects.toMatchObject({ status: 422 });
    await expect(transcribe({ audio: clip(11 * 1024 * 1024), env, fetchImpl })).rejects.toMatchObject({ status: 413 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("parses multichannel responses and rejects junk", () => {
    expect(parseTranscript({ transcripts: [{ text: "one", language_code: "en" }, { text: "two" }] })).toEqual({ text: "one two", languageCode: "en" });
    expect(() => parseTranscript(null)).toThrow(VoiceError);
    expect(parseTranscript({ text: "[music]" }).text).toBe("");
  });
});

describe("rate limit", () => {
  beforeEach(() => resetVoiceLimits());
  afterEach(() => resetVoiceLimits());
  it("allows max hits per window, then refuses until the window passes", () => {
    const t0 = 1_000_000;
    expect(takeVoiceToken("a", 2, 1000, t0)).toBe(true);
    expect(takeVoiceToken("a", 2, 1000, t0 + 1)).toBe(true);
    expect(takeVoiceToken("a", 2, 1000, t0 + 2)).toBe(false);
    expect(takeVoiceToken("b", 2, 1000, t0 + 2)).toBe(true);
    expect(takeVoiceToken("a", 2, 1000, t0 + 1001)).toBe(true);
  });
});
