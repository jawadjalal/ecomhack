"use client";

import useSWR from "swr";
import type { AnalyticsEvent, AnalyticsEventsResponse } from "@/lib/contracts";
import { useApi } from "@/lib/console/hooks";

const OPTS = { keepPreviousData: true, revalidateOnFocus: false, dedupingInterval: 500, errorRetryInterval: 5000 } as const;

/**
 * Recent people on the demo store: the last human events (page views, bags, checkouts, orders), polled.
 * Live mode asks the events route for humans only (a wider scan than the plain feed); the in-browser
 * mock engine (`?mock=1`) answers through the console API.
 */
export function usePeopleEvents(): AnalyticsEvent[] | undefined {
  const api = useApi();
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
    { ...OPTS, refreshInterval: 3000 },
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
