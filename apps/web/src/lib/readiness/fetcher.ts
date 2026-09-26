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

function v4Reason(v4: string): string | null {
  if (inRange(v4, "127.0.0.0/8"))
    return allowLoopback() ? null : "loopback address";
  return PRIVATE_V4.some((c) => inRange(v4, c))
    ? "private or reserved address"
    : null;
}

/** Expand an IPv6 address (any notation, incl. a dotted IPv4 tail and a zone id) to 8 hextets, or null. */
export function expandIpv6(ip: string): number[] | null {
  let s = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const n = ipv4ToInt(dotted[1]);
    s = `${s.slice(0, -dotted[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (x: string) => (x ? x.split(":") : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((h) => /^[0-9a-f]{1,4}$/.test(h)))
    return null;
  return all.map((h) => parseInt(h, 16));
}

const hextetsToV4 = (hi: number, lo: number) =>
  [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");

/**
 * Why an address may not be fetched, or null when it's public. IPv6 forms that embed an IPv4 address
 * (mapped `::ffff:a.b.c.d` in any notation, compatible `::a.b.c.d`, translated, NAT64 `64:ff9b::/96`, 6to4
 * `2002::/16`) are judged by the IPv4 address they carry, so `[::ffff:169.254.169.254]` (which the URL parser
 * rewrites to `::ffff:a9fe:a9fe`) is blocked like the plain address.
 */
export function blockedReason(ip: string): string | null {
  if (isIP(ip) === 4) return v4Reason(ip);
  const h = expandIpv6(ip);
  if (!h) return "unrecognised address";
  const zeros = (from: number, to: number) =>
    h.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8)) return "private or reserved address"; // ::
  if (zeros(0, 7) && h[7] === 1)
    return allowLoopback() ? null : "loopback address"; // ::1
  // IPv4-mapped ::ffff:0:0/96, IPv4-compatible ::/96, IPv4-translated ::ffff:0:0:0/96
  if (zeros(0, 5) && (h[5] === 0xffff || h[5] === 0))
    return v4Reason(hextetsToV4(h[6], h[7]));
  if (zeros(0, 4) && h[4] === 0xffff && h[5] === 0)
    return v4Reason(hextetsToV4(h[6], h[7]));
  // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (h[0] === 0x64 && h[1] === 0xff9b)
    return (
      v4Reason(hextetsToV4(h[6], h[7])) ??
      (h[2] === 1 ? "private or reserved address" : null)
    );
  // 6to4 2002::/16 carries the IPv4 address in the next 32 bits
  if (h[0] === 0x2002) return v4Reason(hextetsToV4(h[1], h[2]));
  // Teredo 2001::/32 (obfuscated IPv4), unique-local fc00::/7, link-local fe80::/10, site-local fec0::/10, multicast ff00::/8
  if (h[0] === 0x2001 && h[1] === 0) return "private or reserved address";
  if (
    (h[0] & 0xfe00) === 0xfc00 ||
    (h[0] & 0xffc0) === 0xfe80 ||
    (h[0] & 0xffc0) === 0xfec0 ||
    (h[0] & 0xff00) === 0xff00
  )
    return "private or reserved address";
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
