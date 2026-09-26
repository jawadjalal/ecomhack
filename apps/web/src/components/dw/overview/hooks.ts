"use client";

import useSWR from "swr";
import type { AnalyticsEvent, AnalyticsEventsResponse, AnalyticsSummary } from "@/lib/contracts";
import { useApi } from "@/lib/console/hooks";
import { useLiveInterval } from "@/lib/console/live";

const OPTS = { keepPreviousData: true, revalidateOnFocus: false, dedupingInterval: 500, errorRetryInterval: 5000 } as const;

export interface StoreSnapshotView {
  kind: "real" | "simulated" | "empty";
  emptyLine: string;
  simulated: boolean;
  summary: AnalyticsSummary;
  brands: { name: string; shoppers: number; bought: number; rate: number }[];
}

/** The same numbers the crew cites. Skipped in `?mock=1`, where the in-browser demo is the dataset. */
export function useStoreSnapshot(enabled: boolean): StoreSnapshotView | undefined {
  const refreshInterval = useLiveInterval(4000);
  const { data } = useSWR(
    enabled ? "store-snapshot" : null,
    async () => {
      const res = await fetch("/api/analytics/snapshot", { cache: "no-store" });
      if (!res.ok) throw new Error("snapshot");
      return (await res.json()) as StoreSnapshotView;
    },
    { ...OPTS, refreshInterval },
  );
  return data;
}

/**
 * Recent people on the demo store: the last human events (page views, bags, checkouts, orders), polled.
 * Live mode asks the events route for humans only (a wider scan than the plain feed); the in-browser
 * mock engine (`?mock=1`) answers through the console API.
 */
export function usePeopleEvents(): AnalyticsEvent[] | undefined {
  const api = useApi();
  const refreshInterval = useLiveInterval(5000);
  const { data } = useSWR(
    [api.mode, "overview-people"],
    async () => {
      if (api.mode !== "mock") {
        try {
          const res = await fetch("/api/analytics/events?limit=1000&visitorKind=human&exclude=%24autocapture", { cache: "no-store" });
          if (res.ok) return ((await res.json()) as AnalyticsEventsResponse).events;
        } catch {
          /* fall back below */
        }
      }
      return (await api.getEvents(undefined, 1000)).events;
    },
    { ...OPTS, refreshInterval },
  );
  return data;
}

interface SessionInfo {
  github?: { login?: string; name?: string | null };
}

/** First name of the signed-in GitHub user, if any. */
export function useFirstName(): string | undefined {
  const { data } = useSWR<SessionInfo | null>(
    "auth-session",
    async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      return res.ok ? ((await res.json()) as SessionInfo) : null;
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const gh = data?.github;
  const name = gh?.name?.trim() || gh?.login?.trim();
  if (!name) return undefined;
  const first = name.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** One row of the store agent's "Just now" feed (same public route as the Agents screen's sales card). */
export interface StoreAgentSale {
  at: string;
  agent: string;
  ref: string;
  step: string;
  title?: string;
  price?: number;
}

/** The store agent's latest checkout links and payments (live mode only; the mock engine has none). */
export function useStoreAgentSales(): StoreAgentSale[] | undefined {
  const api = useApi();
  const refreshInterval = useLiveInterval(10_000);
  const { data } = useSWR(
    api.mode === "mock" ? null : "overview-store-agent-sales",
    async () => {
      const res = await fetch("/api/store-agent/stats", { cache: "no-store" });
      if (!res.ok) return [];
      const body = (await res.json()) as { funnel?: { recent?: StoreAgentSale[] } };
      return body.funnel?.recent ?? [];
    },
    { ...OPTS, refreshInterval },
  );
  return data;
}
