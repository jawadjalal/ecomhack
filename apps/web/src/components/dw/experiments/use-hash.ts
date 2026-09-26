"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** The URL fragment without "#" ("" on the server), so links like /console/changes#gen-2 can pick a row. */
export function useHash(): string {
  return useSyncExternalStore(
    subscribe,
    () => decodeURIComponent(window.location.hash.slice(1)),
    () => "",
  );
}

/** Update the fragment without scrolling or adding a history entry. */
export function setHash(value: string | undefined) {
  const url = `${window.location.pathname}${window.location.search}${value ? `#${encodeURIComponent(value)}` : ""}`;
  window.history.replaceState(window.history.state, "", url);
}
