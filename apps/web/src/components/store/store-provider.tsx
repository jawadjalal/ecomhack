"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import type { EventProperties, PageSpec } from "@/lib/contracts";
import { flushNow, trackWith, type StoreAnalyticsConfig } from "@/lib/storefront/analytics";
import { withPersist } from "@/lib/storefront/preview";

export interface StoreClientContext {
  spec: PageSpec;
  persist: string;
  preview: boolean;
  variantLabel: string;
  analytics: StoreAnalyticsConfig;
}

const Ctx = createContext<StoreClientContext | null>(null);

export function StoreProvider({ value, children }: { value: StoreClientContext; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreClientContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}

/** `track(event, props)` bound to this page's attribution; no-op in previews. */
export function useTrack() {
  const { analytics } = useStore();
  return useCallback((event: string, props?: EventProperties) => trackWith(analytics, event, props), [analytics]);
}

export function useFlush() {
  const { analytics } = useStore();
  return useCallback(() => flushNow(analytics), [analytics]);
}

/** In-store href that keeps preview/debug params. */
export function useStoreHref() {
  const { persist } = useStore();
  return useCallback((href: string) => withPersist(href, persist), [persist]);
}

/** <Link> that keeps `?variant` / `?previewSpec` / `?debug` while browsing the store. */
export function StoreLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { persist } = useStore();
  return <Link href={withPersist(href, persist)} {...rest} />;
}

/** Fires one event when it mounts (give it a new `key` to fire again, e.g. per search query). */
export function TrackEvent({ event, props }: { event: string; props?: EventProperties }) {
  const track = useTrack();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(event, props);
    // Fire once per mount; remount (key) to fire again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Fires `$pageview` (plus any extra events) once when the page mounts. */
export function PageView({ page, events = [] }: { page: string; events?: { event: string; props?: EventProperties }[] }) {
  const track = useTrack();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track("$pageview", { page });
    for (const e of events) track(e.event, e.props);
    // Fire once per mount; `events` is static per page render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
