// POST /api/readiness/certify { url } → ReadinessCertificate  (429 rate limited, 400 bad or private URL)
import { z } from "zod";
import { BlockedUrlError, certifyStore, clientKey, normaliseStoreUrl, recentCertificate, takeToken } from "@/lib/readiness";

export const dynamic = "force-dynamic";
/** Audit (~10s) + a bounded AI agent trial (≤ 45s budget). */
export const maxDuration = 90;

const Body = z.object({ url: z.string().min(1).max(500) });

/** Same URL within 10 minutes → the existing certificate (LLM calls cost credits). */
const REUSE_MS = 10 * 60_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_IP = 5;
const GLOBAL_WINDOW_MS = 60 * 60_000;
const MAX_GLOBAL = 60;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Send { url }." }, { status: 400 });

  let url: string;
  try {
    url = normaliseStoreUrl(parsed.data.url);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }

  const recent = recentCertificate(url, REUSE_MS);
  if (recent) return Response.json(recent);

  if (!takeToken("certify", clientKey(req), MAX_PER_IP, WINDOW_MS)) {
    return Response.json({ error: "Too many certificates from this address. Try again in a few minutes." }, { status: 429 });
  }
  if (!takeToken("certify-global", "all", MAX_GLOBAL, GLOBAL_WINDOW_MS)) {
    return Response.json({ error: "Darwin is issuing a lot of certificates right now. Try again later." }, { status: 429 });
  }

  try {
    return Response.json(await certifyStore(url));
  } catch (e) {
    if (e instanceof BlockedUrlError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[readiness] certification failed", e);
    return Response.json({ error: "Certification failed. Try again." }, { status: 500 });
  }
}
