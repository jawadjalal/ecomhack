"use client";
/**
 * "Live updates" on or off for this browser (the header switch). Off stops every console poll, so the
 * screen holds still while the merchant reads it. Remembered in localStorage; on by default.
 */
import { useSyncExternalStore } from "react";

const KEY = "darwin.live";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLive(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: the switch still works for this page view */
  }
  for (const listener of listeners) listener();
}

export function useLive(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

/** A poll interval that stops while live updates are off. */
export function useLiveInterval(ms: number): number {
  return useLive() ? ms : 0;
}
