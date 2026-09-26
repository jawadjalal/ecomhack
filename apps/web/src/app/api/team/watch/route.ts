import { bearer, isAdminCredential, safeEqual } from "@/lib/auth/admin";
import { publicOrigin } from "@/lib/github";
import { runWatch, watchState } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The heartbeat.
 *
 * GET  /api/team/watch → WatchStateResponse (admin). Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`
 *                        and that runs a pass instead.
 * POST /api/team/watch → WatchRunResponse (admin, or the same cron secret). `{ reason?: "manual" | "cron" | "dev" }`.
 *
 * The path is outside the admin proxy so a cron secret that isn't the admin token still works; this handler checks.
 */
function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const cred = bearer(req.headers.get("authorization"));
  return !!secret && !!cred && safeEqual(cred, secret);
}

function authorized(req: Request): boolean {
  return isAdminCredential(bearer(req.headers.get("authorization"))) || cronAuthorized(req);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized: sign in at /console or send Authorization: Bearer <DARWIN_ADMIN_TOKEN>." }, { status: 401 });
  if (cronAuthorized(req)) {
    const run = await runWatch({ reason: "cron", origin: publicOrigin(req) });
    return Response.json(run, { headers: { "cache-control": "no-store" } });
  }
  return Response.json(watchState(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized: sign in at /console or send Authorization: Bearer <DARWIN_ADMIN_TOKEN>." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = body.reason === "cron" || body.reason === "dev" ? body.reason : "manual";
  const run = await runWatch({ reason, origin: publicOrigin(req) });
  return Response.json(run, { headers: { "cache-control": "no-store" } });
}
