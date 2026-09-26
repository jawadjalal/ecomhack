/**
 * Fetching arbitrary merchant URLs safely: http(s) only, no private or link-local addresses
 * (checked on every redirect hop), timeouts and a response size cap.
 *
 * Every address form is normalised before the check (IPv6 that embeds an IPv4 address, such as
 * ::ffff:7f00:1, NAT64 or 6to4, is checked as that IPv4), and each connection is pinned to the
 * address we vetted, so a second DNS answer can't swap in another host (DNS rebinding).
 *
 * Loopback (localhost) is allowed outside Vercel so a local demo can audit its own /store;
 * set DARWIN_READINESS_ALLOW_LOCAL=0 to turn that off.
 */
import { lookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { constants, createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Fetched } from "./checks";

export const USER_AGENT = "Mozilla/5.0 (compatible; DarwinReadiness/1.0; +https://github.com/jawadjalal/ecomhack)";
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
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function allowLoopback(): boolean {
  return !process.env.VERCEL && process.env.DARWIN_READINESS_ALLOW_LOCAL !== "0";
}

/** The eight 16-bit groups of an IPv6 address (zone id dropped, trailing dotted IPv4 allowed), or null. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[2]) !== 4) return null;
    const n = ipv4ToInt(dotted[2]);
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The IPv4 address an IPv6 address carries, or null: IPv4-mapped (::ffff:a.b.c.d), IPv4-translated
 * (::ffff:0:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 (2002::/16).
 */
export function embeddedIPv4(ip: string): string | null {
  const g = ipv6Groups(ip);
  if (!g) return null;
  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return v4(g[6], g[7]);
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4(g[6], g[7]);
  if (zero(0, 6) && (g[6] !== 0 || g[7] > 1)) return v4(g[6], g[7]); // not :: or ::1, handled as IPv6
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6], g[7]);
  if (g[0] === 0x2002) return v4(g[1], g[2]);
  return null;
}

/** Other spellings of an IPv4 address ("2130706433", "0x7f.1", "0177.0.0.1") as a.b.c.d, or null. */
function looseIPv4(s: string): string | null {
  try {
    const host = new URL(`http://${s}/`).hostname;
    return isIP(host) === 4 ? host : null;
  } catch {
    return null;
  }
}

/** Why an address may not be fetched, or null when it's public. */
export function blockedReason(ip: string): string | null {
  const addr = ip.trim().replace(/^\[|\]$/g, "");
  if (isIP(addr.split("%")[0]) === 6) {
    const mapped = embeddedIPv4(addr);
    if (mapped) return blockedReason(mapped);
    const g = ipv6Groups(addr);
    if (!g) return "malformed address";
    if (g.every((x) => x === 0)) return "private or reserved address"; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return allowLoopback() ? null : "loopback address";
    if (
      (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 site-local (deprecated)
      (g[0] & 0xff00) === 0xff00 || // ff00::/8 multicast
      (g[0] === 0x2001 && g[1] === 0) || // 2001::/32 Teredo (tunnels to an obfuscated IPv4)
      (g[0] === 0x2001 && g[1] === 0xdb8) || // 2001:db8::/32 documentation
      (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) || // 64:ff9b:1::/48 local-use NAT64
      (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) // 100::/64 discard
    ) {
      return "private or reserved address";
    }
    return null;
  }
  const v4 = isIP(addr) === 4 ? addr : looseIPv4(addr);
  if (!v4) return "malformed address";
  if (inRange(v4, "127.0.0.0/8")) return allowLoopback() ? null : "loopback address";
  return PRIVATE_V4.some((c) => inRange(v4, c)) ? "private or reserved address" : null;
}

/** A URL that passed the checks, and the one address it may be fetched from. */
interface Vetted {
  url: URL;
  address: string;
  family: 4 | 6;
}

async function vetUrl(raw: string): Promise<Vetted> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("That doesn't look like a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BlockedUrlError("Only http and https URLs can be checked.");
  if (url.username || url.password) throw new BlockedUrlError("URLs with credentials aren't allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new BlockedUrlError(`Couldn't resolve ${host}.`);
  for (const ip of addresses) {
    const why = blockedReason(ip);
    if (why) throw new BlockedUrlError(`${host} points to a ${why}, which can't be checked.`);
  }
  return { url, address: addresses[0], family: isIP(addresses[0]) === 6 ? 6 : 4 };
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  return (await vetUrl(raw)).url;
}

/** A DNS lookup that always answers with the address we already vetted: the socket connects there and nowhere else. */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/** Lenient like fetch: an empty or truncated compressed body decodes to what's there instead of failing. */
const ZLIB_LENIENT = { flush: constants.Z_SYNC_FLUSH, finishFlush: constants.Z_SYNC_FLUSH };
const BROTLI_LENIENT = { flush: constants.BROTLI_OPERATION_FLUSH, finishFlush: constants.BROTLI_OPERATION_FLUSH };

function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const unzip =
    encoding === "gzip" || encoding === "x-gzip"
      ? createGunzip(ZLIB_LENIENT)
      : encoding === "deflate"
        ? createInflate(ZLIB_LENIENT)
        : encoding === "br"
          ? createBrotliDecompress(BROTLI_LENIENT)
          : null;
  if (!unzip) return res;
  return pipeline(res, unzip, () => undefined);
}

async function readCapped(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.byteLength;
    if (size > MAX_BYTES) break; // leaving the loop destroys the stream
    chunks.push(buf);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

interface FetchInit {
  method?: "GET" | "POST" | "DELETE";
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** One request, connected only to the vetted address (no pooled sockets, no second DNS lookup). */
function pinnedRequest(target: Vetted, init: FetchInit): Promise<Omit<Fetched, "url">> {
  const { url, address, family } = target;
  const signal = AbortSignal.timeout(init.timeoutMs ?? 8000);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const fail = (e: unknown) => reject(signal.aborted ? Object.assign(new Error("timed out"), { name: "TimeoutError" }) : e);
    const req = client.request(
      url,
      {
        method: init.method ?? "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
          ...init.headers,
          ...(init.body !== undefined ? { "content-length": String(Buffer.byteLength(init.body)) } : {}),
        },
        lookup: pinnedLookup(address, family),
        agent: false,
        signal,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && headers.location) {
          res.destroy();
          resolve({ status, headers, body: "" });
          return;
        }
        readCapped(decoded(res)).then((body) => resolve({ status, headers, body }), fail);
      },
    );
    req.on("error", fail);
    req.end(init.body);
  });
}

/** GET (or POST) a public URL, following redirects manually so every hop is re-checked. Never throws. */
export async function safeFetch(raw: string, init: FetchInit = {}): Promise<Fetched> {
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await vetUrl(current);
      const res = await pinnedRequest(target, init);
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        current = new URL(res.headers.location, target.url).href;
        continue;
      }
      return { url: target.url.href, ...res };
    }
    return { url: current, status: 0, headers: {}, body: "", error: "too many redirects" };
  } catch (e) {
    const msg = e instanceof BlockedUrlError ? e.message : e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : String(e);
    return { url: current, status: 0, headers: {}, body: "", error: msg.slice(0, 200) };
  }
}
