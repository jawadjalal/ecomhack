"use client";

/**
 * Human / Agent view mode for the console. Persisted in localStorage; `?mode=agent` (or `?mode=human`) in the URL
 * wins and is remembered. Server snapshot is always "human" so markup hydrates the same.
 */
import { useSyncExternalStore } from "react";

export type ViewMode = "human" | "agent";

const KEY = "darwin.viewmode.v1";
const listeners = new Set<() => void>();
let current: ViewMode | undefined;

function fromUrl(): ViewMode | undefined {
  try {
    const q = new URLSearchParams(window.location.search).get("mode");
    return q === "agent" || q === "human" ? q : undefined;
  } catch {
    return undefined;
  }
}

function fromStorage(): ViewMode {
  try {
    return localStorage.getItem(KEY) === "agent" ? "agent" : "human";
  } catch {
    return "human";
  }
}

function persist(mode: ViewMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked: the mode still holds for this tab */
  }
}

function read(): ViewMode {
  if (current) return current;
  const url = fromUrl();
  if (url) persist(url);
  current = url ?? fromStorage();
  return current;
}

/** Re-read `?mode=` after a client navigation (a link or agent can switch views by URL). */
export function syncModeFromUrl() {
  const url = fromUrl();
  if (url && url !== current) {
    current = url;
    persist(url);
    listeners.forEach((l) => l());
  }
}

export function setViewMode(mode: ViewMode) {
  current = mode;
  persist(mode);
  // Keep a shared URL honest: ?mode= follows the switch (removed for human).
  try {
    const u = new URL(window.location.href);
    if (mode === "agent") u.searchParams.set("mode", "agent");
    else u.searchParams.delete("mode");
    if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u.href);
  } catch {
    /* no history API */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = e.newValue === "agent" ? "agent" : "human";
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, read, () => "human");
}
