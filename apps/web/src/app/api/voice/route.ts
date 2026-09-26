import { voiceAvailable } from "@/lib/voice";

export const dynamic = "force-dynamic";

/** GET /api/voice → { available } — whether voice mode can be offered (an ElevenLabs key is configured). */
export async function GET() {
  return Response.json({ available: voiceAvailable() }, { headers: { "cache-control": "no-store" } });
}
