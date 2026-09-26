/**
 * One distinct ElevenLabs voice per agent. Defaults are stock (premade) voices every ElevenLabs account has;
 * override any of them with ELEVENLABS_VOICE_<NAME> (e.g. ELEVENLABS_VOICE_DARWIN=<voice_id>).
 */

export const VOICE_AGENTS = ["darwin", "iris", "pixel", "fizz", "dash"] as const;
export type VoiceAgent = (typeof VOICE_AGENTS)[number];

export interface VoiceProfile {
  /** Stock voice name (for docs and the settings UI). */
  label: string;
  voiceId: string;
  /** ElevenLabs voice_settings: lower stability = more expressive. */
  stability: number;
  similarityBoost: number;
  style: number;
}

export const DEFAULT_VOICES: Record<VoiceAgent, VoiceProfile> = {
  // Darwin, the manager: warm, steady British narrator.
  darwin: { label: "George", voiceId: "JBFqnCBsd6RMkjVDRZzb", stability: 0.5, similarityBoost: 0.75, style: 0.1 },
  // Iris, the observer: calm, clear, confident.
  iris: { label: "Sarah", voiceId: "EXAVITQu4vr4xnAT4KZI", stability: 0.55, similarityBoost: 0.75, style: 0.05 },
  // Pixel, the designer: relaxed, friendly Australian.
  pixel: { label: "Charlie", voiceId: "IKne3meq5aSn9XLyUdCD", stability: 0.45, similarityBoost: 0.75, style: 0.15 },
  // Fizz, the experimenter: bright and playful.
  fizz: { label: "Jessica", voiceId: "cgSgspJ2msm6clMCkdW9", stability: 0.4, similarityBoost: 0.75, style: 0.25 },
  // Dash, the shipper: energetic, quick.
  dash: { label: "Liam", voiceId: "TX3LPaxmHKxFdv7VOQHJ", stability: 0.45, similarityBoost: 0.75, style: 0.2 },
};

/** ElevenLabs voice ids are 20-char alphanumerics; accept anything sane from env. */
const VOICE_ID_RE = /^[A-Za-z0-9]{10,40}$/;

export function normalizeAgent(agent: string | undefined | null): VoiceAgent {
  const a = (agent ?? "").trim().toLowerCase();
  return (VOICE_AGENTS as readonly string[]).includes(a) ? (a as VoiceAgent) : "darwin";
}

/** The voice for an agent, honouring ELEVENLABS_VOICE_<NAME>. Unknown agents speak as Darwin. */
export function voiceFor(agent: string | undefined | null, env: Record<string, string | undefined> = process.env): VoiceProfile & { agent: VoiceAgent } {
  const id = normalizeAgent(agent);
  const base = DEFAULT_VOICES[id];
  const override = env[`ELEVENLABS_VOICE_${id.toUpperCase()}`]?.trim();
  return { ...base, agent: id, voiceId: override && VOICE_ID_RE.test(override) ? override : base.voiceId };
}
