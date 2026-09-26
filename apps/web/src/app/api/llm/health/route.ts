import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, bearer, isAdminCredential } from "@/lib/auth/admin";
import { llmRouting, probeProvider } from "@/lib/llm/client";

export const dynamic = "force-dynamic";
/** Four probes run in parallel, 10 s each. */
export const maxDuration = 30;

const PROVIDERS = ["xai", "apinex", "anthropic", "openrouter"] as const;

/**
 * GET /api/llm/health → { providers: [{ provider, configured, ok, ms?, model?, error? }], routing, checkedAt }
 * (admin: behind the proxy gate, and checked here too). Ops only, never shown in the UI: model ids may appear,
 * keys and env values never do. Each configured provider gets one tiny "reply OK" call (10 s timeout, no
 * fallback); `routing` says who answers the default calls, the assistant's tool loop and certificates.
 */
export async function GET(req: NextRequest) {
  const credential = req.cookies.get(ADMIN_COOKIE)?.value ?? bearer(req.headers.get("authorization"));
  if (!isAdminCredential(credential)) {
    return Response.json({ error: "Unauthorized: send Authorization: Bearer <DARWIN_ADMIN_TOKEN>." }, { status: 401 });
  }
  const providers = await Promise.all(PROVIDERS.map((p) => probeProvider(p, 10_000)));
  return Response.json(
    { providers, routing: llmRouting(), checkedAt: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
