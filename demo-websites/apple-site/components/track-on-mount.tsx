"use client";

import { useEffect } from "react";
import { setSpecVersion, track } from "@/lib/track";

/** Fire one event when a server-rendered page mounts (product_viewed, etc.). */
export function TrackOnMount({ event, props }: { event: string; props?: Record<string, unknown> }) {
  const key = JSON.stringify(props ?? {});
  useEffect(() => {
    track(event, JSON.parse(key));
  }, [event, key]);
  return null;
}

/** Tells lib/track.ts which config version this page was rendered from. */
export function SpecVersion({ version }: { version: number }) {
  setSpecVersion(version);
  return null;
}
