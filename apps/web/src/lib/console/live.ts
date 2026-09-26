"use client";
/**
 * "Live updates" on or off for this browser (the header switch). Off stops every console poll, so the
 * screen holds still while the merchant reads it. Off by default: the console turns it on while Darwin is
 * running (autopilot, "Watch Darwin fix it") and the merchant can flip it. Remembered in localStorage.
 */
import { useSyncExternalStore } from "react";

const KEY = "darwin.live";
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
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
  return useSyncExternalStore(subscribe, read, () => false);
}

/** A poll interval that stops while live updates are off. */
export function useLiveInterval(ms: number): number {
  return useLive() ? ms : 0;
}
