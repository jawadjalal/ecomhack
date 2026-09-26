"use client";

/**
 * Voice for the "Ask Darwin" bar: talk to it (ElevenLabs Speech-to-Text via /api/voice/transcribe, or the
 * browser's SpeechRecognition when no key is set) and have replies read aloud (/api/voice/speak, or the
 * browser's speechSynthesis). Hold the mic to talk, or tap to start and tap again to stop.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type VoicePhase = "idle" | "starting" | "recording" | "transcribing";
export type VoiceEngine = "elevenlabs" | "browser" | "none";

const SPEAK_KEY = "darwin.voice.speak";
const MAX_RECORD_MS = 60_000;
/** Holding the mic longer than this means push-to-talk (release sends); shorter is a tap (tap again to send). */
const HOLD_MS = 350;

interface BrowserRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => BrowserRecognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const canRecord = () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function pickMime(): string | undefined {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* older Safari */
    }
  }
  return undefined;
}

/** { stt, tts } from /api/voice/status (false when signed out or unreachable). */
export function useVoiceStatus(): { stt: boolean; tts: boolean; ready: boolean } {
  const [s, setS] = useState({ stt: false, tts: false, ready: false });
  useEffect(() => {
    let live = true;
    type Status = { stt?: boolean; tts?: boolean };
    fetch("/api/voice/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : ({} as Status)))
      .catch((): Status => ({}))
      .then((b) => live && setS({ stt: !!b.stt, tts: !!b.tts, ready: true }));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

export interface Recorder {
  engine: VoiceEngine;
  phase: VoicePhase;
  /** 0..1 input level while recording (ElevenLabs path; the browser path pulses instead). */
  level: number;
  error: string | null;
  clearError: () => void;
  start: () => void;
  stop: () => void;
  cancel: () => void;
}

/**
 * Record a question and hand back its text. ElevenLabs when the server has a key, else the browser's
 * SpeechRecognition, else `engine: "none"` (hide the mic).
 */
export function useRecorder({ stt, ready, onText }: { stt: boolean; ready: boolean; onText: (text: string) => void }): Recorder {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [browserOk, setBrowserOk] = useState(false);
  const [recordOk, setRecordOk] = useState(false);
  const rec = useRef<{ mr?: MediaRecorder; stream?: MediaStream; ctx?: AudioContext; raf?: number; timer?: number; chunks: Blob[]; cancelled: boolean; sr?: BrowserRecognition }>({ chunks: [], cancelled: false });
  const textCb = useRef(onText);
  useEffect(() => {
    textCb.current = onText;
  }, [onText]);

  // Feature detection runs after mount (SSR renders no mic).
  useEffect(() => {
    const t = setTimeout(() => {
      setBrowserOk(!!recognitionCtor());
      setRecordOk(canRecord());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const engine: VoiceEngine = !ready ? "none" : stt && recordOk ? "elevenlabs" : browserOk ? "browser" : "none";

  const teardown = useCallback(() => {
    const r = rec.current;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.timer) clearTimeout(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => undefined);
    r.raf = undefined;
    r.timer = undefined;
    r.stream = undefined;
    r.ctx = undefined;
    r.mr = undefined;
    r.sr = undefined;
    setLevel(0);
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const denied = (name: string) =>
    name === "NotAllowedError" || name === "not-allowed" || name === "SecurityError" || name === "service-not-allowed"
      ? "Microphone blocked. Allow it for this site in your browser's address bar, then tap the mic again."
      : name === "NotFoundError" || name === "audio-capture"
        ? "No microphone found. Plug one in or type your question."
        : null;

  const upload = useCallback(async (blob: Blob) => {
    setPhase("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech");
      const res = await fetch("/api/voice/transcribe", { method: "POST", body: form, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Couldn't transcribe (${res.status}).`);
      const text = (body.text ?? "").trim();
      if (!text) setError("I didn't catch that. Try again, a little closer to the mic.");
      else textCb.current(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }, []);

  const startEleven = useCallback(async () => {
    const r = rec.current;
    r.chunks = [];
    r.cancelled = false;
    setPhase("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setPhase("idle");
      setError(denied((e as DOMException).name) ?? "Couldn't start the microphone.");
      return;
    }
    r.stream = stream;
    const mime = pickMime();
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    r.mr = mr;
    mr.ondataavailable = (e) => {
      if (e.data.size) r.chunks.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(r.chunks, { type: mr.mimeType || mime || "audio/webm" });
      const cancelled = r.cancelled;
      teardown();
      if (cancelled) return setPhase("idle");
      if (blob.size < 1200) {
        setPhase("idle");
        setError("That was too short. Hold the mic while you talk, or tap it, talk, then tap again.");
        return;
      }
      void upload(blob);
    };
    // Live input level for the meter.
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      r.ctx = ctx;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        r.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* no meter: the ring still pulses */
    }
    mr.start(250);
    r.timer = window.setTimeout(() => mr.state === "recording" && mr.stop(), MAX_RECORD_MS);
    setPhase("recording");
  }, [teardown, upload]);

  const startBrowser = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = rec.current;
    r.cancelled = false;
    const sr = new Ctor();
    sr.lang = navigator.language || "en-US";
    sr.interimResults = false;
    sr.continuous = false;
    sr.maxAlternatives = 1;
    let heard = "";
    sr.onresult = (e) => {
      heard = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    sr.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      setError(denied(e.error) ?? "Voice input isn't available right now. Type your question instead.");
    };
    sr.onend = () => {
      const cancelled = r.cancelled;
      teardown();
      setPhase("idle");
      if (!cancelled && heard) textCb.current(heard);
    };
    r.sr = sr;
    try {
      sr.start();
      setPhase("recording");
      r.timer = window.setTimeout(() => sr.stop(), MAX_RECORD_MS);
    } catch {
      setPhase("idle");
      setError("Voice input isn't available right now. Type your question instead.");
    }
  }, [teardown]);

  const start = useCallback(() => {
    if (phase !== "idle") return;
    setError(null);
    if (engine === "elevenlabs") void startEleven();
    else if (engine === "browser") startBrowser();
  }, [engine, phase, startEleven, startBrowser]);

  const stop = useCallback(() => {
    const r = rec.current;
    if (r.mr?.state === "recording") r.mr.stop();
    else if (r.sr) r.sr.stop();
  }, []);

  const cancel = useCallback(() => {
    const r = rec.current;
    r.cancelled = true;
    if (r.mr?.state === "recording") r.mr.stop();
    else if (r.sr) r.sr.abort();
    else teardown();
    setPhase("idle");
  }, [teardown]);

  return { engine, phase, level, error, clearError: () => setError(null), start, stop, cancel };
}

/* ------------------------------------------------------------------ read replies aloud */

/** Strip the reply's markdown so it reads naturally; cut at a sentence within the 800-char limit. */
export function speakable(text: string, max = 800): string {
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

export interface Speaker {
  on: boolean;
  toggle: () => void;
  speaking: boolean;
  say: (text: string) => void;
  hush: () => void;
}

/** "Read replies aloud": remembered in localStorage; ElevenLabs when configured, else speechSynthesis. */
export function useSpeaker(tts: boolean): Speaker {
  const [on, setOn] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setOn(localStorage.getItem(SPEAK_KEY) === "1");
      } catch {
        /* storage blocked */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const hush = useCallback(() => {
    seq.current++;
    const a = audio.current;
    if (a) {
      a.pause();
      if (a.src.startsWith("blob:")) URL.revokeObjectURL(a.src);
      audio.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => () => hush(), [hush]);

  const say = useCallback(
    (raw: string) => {
      const text = speakable(raw);
      if (!text) return;
      hush();
      const my = ++seq.current;
      const browser = () => {
        if (!("speechSynthesis" in window)) return setSpeaking(false);
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => my === seq.current && setSpeaking(false);
        u.onerror = () => my === seq.current && setSpeaking(false);
        window.speechSynthesis.speak(u);
      };
      setSpeaking(true);
      if (!tts) return browser();
      fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const url = URL.createObjectURL(await res.blob());
          if (my !== seq.current) return URL.revokeObjectURL(url);
          const a = new Audio(url);
          audio.current = a;
          a.onended = () => {
            URL.revokeObjectURL(url);
            if (my === seq.current) setSpeaking(false);
          };
          await a.play();
        })
        .catch(() => my === seq.current && browser());
    },
    [tts, hush],
  );

  const toggle = useCallback(() => {
    setOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(SPEAK_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      return next;
    });
    hush();
  }, [hush]);

  return { on, toggle, speaking, say, hush };
}

/* ------------------------------------------------------------------ UI */

/** Round mic button for the ink bar: hold to talk, or tap to start / tap to stop. */
export function MicButton({ rec, size = 44, disabled }: { rec: Recorder; size?: number; disabled?: boolean }) {
  const reduce = useReducedMotion();
  const downAt = useRef<number | null>(null);
  const wasActive = useRef(false);
  const active = rec.phase === "recording" || rec.phase === "starting";
  const busy = rec.phase === "transcribing";

  if (rec.engine === "none") return null;

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled || busy) return;
    e.preventDefault();
    wasActive.current = active;
    downAt.current = Date.now();
    if (!active) rec.start();
  };
  const up = () => {
    const at = downAt.current;
    downAt.current = null;
    if (at === null) return;
    // Held (push-to-talk) → release sends. A tap on an active mic → stop and send.
    if (wasActive.current || Date.now() - at > HOLD_MS) rec.stop();
  };

  // Keyboard: hold Space / Enter to talk (release sends); a short press toggles, like a tap.
  const keyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((e.key !== " " && e.key !== "Enter") || e.repeat) return;
    e.preventDefault();
    if (disabled || busy) return;
    wasActive.current = active;
    downAt.current = Date.now();
    if (!active) rec.start();
  };
  const keyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    up();
  };

  const scale = 1 + (reduce ? 0 : rec.level * 0.55);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {active && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-[#F7F1E5]"
          initial={{ opacity: 0.7, scale: 1 }}
          animate={reduce ? { opacity: 0.6 } : rec.engine === "elevenlabs" ? { scale, opacity: 0.35 + rec.level * 0.5 } : { scale: [1, 1.35, 1], opacity: [0.7, 0.15, 0.7] }}
          transition={rec.engine === "elevenlabs" ? { duration: 0.08 } : { duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          data-voice-ring
        />
      )}
      <button
        type="button"
        aria-label={active ? "Stop and send" : busy ? "Transcribing" : "Talk to Darwin (hold, or tap to start and stop)"}
        title={active ? "Release or tap to send" : "Hold to talk, or tap to start"}
        aria-pressed={active}
        disabled={disabled || busy}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => active && rec.cancel()}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
        className="relative grid size-full touch-none place-items-center rounded-full transition-colors select-none disabled:opacity-60"
        style={{ background: active ? "#F7F1E5" : "rgba(247,241,229,0.12)", color: active ? "#141413" : "#F7F1E5" }}
        data-voice-mic={rec.phase}
      >
        {active ? <Square className="size-[15px]" fill="currentColor" strokeWidth={0} /> : busy ? <Dots /> : <Mic className="size-[19px]" strokeWidth={2} />}
      </button>
    </span>
  );
}

function Dots() {
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {[0, 1, 2].map((k) => (
        <motion.span key={k} className="size-[5px] rounded-full bg-current" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 0.9, repeat: Infinity, delay: k * 0.15 }} />
      ))}
    </span>
  );
}

/** Live level bars shown in the input while recording. */
export function LevelMeter({ level, engine }: { level: number; engine: VoiceEngine }) {
  const reduce = useReducedMotion();
  const weights = [0.55, 0.85, 1, 0.8, 0.6, 0.9, 0.7];
  return (
    <span className="flex h-6 items-center gap-[3px]" aria-hidden>
      {weights.map((w, i) =>
        engine === "elevenlabs" || reduce ? (
          <span key={i} className="w-[3px] rounded-full bg-[#F7F1E5] transition-[height] duration-75" style={{ height: `${Math.max(4, Math.round(4 + level * w * 20))}px` }} />
        ) : (
          <motion.span
            key={i}
            className="w-[3px] rounded-full bg-[#F7F1E5]"
            animate={{ height: [4, 6 + w * 14, 4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.09, ease: "easeInOut" }}
          />
        ),
      )}
    </span>
  );
}

/**
 * "Read replies aloud": toggles the remembered setting. While a reply is playing it turns green with moving
 * bars, and a tap stops the playback (the setting stays on). `compact` is the round version for the ink bar.
 */
export function SpeakerToggle({ speaker, compact }: { speaker: Speaker; compact?: boolean }) {
  const reduce = useReducedMotion();
  const speaking = speaker.speaking;
  const label = speaking ? "Stop reading this reply" : speaker.on ? "Stop reading replies aloud" : "Read replies aloud";
  const bg = speaking ? "#1FB57A" : speaker.on ? "#141413" : compact ? "rgba(247,241,229,0.12)" : "#F3EDE0";
  const fg = speaking || speaker.on || compact ? "#F7F1E5" : "#141413";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={speaker.on}
      onClick={speaking ? speaker.hush : speaker.toggle}
      className={cn("flex shrink-0 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors duration-200", compact ? "size-11" : "h-9 min-w-9 px-2.5")}
      style={{ background: bg, color: fg }}
      data-voice-speaker={speaking ? "speaking" : speaker.on ? "on" : "off"}
    >
      {speaking ? (
        <span className="flex h-4 items-center gap-[2px]" aria-hidden>
          {[0.6, 1, 0.75, 0.9].map((w, i) =>
            reduce ? (
              <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: 6 + w * 8 }} />
            ) : (
              <motion.span key={i} className="w-[3px] rounded-full bg-current" animate={{ height: [4, 6 + w * 10, 4] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }} />
            ),
          )}
        </span>
      ) : speaker.on ? (
        <Volume2 className="size-[15px]" />
      ) : (
        <VolumeX className="size-[15px]" />
      )}
      {!compact && <span className="hidden lg:inline">{speaking ? "Speaking" : speaker.on ? "Reading aloud" : "Read aloud"}</span>}
    </button>
  );
}
