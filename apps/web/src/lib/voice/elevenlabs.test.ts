import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkAudio,
  checkSpeakText,
  DEFAULT_STT_MODEL,
  DEFAULT_TTS_MODEL,
  DEFAULT_VOICE_ID,
  MAX_AUDIO_BYTES,
  MAX_SPEAK_CHARS,
  speak,
  sttModel,
  transcribe,
  ttsModel,
  VoiceError,
  voiceStatus,
} from "./elevenlabs";
import { POST as transcribeRoute } from "@/app/api/voice/transcribe/route";
import { POST as speakRoute } from "@/app/api/voice/speak/route";
import { GET as statusRoute } from "@/app/api/voice/status/route";

const ENV = { ELEVENLABS_API_KEY: "xi-test-key" };
const webm = (bytes = 32) => new Blob([new Uint8Array(bytes)], { type: "audio/webm;codecs=opus" });

function mockFetch(res: Response | (() => Response)) {
  return vi.fn(async (...args: [string | URL | Request, RequestInit?]) => (args.length && typeof res === "function" ? res() : (res as Response))) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("config", () => {
  it("is not configured without a key", async () => {
    expect(voiceStatus({})).toEqual({ stt: false, tts: false });
    expect(voiceStatus({ ELEVENLABS_API_KEY: "  " })).toEqual({ stt: false, tts: false });
    const f = mockFetch(Response.json({ text: "hi" }));
    await expect(transcribe(webm(), { env: {}, fetch: f })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    await expect(speak("hello", { env: {}, fetch: f })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    expect(f).not.toHaveBeenCalled();
  });

  it("is configured with a key", () => {
    expect(voiceStatus(ENV)).toEqual({ stt: true, tts: true });
  });

  it("splits ELEVENLABS_MODEL between speech-to-text and text-to-speech", () => {
    expect(sttModel({})).toBe(DEFAULT_STT_MODEL);
    expect(ttsModel({})).toBe(DEFAULT_TTS_MODEL);
    expect(sttModel({ ELEVENLABS_MODEL: "scribe_v1_experimental" })).toBe("scribe_v1_experimental");
    expect(ttsModel({ ELEVENLABS_MODEL: "scribe_v1_experimental" })).toBe(DEFAULT_TTS_MODEL);
    expect(sttModel({ ELEVENLABS_MODEL: "eleven_multilingual_v2" })).toBe(DEFAULT_STT_MODEL);
    expect(ttsModel({ ELEVENLABS_MODEL: "eleven_multilingual_v2" })).toBe("eleven_multilingual_v2");
  });
});

describe("transcribe", () => {
  it("posts the file and model to Speech-to-Text with the key header", async () => {
    const f = mockFetch(Response.json({ text: "  run the loop  ", language_code: "en" }));
    const out = await transcribe(webm(), { env: ENV, fetch: f });
    expect(out).toEqual({ text: "run the loop" });

    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("xi-test-key");
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model_id")).toBe("scribe_v1");
    const file = form.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.size).toBe(32);
    expect(file.name).toBe("speech.webm");
  });

  it("uses a Scribe ELEVENLABS_MODEL", async () => {
    const f = mockFetch(Response.json({ text: "ok" }));
    await transcribe(webm(), { env: { ...ENV, ELEVENLABS_MODEL: "scribe_v2" }, fetch: f });
    expect(((f.mock.calls[0] as [string, RequestInit])[1].body as FormData).get("model_id")).toBe("scribe_v2");
  });

  it("maps upstream failures without echoing the upstream body", async () => {
    const cases: [number, string, number][] = [
      [401, "upstream_auth", 502],
      [403, "upstream_auth", 502],
      [429, "upstream_busy", 429],
      [422, "bad_request", 400],
      [500, "upstream", 502],
    ];
    for (const [status, code, ours] of cases) {
      const f = mockFetch(() => new Response("secret transcript echo", { status }));
      const err = (await transcribe(webm(), { env: ENV, fetch: f }).catch((e) => e)) as VoiceError;
      expect(err).toBeInstanceOf(VoiceError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(ours);
      expect(err.message).not.toContain("secret");
    }
  });

  it("maps network errors and bad bodies", async () => {
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(transcribe(webm(), { env: ENV, fetch: boom })).rejects.toMatchObject({ code: "upstream", status: 502 });
    await expect(transcribe(webm(), { env: ENV, fetch: mockFetch(Response.json({ nope: 1 })) })).rejects.toMatchObject({ code: "upstream" });
  });

  it("refuses bad audio before calling out", async () => {
    const f = mockFetch(Response.json({ text: "x" }));
    await expect(transcribe(new Blob([], { type: "audio/webm" }), { env: ENV, fetch: f })).rejects.toMatchObject({ code: "empty", status: 400 });
    await expect(transcribe(new Blob([new Uint8Array(4)], { type: "text/plain" }), { env: ENV, fetch: f })).rejects.toMatchObject({ code: "unsupported_type", status: 415 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("speak", () => {
  it("posts text and model to Text-to-Speech for the configured voice", async () => {
    const f = mockFetch(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const out = await speak("Conversion is up 4%.", { env: ENV, fetch: f });
    expect(out.contentType).toBe("audio/mpeg");
    expect(new Uint8Array(await new Response(out.audio).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}`);
    const headers = init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("xi-test-key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.accept).toBe("audio/mpeg");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Conversion is up 4%.", model_id: "eleven_flash_v2_5" });
  });

  it("uses ELEVENLABS_VOICE_ID and a non-Scribe ELEVENLABS_MODEL", async () => {
    const f = mockFetch(new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg" } }));
    await speak("hi", { env: { ...ENV, ELEVENLABS_VOICE_ID: "abcDEF123456", ELEVENLABS_MODEL: "eleven_turbo_v2_5" }, fetch: f });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith("/text-to-speech/abcDEF123456")).toBe(true);
    expect(JSON.parse(init.body as string).model_id).toBe("eleven_turbo_v2_5");
  });

  it("maps upstream failures", async () => {
    await expect(speak("hi", { env: ENV, fetch: mockFetch(new Response("x", { status: 401 })) })).rejects.toMatchObject({ code: "upstream_auth", status: 502 });
    await expect(speak("hi", { env: ENV, fetch: mockFetch(new Response("x", { status: 429 })) })).rejects.toMatchObject({ code: "upstream_busy", status: 429 });
    await expect(speak("hi", { env: ENV, fetch: mockFetch(new Response("x", { status: 503 })) })).rejects.toMatchObject({ code: "upstream", status: 502 });
  });

  it("refuses empty or long text before calling out", async () => {
    const f = mockFetch(new Response(new Uint8Array([1])));
    await expect(speak(" ", { env: ENV, fetch: f })).rejects.toMatchObject({ code: "bad_request" });
    await expect(speak("a".repeat(MAX_SPEAK_CHARS + 1), { env: ENV, fetch: f })).rejects.toMatchObject({ code: "too_long", status: 413 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("checks audio size, emptiness and type", () => {
    expect(checkAudio(null)?.status).toBe(400);
    expect(checkAudio({ size: 0, type: "audio/webm" })?.code).toBe("empty");
    expect(checkAudio({ size: MAX_AUDIO_BYTES + 1, type: "audio/webm" })?.code).toBe("too_large");
    expect(checkAudio({ size: 10, type: "audio/mpeg" })?.code).toBe("unsupported_type");
    for (const type of ["audio/webm;codecs=opus", "audio/ogg", "audio/mp4", "audio/wav"]) expect(checkAudio({ size: 10, type })).toBeNull();
  });

  it("checks text to read aloud", () => {
    expect(checkSpeakText(undefined)?.code).toBe("bad_request");
    expect(checkSpeakText(42)?.code).toBe("bad_request");
    expect(checkSpeakText("a".repeat(MAX_SPEAK_CHARS))).toBeNull();
    expect(checkSpeakText("a".repeat(MAX_SPEAK_CHARS + 1))?.code).toBe("too_long");
  });
});

/* ------------------------------------------------------------------ routes */

const multipart = (blob: Blob | string | null, ip: string) => {
  const form = new FormData();
  if (blob !== null) form.append("audio", blob);
  return new Request("http://localhost/api/voice/transcribe", { method: "POST", body: form, headers: { "x-forwarded-for": ip } });
};

describe("voice routes", () => {
  it("status reports whether the key is set", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(await statusRoute().json()).toEqual({ stt: false, tts: false });
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    expect(await statusRoute().json()).toEqual({ stt: true, tts: true });
  });

  it("answer 503 without a key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect((await transcribeRoute(multipart(webm(), "10.0.0.1"))).status).toBe(503);
    expect((await speakRoute(new Request("http://localhost/api/voice/speak", { method: "POST", body: JSON.stringify({ text: "hi" }) }))).status).toBe(503);
  });

  it("transcribe validates the upload", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    const upstream = mockFetch(Response.json({ text: "hello" }));
    vi.stubGlobal("fetch", upstream);

    expect((await transcribeRoute(multipart(null, "10.0.1.1"))).status).toBe(400);
    expect((await transcribeRoute(multipart("not a file", "10.0.1.2"))).status).toBe(400);
    expect((await transcribeRoute(multipart(new Blob([], { type: "audio/webm" }), "10.0.1.3"))).status).toBe(400);
    expect((await transcribeRoute(multipart(new Blob([new Uint8Array(8)], { type: "image/png" }), "10.0.1.4"))).status).toBe(415);
    const big = new Request("http://localhost/api/voice/transcribe", { method: "POST", body: "x", headers: { "content-length": String(MAX_AUDIO_BYTES * 2), "x-forwarded-for": "10.0.1.5" } });
    expect((await transcribeRoute(big)).status).toBe(413);
    expect((await transcribeRoute(multipart(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "audio/webm" }), "10.0.1.6"))).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();

    const ok = await transcribeRoute(multipart(webm(), "10.0.1.7"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ text: "hello" });
  });

  it("speak validates the text and streams audio", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    vi.stubGlobal("fetch", mockFetch(() => new Response(new Uint8Array([9, 9]), { headers: { "content-type": "audio/mpeg" } })));
    const post = (body: unknown) =>
      speakRoute(new Request("http://localhost/api/voice/speak", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "10.0.2.1" } }));

    expect((await post({})).status).toBe(400);
    expect((await post({ text: "" })).status).toBe(400);
    expect((await post({ text: "a".repeat(MAX_SPEAK_CHARS + 1) })).status).toBe(413);
    const ok = await post({ text: "Your conversion is up." });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it("rate-limits transcription per client", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "k");
    vi.stubGlobal("fetch", mockFetch(() => Response.json({ text: "hi" })));
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await transcribeRoute(multipart(webm(), "10.9.9.9"))).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
