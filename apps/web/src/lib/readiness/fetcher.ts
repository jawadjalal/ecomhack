/**
 * Fetching arbitrary merchant URLs safely: http(s) only, no private or link-local addresses
 * (checked on every redirect hop), timeouts and a response size cap.
 *
 * Loopback (localhost) is allowed outside Vercel so a local demo can audit its own /store;
 * set DARWIN_READINESS_ALLOW_LOCAL=0 to turn that off.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Fetched } from "./checks";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; DarwinReadiness/1.0; +https://github.com/jawadjalal/ecomhack)";
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 4;

export class BlockedUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const PRIVATE_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function allowLoopback(): boolean {
  return (
    !process.env.VERCEL && process.env.DARWIN_READINESS_ALLOW_LOCAL !== "0"
  );
}

/** Why an address may not be fetched, or null when it's public. */
export function blockedReason(ip: string): string | null {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    if (inRange(v4, "127.0.0.0/8"))
      return allowLoopback() ? null : "loopback address";
    return PRIVATE_V4.some((c) => inRange(v4, c))
      ? "private or reserved address"
      : null;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1") return allowLoopback() ? null : "loopback address";
  if (
    v6 === "::" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff")
  ) {
    return "private or reserved address";
  }
  return null;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("That doesn't look like a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new BlockedUrlError("Only http and https URLs can be checked.");
  if (url.username || url.password)
    throw new BlockedUrlError("URLs with credentials aren't allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new BlockedUrlError(`Couldn't resolve ${host}.`);
  for (const ip of addresses) {
    const why = blockedReason(ip);
    if (why)
      throw new BlockedUrlError(
        `${host} points to a ${why}, which can't be checked.`,
      );
  }
  return url;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** GET (or POST) a public URL, following redirects manually so every hop is re-checked. Never throws. */
export async function safeFetch(
  raw: string,
  init: {
    method?: "GET" | "POST" | "DELETE";
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<Fetched> {
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const url = await assertPublicUrl(current);
      const res = await fetch(url, {
        method: init.method ?? "GET",
        body: init.body,
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
          ...init.headers,
        },
        signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined);
        current = new URL(location, url).href;
        continue;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      return {
        url: url.href,
        status: res.status,
        headers,
        body: await readCapped(res),
      };
    }
    return {
      url: current,
      status: 0,
      headers: {},
      body: "",
      error: "too many redirects",
    };
  } catch (e) {
    const msg =
      e instanceof BlockedUrlError
        ? e.message
        : e instanceof Error
          ? e.name === "TimeoutError"
            ? "timed out"
            : e.message
          : String(e);
    return {
      url: current,
      status: 0,
      headers: {},
      body: "",
      error: msg.slice(0, 200),
    };
  }
}
