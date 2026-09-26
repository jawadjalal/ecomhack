import { voiceStatus } from "@/lib/voice/elevenlabs";

export const dynamic = "force-dynamic";

/** GET /api/voice/status → { stt, tts } (admin). True when ElevenLabs is configured; else the browser's speech APIs. */
export function GET() {
  return Response.json(voiceStatus(), { headers: { "cache-control": "no-store" } });
}
