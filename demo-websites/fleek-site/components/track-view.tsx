"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/track";

/** Fires one event when the page mounts (product_viewed, cart_viewed, …). */
export function TrackView({ event, props }: { event: string; props: Record<string, unknown> }) {
  const sent = useRef(false);
  const key = JSON.stringify(props);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track(event, JSON.parse(key) as Record<string, unknown>);
  }, [event, key]);
  return null;
}
