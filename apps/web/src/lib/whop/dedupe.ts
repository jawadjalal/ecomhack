/**
 * Idempotency for Whop webhook deliveries.
 * Prefer webhook-id (same across retries). Also track payment ids for order_completed.
 */
import { kvGet, kvUpdate } from "@/lib/db/json-store";

const KEY = "whop-webhook-seen";
const MAX = 5_000;

type Seen = { ids: string[] };

function load(): Seen {
  return kvGet<Seen>(KEY, () => ({ ids: [] }));
}

/** Returns true if this id was already processed (caller should no-op). */
export function alreadySeen(id: string): boolean {
  return load().ids.includes(id);
}

export function markSeen(id: string): void {
  kvUpdate<Seen>(KEY, () => ({ ids: [] }), (cur) => {
    if (cur.ids.includes(id)) return cur;
    const ids = [...cur.ids, id];
    if (ids.length > MAX) ids.splice(0, ids.length - MAX);
    return { ids };
  });
}
