"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useHotkeys } from "@/lib/console/hooks";
import { setIdParam } from "./model";

/**
 * List selection that lives in the URL (`?id=…`, so it can be deep-linked and shared) with ↑/↓ (and
 * j/k) to move. Falls back to the first id when the param is missing or stale.
 */
export function useUrlSelection(ids: string[]) {
  const params = useSearchParams();
  const want = params.get("id") ?? undefined;
  const selected = want && ids.includes(want) ? want : ids[0];
  const index = selected ? ids.indexOf(selected) : -1;

  const select = useCallback((id: string) => setIdParam(id), []);
  const move = useCallback(
    (by: number) => {
      if (!ids.length) return;
      const next = ids[Math.min(ids.length - 1, Math.max(0, index + by))];
      if (next && next !== selected) {
        setIdParam(next);
        // keep the moved-to row visible and focused when the list has focus
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-sel-id="${CSS.escape(next)}"]`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          if (document.activeElement?.closest("[role=listbox]")) el?.focus({ preventScroll: true });
        });
      }
    },
    [ids, index, selected],
  );

  const keys = useMemo(
    () => ({ arrowdown: () => move(1), arrowup: () => move(-1), j: () => move(1), k: () => move(-1) }),
    [move],
  );
  useHotkeys(keys, ids.length > 1);

  return { selected, index, select, requested: want };
}
