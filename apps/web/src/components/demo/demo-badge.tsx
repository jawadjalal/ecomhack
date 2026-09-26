"use client";

/**
 * Whether the console is still on the demo store (nothing of the merchant's connected).
 * The note used to be a strip across the top of every console page; it now lives in the
 * account menu so the header stays one quiet bar. Routes (/store, /onboarding) are unchanged.
 */
import { useEffect, useState } from "react";
import type { DemoResponse, DemoStatus } from "@/lib/contracts";

const POLL_MS = 20_000;

export function useDemoStatus(): DemoStatus | null {
  const [status, setStatus] = useState<DemoStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/demo", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as DemoResponse;
        if (alive) setStatus(j.status.mode === "demo" ? j.status : null);
      } catch {
        /* offline / ?mock=1: no note */
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return status;
}
