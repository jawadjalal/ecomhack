import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "@/lib/contracts";

const upsert = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ from: vi.fn(() => ({ upsert })) })),
}));

const { mirrorEvents, flushSupabaseMirror, supabaseMirrorStats } = await import("./supabase");

const events = (n: number, from = 0): AnalyticsEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    uuid: `u${from + i}`,
    event: "$pageview",
    distinct_id: `v${i}`,
    timestamp: "2026-09-26T10:00:00.000Z",
    properties: { visitor_kind: "human" },
  }));

describe("Supabase mirror", () => {
  beforeEach(() => {
    upsert.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("is a no-op without env vars", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    mirrorEvents(events(3));
    await flushSupabaseMirror();
    expect(upsert).not.toHaveBeenCalled();
    expect(supabaseMirrorStats().enabled).toBe(false);
  });

  it("upserts in batches of 500 on uuid, ignoring duplicates", async () => {
    upsert.mockResolvedValue({ error: null });
    mirrorEvents(events(1200));
    await flushSupabaseMirror();
    expect(upsert.mock.calls.map(([rows]) => rows.length)).toEqual([500, 500, 200]);
    expect(upsert.mock.calls[0][0][0]).toEqual({
      uuid: "u0",
      event: "$pageview",
      distinct_id: "v0",
      timestamp: "2026-09-26T10:00:00.000Z",
      properties: { visitor_kind: "human" },
    });
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "uuid", ignoreDuplicates: true });
    expect(supabaseMirrorStats()).toMatchObject({ enabled: true, queued: 0 });
  });

  it("keeps failed batches queued for retry instead of dropping them", async () => {
    upsert.mockResolvedValueOnce({ error: { message: "relation events does not exist" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mirrorEvents(events(10, 5000));
    await flushSupabaseMirror();
    expect(supabaseMirrorStats().queued).toBe(10);
    upsert.mockResolvedValue({ error: null });
    await flushSupabaseMirror();
    expect(supabaseMirrorStats().queued).toBe(0);
    warn.mockRestore();
  });
});
