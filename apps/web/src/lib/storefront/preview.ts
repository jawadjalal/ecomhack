/**
 * Preview support for the console's before/after view.
 *
 *   /store?previewSpec=<base64url(JSON.stringify(spec))>
 *
 * renders the store from an arbitrary (validated) PageSpec without touching the live spec or
 * firing analytics. Pure functions: safe to import from server and client code.
 */
import { PageSpecSchema, type PageSpec } from "@/lib/contracts";

function toBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** base64url(JSON) — what `?previewSpec=` expects. */
export function encodePreviewSpec(spec: PageSpec): string {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode + validate. Returns null for anything that isn't a full, valid PageSpec. */
export function decodePreviewSpec(raw: string | null | undefined): PageSpec | null {
  if (!raw || raw.length > 20_000) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(fromBase64(b64 + "===".slice((b64.length + 3) % 4)));
    const parsed = PageSpecSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Build a store URL that previews `spec`, e.g. for an <iframe src>. */
export function previewUrl(spec: PageSpec, path = "/store", extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ previewSpec: encodePreviewSpec(spec), ...extra });
  return `${path}?${q.toString()}`;
}

/** Query params that survive navigation inside the store (preview / debug state). */
export const PERSISTED_PARAMS = ["variant", "previewSpec", "debug", "preview"] as const;

/** Append the persisted query string to an in-store href. */
export function withPersist(href: string, persist: string): string {
  if (!persist) return href;
  const [pathAndQuery, hash] = href.split("#");
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  return `${pathAndQuery}${sep}${persist}${hash !== undefined ? `#${hash}` : ""}`;
}
