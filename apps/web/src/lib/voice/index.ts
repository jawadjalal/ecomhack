/**
 * Voice (server side): ElevenLabs text-to-speech per agent + speech-to-text for the chat panel.
 * Public API for routes and other areas. The client side lives in components/voice.
 */
export {
  synthesize,
  transcribe,
  parseTranscript,
  voiceAvailable,
  VoiceError,
  MAX_AUDIO_BYTES,
  MIN_AUDIO_BYTES,
  DEFAULT_TTS_MODEL,
  DEFAULT_STT_MODEL,
} from "./elevenlabs";
export type { SynthesizeInput, SynthesizeResult, TranscribeInput, TranscribeResult } from "./elevenlabs";
export { cleanForSpeech, MAX_SPEECH_CHARS } from "./clean";
export { voiceFor, normalizeAgent, DEFAULT_VOICES, VOICE_AGENTS } from "./voices";
export type { VoiceAgent, VoiceProfile } from "./voices";
export { takeVoiceToken, voiceClient, resetVoiceLimits } from "./limit";
