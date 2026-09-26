"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple devices, "Ctrl" elsewhere (server snapshot: ⌘). */
export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(noop, () => (isMac() ? "⌘" : "Ctrl"), () => "⌘");
}

const subscribeNarrow = (cb: () => void) => {
  const mq = window.matchMedia("(max-width: 639px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Phone-width viewport (<640px), for shorter copy. Server snapshot: false. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia("(max-width: 639px)").matches, () => false);
}
