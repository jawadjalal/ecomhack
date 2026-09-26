"use client";

/**
 * "Demo store · connect your site": shown on every console page while nothing of the merchant's is connected
 * (GET /api/demo → mode "demo"), so it's always clear the numbers come from simulated shoppers on the demo
 * store at /store, and how to connect a real one. A pill bottom-right on wide screens (clear of the centred
 * prompt bar), a slim strip on top of the page below that.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import type { DemoResponse, DemoStatus } from "@/lib/contracts";

const POLL_MS = 20_000;

export function DemoBadge() {
  const [status, setStatus] = useState<DemoStatus>();

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/demo", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as DemoResponse;
        if (alive) setStatus(j.status);
      } catch {
        /* offline / ?mock=1: no badge */
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (status?.mode !== "demo") return null;
  const note = status.seeding ? "sending simulated shoppers…" : "simulated shoppers";

  return (
    <>
      {/* below xl: a strip on top of the page (no data-dw here: its unlayered `color` would beat text-white) */}
      <div
        role="note"
        aria-label="Demo store"
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-dw-ink px-4 py-2 font-dw text-[13px] text-white xl:hidden"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-dw-live" aria-hidden />
          Demo store: {status.store.name}, {note}
        </span>
        <Link href="/onboarding" className="inline-flex items-center gap-1 font-semibold underline decoration-white/40 underline-offset-2 hover:decoration-white">
          Connect your site <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {/* xl and up: a one-line pill bottom-right, clear of the centred prompt bar (≤ 320px wide at 1440) */}
      <div
        data-dw
        role="note"
        aria-label="Demo store"
        title={`Nothing of yours is connected: Darwin runs on the demo store (${status.store.name}, /store) with ${note}.`}
        className="fixed right-4 bottom-[26px] z-40 hidden h-11 items-center gap-2.5 rounded-full bg-dw-surface pr-1.5 pl-4 font-dw text-[13px] text-dw-ink shadow-[0_0_0_1px_#EDE4D2,0_18px_40px_-22px_rgba(20,20,19,0.35)] xl:flex"
      >
        <Link href="/store" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
          <span className="size-2 rounded-full bg-dw-live" aria-hidden />
          <span className="font-semibold">Demo store</span>
          <span className="hidden text-dw-ink/55 2xl:inline">· {note}</span>
          <ExternalLink className="size-3 text-dw-ink/45" aria-hidden />
        </Link>
        <Link
          href="/onboarding"
          className="inline-flex h-8 items-center gap-1 rounded-full bg-dw-ink px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-black"
        >
          Connect your site <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </>
  );
}
