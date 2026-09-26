"use client";

import { useEffect, useState } from "react";
import type { LoopState } from "@/lib/contracts";

/** One loop run: changes on reset (Gen 0 is re-recorded with a new timestamp). */
export function runScope(loop: LoopState | undefined): string | undefined {
  if (!loop) return undefined;
  return loop.history[0]?.shippedAt ?? "run";
}

function read<T>(key: string): { scope?: string; list: T[] } {
  if (typeof window === "undefined") return { list: [] };
  try {
    const raw = window.sessionStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as { scope?: string; list?: T[] }) : undefined;
    return v && Array.isArray(v.list) ? { scope: v.scope, list: v.list } : { list: [] };
  } catch {
    return { list: [] };
  }
}

/**
 * Keeps the last non-empty list of this loop run. The loop clears insights and the proposal at the start of
 * every observe phase; without this the page would swap to its empty state and back on every cycle.
 * Survives reloads through sessionStorage. `stale` is true while the sticky copy is shown.
 */
export function useSticky<T>(key: string, scope: string | undefined, fresh: T[]): { list: T[]; stale: boolean } {
  const [snap, setSnap] = useState<{ scope?: string; list: T[] }>(() => read<T>(key));
  // Remember the latest non-empty list (setState during render is React's "store from previous render" pattern).
  if (scope && fresh.length && (snap.list !== fresh || snap.scope !== scope)) setSnap({ scope, list: fresh });

  useEffect(() => {
    if (!scope || !fresh.length) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify({ scope, list: fresh }));
    } catch {
      /* storage blocked: the in-memory copy still works */
    }
  }, [key, scope, fresh]);

  if (fresh.length || !scope) return { list: fresh, stale: false };
  if (snap.scope === scope && snap.list.length) return { list: snap.list, stale: true };
  return { list: fresh, stale: false };
}
