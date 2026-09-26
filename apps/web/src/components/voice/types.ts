/** Voice mode types (client side). See ./index.ts for how to wire them into a chat panel. */

/** Chat input mode: typing or talking. */
export type VoiceMode = "type" | "voice";

/** Who is speaking. Unknown names fall back to Darwin's voice on the server. */
export type VoiceAgentId = "darwin" | "iris" | "pixel" | "fizz" | "dash" | (string & {});

/**
 * Live state of the voice loop:
 * idle → listening (mic open) → transcribing (speech → text) → thinking (the panel awaits a reply)
 * → speaking (TTS playing) → idle. "error" carries a friendly `message`.
 */
export type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

export interface UseVoiceOptions {
  /** Called with the transcribed text after the user stops talking. Send it as a chat message. */
  onTranscript?: (text: string) => void;
  /** Stop listening after this much silence once speech was heard (ms). Default 1200. */
  silenceMs?: number;
  /** Start listening again after the agent finishes speaking (hands-free conversation). Default false. */
  autoListen?: boolean;
}

export interface VoiceApi {
  /** null while checking; false when the server has no voice key or the browser can't record. */
  available: boolean | null;
  /** Friendly reason when voice isn't available (for a tooltip). */
  unavailableReason?: string;
  state: VoiceState;
  /** Friendly message for the "error" state (mic blocked, couldn't hear, ...). */
  message?: string;
  /** Mic input level 0..1 while listening, playback level while speaking (for the ring). */
  level: number;
  /** Which agent is speaking right now (while state === "speaking"). */
  speakingAgent?: VoiceAgentId;
  /** Open the mic. */
  startListening: () => Promise<void>;
  /** Close the mic and transcribe what was said. */
  stopListening: () => void;
  /** The big mic button: listen / stop / interrupt playback, depending on state. */
  tap: () => void;
  /** Queue `text` to be spoken in `agentId`'s voice. Returns when it has played (or was interrupted). */
  speak: (text: string, agentId?: VoiceAgentId) => Promise<void>;
  /** Stop playback and clear the queue (also cancels listening). */
  interrupt: () => void;
  /** The panel is waiting for the agent's reply: show "thinking". */
  setThinking: (on: boolean) => void;
  /** Clear an error and go back to idle. */
  reset: () => void;
  /** Unlock audio playback (iOS). Call from a click handler, e.g. when switching to voice mode. VoiceToggle does it. */
  prime: () => void;
}
