/**
 * Once per server start. The watch heartbeat only runs in-process when DARWIN_WATCH=1 (one interval,
 * this process only). Production uses the Vercel Cron in vercel.json, which calls GET /api/team/watch.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DARWIN_WATCH !== "1") return;
  const { startWatchLoop } = await import("@/lib/team/watch");
  startWatchLoop();
}
