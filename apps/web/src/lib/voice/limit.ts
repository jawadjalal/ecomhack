/** Sliding-window rate limiter (single process, like the rest of the demo state). */
const g = globalThis as unknown as { __darwinVoiceHits?: Map<string, number[]> };

export function takeVoiceToken(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const hits: Map<string, number[]> = (g.__darwinVoiceHits ??= new Map());
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  hits.set(key, [...recent, now]);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return true;
}

export function resetVoiceLimits() {
  g.__darwinVoiceHits?.clear();
}

export function voiceClient(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
