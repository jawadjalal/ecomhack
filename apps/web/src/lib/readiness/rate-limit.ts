/**
 * In-memory sliding-window rate limits for the public readiness endpoints (single process, like the
 * rest of the demo state). Keyed by bucket + client IP.
 */

const g = globalThis as unknown as {
  __darwinReadinessHits?: Map<string, number[]>;
};
const hits = (): Map<string, number[]> =>
  (g.__darwinReadinessHits ??= new Map());

/** Best-effort client address (first X-Forwarded-For hop), "local" when there is none. */
export function clientKey(req: Request): string {
  return (
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

/**
 * Record one hit for `key` in `bucket`. Returns false (and records nothing) once `max` hits
 * already happened within `windowMs`.
 */
export function takeToken(
  bucket: string,
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const map = hits();
  const k = `${bucket}:${key}`;
  const recent = (map.get(k) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    map.set(k, recent);
    return false;
  }
  map.set(k, [...recent, now]);
  if (map.size > 5000) map.delete(map.keys().next().value!);
  return true;
}
