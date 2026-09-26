"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseVoiceOptions, VoiceAgentId, VoiceApi, VoiceState } from "./types";

/* ---------- availability (checked once per page load) ---------- */

let serverCheck: Promise<boolean> | null = null;
function serverAvailable(): Promise<boolean> {
  serverCheck ??= fetch("/api/voice", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { available: false }))
    .then((j: { available?: boolean }) => Boolean(j?.available))
    .catch(() => {
      serverCheck = null; // retry on the next mount
      return false;
    });
  return serverCheck;
}

function browserCanRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) !== "undefined"
  );
}

const MIME_PREFS = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/mp4;codecs=mp4a.40.2"];
function pickMime(): string | undefined {
  return MIME_PREFS.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

/* ---------- friendly copy (no technical text in the UI) ---------- */

const MSG = {
  noServer: "Voice isn't switched on for this workspace yet.",
  noBrowser: "Voice isn't supported in this browser. Try Chrome, Edge or Safari.",
  denied: "Microphone access is blocked. Allow it in your browser's site settings, then tap the mic again.",
  noMic: "No microphone found. Plug one in and try again.",
  micBusy: "Your microphone is busy in another app.",
  notHeard: "I didn't catch that. Tap the mic and try again.",
  sttFailed: "Sorry, I couldn't make that out. Try again?",
  busy: "Voice is busy right now. Give it a moment.",
  playFailed: "Couldn't play the reply out loud, but it's in the chat.",
} as const;

/* ---------- tuning ---------- */

const SPEECH_LEVEL = 0.12; // normalized level that counts as talking
const SPEECH_MIN_MS = 180; // must talk this long before silence can end the turn
const NO_SPEECH_TIMEOUT_MS = 8000;
const MAX_TURN_MS = 60_000;

/** 20 ms of silence: played inside a tap so iOS lets the same element play replies later. */
const SILENT_WAV = `data:audio/wav;base64,UklGRmYBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUIB${"A".repeat(432)}`;

type AudioCtor = typeof AudioContext;

interface QueueItem {
  text: string;
  agent: VoiceAgentId;
  audio: Promise<Blob | null>;
  ctrl: AbortController;
  resolve: () => void;
}

/** RMS of the analyser's time-domain data, mapped to a 0..1 level that feels right for a UI ring. */
function readLevel(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  return Math.min(1, Math.max(0, (rms - 0.008) * 6));
}

/**
 * Voice mode for a chat panel: record → transcribe (ElevenLabs) → `onTranscript(text)`; `speak(text, agent)`
 * queues TTS in each agent's voice. See ./index.ts for wiring.
 */
export function useVoice(options: UseVoiceOptions = {}): VoiceApi {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [unavailableReason, setReason] = useState<string>();
  const [state, setStateRaw] = useState<VoiceState>("idle");
  const [message, setMessage] = useState<string>();
  const [level, setLevel] = useState(0);
  const [speakingAgent, setSpeakingAgent] = useState<VoiceAgentId>();

  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });

  const stateRef = useRef<VoiceState>("idle");
  const setState = useCallback((s: VoiceState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>(0);
  const mic = useRef<{ stream: MediaStream; recorder: MediaRecorder; source: MediaStreamAudioSourceNode | null; discard: boolean } | null>(null);
  const starting = useRef(false);
  /** Bumped by interrupt(): a mic request still waiting for permission is dropped. */
  const generation = useRef(0);
  const player = useRef<{ el: HTMLAudioElement; analyser: AnalyserNode | null } | null>(null);
  const sttCtrl = useRef<AbortController | null>(null);
  const queue = useRef<QueueItem[]>([]);
  const playing = useRef<{ item: QueueItem; audio: HTMLAudioElement; url: string } | null>(null);
  const pumping = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let live = true;
    const check: Promise<boolean | "browser"> = browserCanRecord() ? serverAvailable() : Promise.resolve("browser");
    check.then((ok) => {
      if (!live) return;
      setAvailable(ok === true);
      setReason(ok === true ? undefined : ok === "browser" ? MSG.noBrowser : MSG.noServer);
    });
    return () => {
      live = false;
      mounted.current = false;
    };
  }, []);

  const audioCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctxRef.current = new Ctor();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (mounted.current) setLevel(0);
  }, []);

  /** Animate `level` from an analyser; `tick` returns false to stop. */
  const meter = useCallback(
    (analyser: AnalyserNode, tick?: (lvl: number, now: number) => boolean | void) => {
      cancelAnimationFrame(rafRef.current);
      const buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      let smooth = 0;
      let lastPaint = 0;
      const loop = (now: number) => {
        const raw = readLevel(analyser, buf);
        smooth = raw > smooth ? smooth * 0.4 + raw * 0.6 : smooth * 0.85 + raw * 0.15;
        if (now - lastPaint > 33) {
          lastPaint = now;
          if (mounted.current) setLevel(smooth);
        }
        if (tick?.(raw, now) === false) return;
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [],
  );

  /** Create (and unlock) the reply player. Call from a user gesture. */
  const prime = useCallback(() => {
    if (typeof window === "undefined") return;
    const ctx = audioCtx();
    void ctx?.resume().catch(() => {});
    if (player.current) return;
    const el = new Audio();
    el.preload = "auto";
    player.current = { el, analyser: null };
    el.src = SILENT_WAV;
    el.play().then(
      () => {
        if (el.src === SILENT_WAV) el.pause();
      },
      () => {},
    );
  }, [audioCtx]);

  /* ---------- listening ---------- */

  const releaseMic = useCallback((only?: object) => {
    const m = mic.current;
    if (!m || (only && m !== only)) return;
    mic.current = null;
    try {
      m.source?.disconnect();
    } catch {}
    m.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const fail = useCallback(
    (msg: string) => {
      if (!mounted.current) return;
      setMessage(msg);
      setState("error");
    },
    [setState],
  );

  const sendForTranscript = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      const ctrl = new AbortController();
      sttCtrl.current = ctrl;
      try {
        const form = new FormData();
        const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "mp4" : "webm";
        form.append("audio", blob, `speech.${ext}`);
        const res = await fetch("/api/voice/stt", { method: "POST", body: form, signal: ctrl.signal });
        if (ctrl.signal.aborted || !mounted.current) return;
        if (!res.ok) return fail(res.status === 429 ? MSG.busy : res.status === 422 ? MSG.notHeard : MSG.sttFailed);
        const { text } = (await res.json()) as { text?: string };
        const clean = (text ?? "").trim();
        if (!clean) return fail(MSG.notHeard);
        setMessage(undefined);
        setState("thinking");
        opts.current.onTranscript?.(clean);
      } catch {
        if (!ctrl.signal.aborted) fail(MSG.sttFailed);
      } finally {
        if (sttCtrl.current === ctrl) sttCtrl.current = null;
      }
    },
    [fail, setState],
  );

  const stopListening = useCallback(() => {
    const m = mic.current;
    if (!m) return;
    stopMeter();
    if (m.recorder.state !== "inactive") m.recorder.stop();
    else releaseMic();
  }, [releaseMic, stopMeter]);

  const startListening = useCallback(async () => {
    if (mic.current || starting.current || available === false) return;
    if (!browserCanRecord()) return fail(MSG.noBrowser);
    setMessage(undefined);
    // Inside the tap's user gesture: unlock playback + resume the audio context (iOS Safari).
    prime();
    const ctx = ctxRef.current;

    let stream: MediaStream;
    const gen = generation.current;
    starting.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      starting.current = false;
      const name = err instanceof DOMException ? err.name : "";
      return fail(
        name === "NotAllowedError" || name === "SecurityError"
          ? MSG.denied
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? MSG.noMic
            : name === "NotReadableError"
              ? MSG.micBusy
              : MSG.noBrowser,
      );
    }
    starting.current = false;
    if (!mounted.current || gen !== generation.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    let recorder: MediaRecorder;
    try {
      const mimeType = pickMime();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return fail(MSG.noBrowser);
    }

    const chunks: Blob[] = [];
    let heardMs = 0;
    let source: MediaStreamAudioSourceNode | null = null;
    try {
      source = ctx ? ctx.createMediaStreamSource(stream) : null;
    } catch {}
    const session = { stream, recorder, source, discard: false };
    mic.current = session;

    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      releaseMic(session);
      stopMeter();
      if (session.discard || !mounted.current) return;
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" });
      if (heardMs < SPEECH_MIN_MS || blob.size < 800) {
        fail(MSG.notHeard);
        return;
      }
      void sendForTranscript(blob);
    };
    recorder.start(250);
    setState("listening");

    if (ctx && source) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const started = performance.now();
      let lastLoud = started;
      let prev = started;
      const silenceMs = opts.current.silenceMs ?? 1200;
      meter(analyser, (lvl, now) => {
        const dt = now - prev;
        prev = now;
        if (lvl > SPEECH_LEVEL) {
          heardMs += dt;
          lastLoud = now;
        }
        const talked = heardMs >= SPEECH_MIN_MS;
        if ((talked && now - lastLoud > silenceMs) || (!talked && now - started > NO_SPEECH_TIMEOUT_MS) || now - started > MAX_TURN_MS) {
          if (recorder.state !== "inactive") recorder.stop();
          return false;
        }
      });
    } else {
      // No analyser (very old browser): tap-to-stop only; assume speech.
      heardMs = SPEECH_MIN_MS;
    }
  }, [available, fail, meter, prime, releaseMic, sendForTranscript, setState, stopMeter]);

  /* ---------- speaking ---------- */

  const fetchSpeech = (text: string, agent: VoiceAgentId, signal: AbortSignal): Promise<Blob | null> =>
    fetch("/api/voice/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, agent }),
      signal,
    })
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);

  const playOne = useCallback(
    (item: QueueItem, blob: Blob) =>
      new Promise<void>((resolve) => {
        if (!player.current) prime();
        const p = player.current!;
        const audio = p.el;
        const url = URL.createObjectURL(blob);
        const done = () => {
          audio.onended = audio.onerror = audio.onpause = null;
          URL.revokeObjectURL(url);
          if (playing.current?.audio === audio) playing.current = null;
          stopMeter();
          resolve();
        };
        playing.current = { item, audio, url };
        audio.onended = done;
        audio.onerror = done;
        audio.onpause = done; // interrupt() pauses
        item.ctrl.signal.addEventListener("abort", () => audio.pause(), { once: true });
        audio.src = url;

        // Route through an analyser for the ring only once the context is running
        // (a suspended context would mute the element). The element is wired once.
        const ctx = ctxRef.current;
        if (!p.analyser && ctx && ctx.state === "running") {
          try {
            const src = ctx.createMediaElementSource(audio);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            analyser.connect(ctx.destination);
            p.analyser = analyser;
          } catch {}
        }
        if (p.analyser) meter(p.analyser);
        audio.play().catch(() => {
          if (mounted.current) setMessage(MSG.playFailed);
          done();
        });
      }),
    [meter, prime, stopMeter],
  );

  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      while (queue.current.length && mounted.current) {
        const item = queue.current[0];
        const blob = await item.audio;
        if (!item.ctrl.signal.aborted && blob && blob.size > 0) {
          if (mic.current) {
            // User started talking while the reply was loading: they win.
            item.ctrl.abort();
          } else {
            setSpeakingAgent(item.agent);
            setState("speaking");
            await playOne(item, blob);
          }
        }
        if (queue.current[0] === item) queue.current.shift();
        item.resolve();
      }
    } finally {
      pumping.current = false;
      if (mounted.current) {
        setSpeakingAgent(undefined);
        if (stateRef.current === "speaking") {
          setState("idle");
          if (opts.current.autoListen && available) void startListening();
        }
      }
    }
  }, [available, playOne, setState, startListening]);

  const speak = useCallback(
    (text: string, agentId: VoiceAgentId = "darwin"): Promise<void> => {
      const t = (text ?? "").trim();
      if (!t || available !== true) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const ctrl = new AbortController();
        // Start fetching now so queued replies are ready the moment the previous one ends.
        queue.current.push({ text: t, agent: agentId, ctrl, resolve, audio: fetchSpeech(t, agentId, ctrl.signal) });
        void pump();
      });
    },
    [available, pump],
  );

  const clearQueue = useCallback(() => {
    const items = queue.current;
    queue.current = [];
    for (const it of items) {
      it.ctrl.abort();
      it.resolve();
    }
    const p = playing.current;
    if (p) {
      p.item.ctrl.abort();
      p.audio.pause();
    }
  }, []);

  const interrupt = useCallback(() => {
    generation.current++;
    starting.current = false;
    clearQueue();
    sttCtrl.current?.abort();
    const m = mic.current;
    if (m) {
      m.discard = true;
      if (m.recorder.state !== "inactive") m.recorder.stop();
      releaseMic(); // free the mic now so an immediate tap can start a fresh turn
    }
    stopMeter();
    setSpeakingAgent(undefined);
    setState("idle");
  }, [clearQueue, releaseMic, setState, stopMeter]);

  const setThinking = useCallback(
    (on: boolean) => {
      const s = stateRef.current;
      if (on && (s === "idle" || s === "error")) {
        setMessage(undefined);
        setState("thinking");
      } else if (!on && s === "thinking") setState("idle");
    },
    [setState],
  );

  const reset = useCallback(() => {
    setMessage(undefined);
    if (stateRef.current === "error") setState("idle");
  }, [setState]);

  const tap = useCallback(() => {
    const s = stateRef.current;
    if (s === "listening") return stopListening();
    if (s === "transcribing") return;
    if (s === "speaking" || s === "thinking") {
      // Barge in: stop the reply and listen.
      setState("idle");
      clearQueue();
      setSpeakingAgent(undefined);
    }
    void startListening();
  }, [clearQueue, setState, startListening, stopListening]);

  // Tear down on unmount.
  useEffect(
    () => () => {
      clearQueue();
      sttCtrl.current?.abort();
      if (mic.current) mic.current.discard = true;
      const m = mic.current;
      if (m && m.recorder.state !== "inactive") m.recorder.stop();
      m?.stream.getTracks().forEach((t) => t.stop());
      mic.current = null;
      cancelAnimationFrame(rafRef.current);
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
      if (player.current) {
        player.current.el.pause();
        player.current.el.removeAttribute("src");
        player.current = null;
      }
    },
    [clearQueue],
  );

  return {
    available,
    unavailableReason,
    state,
    message,
    level,
    speakingAgent,
    startListening,
    stopListening,
    tap,
    speak,
    interrupt,
    setThinking,
    reset,
    prime,
  };
}
