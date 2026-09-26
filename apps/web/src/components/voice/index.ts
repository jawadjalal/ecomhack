/**
 * Voice mode (ElevenLabs speech-to-text + text-to-speech) for the chat panel.
 *
 * ```tsx
 * const [mode, setMode] = useState<VoiceMode>("type");
 * const voice = useVoice({ onTranscript: (text) => send(text) });
 *
 * // When a reply arrives:           voice.speak(reply.text, reply.agentId)   (queued, per-agent voice)
 * // While waiting for the reply:     voice.setThinking(true) / false
 * // Leaving voice mode:              voice.interrupt()
 *
 * <VoiceToggle mode={mode} onModeChange={setMode} voice={voice} />   // Type | Voice pill (disabled + tooltip if unavailable)
 * {mode === "voice" && <VoiceBar voice={voice} onClose={() => setMode("type")} />}  // big mic, level ring, live state
 * ```
 *
 * Only call `speak` while in voice mode. The hook is safe to render server-side (browser APIs are touched lazily).
 * Server routes: GET /api/voice → { available }, POST /api/voice/tts, POST /api/voice/stt (admin-gated).
 */
export { useVoice } from "./use-voice";
export { VoiceToggle } from "./voice-toggle";
export type { VoiceToggleProps } from "./voice-toggle";
export { VoiceBar } from "./voice-bar";
export type { VoiceBarProps } from "./voice-bar";
export type { VoiceAgentId, VoiceApi, VoiceMode, VoiceState, UseVoiceOptions } from "./types";
