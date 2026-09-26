/**
 * Visitor country, from the edge's geo-IP headers at ingest time. We never look up IPs ourselves
 * and never store them: only the 2-letter country code the host already computed.
 *
 * Locally there are no such headers, so real visitors show as "Unknown" (never guessed).
 * Simulated visitors get a country from a hash of their id at report time (they are labelled synthetic).
 */
import type { AnalyticsEventInput } from "@/lib/contracts";
import { hashToUnit } from "@/lib/experiments/assign";

const HEADERS = ["x-vercel-ip-country", "cf-ipcountry", "cloudfront-viewer-country", "x-country-code"];

/** 2-letter ISO country from the hosting platform's headers, when there is one. */
export function countryFromHeaders(h: Headers): string | undefined {
  for (const k of HEADERS) {
    const v = h.get(k)?.trim().toUpperCase();
    // XX = unknown, T1 = Tor (Cloudflare).
    if (v && /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1") return v;
  }
  return undefined;
}

/** Stamp the server-side country on events. A country the client sent is never trusted. */
export function withGeo<T extends AnalyticsEventInput>(events: T[], h: Headers): T[] {
  const country = countryFromHeaders(h);
  return events.map((e) => {
    const { $geo_country: _claimed, ...rest } = (e.properties ?? {}) as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...e, properties: country ? { ...rest, $geo_country: country } : rest };
  });
}

/** A UK brand's plausible audience mix, for simulated visitors only. */
const SIM_COUNTRIES: [string, number][] = [
  ["GB", 0.56],
  ["US", 0.12],
  ["IE", 0.06],
  ["DE", 0.05],
  ["FR", 0.04],
  ["NL", 0.04],
  ["AU", 0.04],
  ["CA", 0.04],
  ["ES", 0.03],
  ["IN", 0.02],
];

/** Deterministic per visitor id, and doesn't consume the simulator's random stream. */
export function simulatedCountry(distinctId: string): string {
  let r = hashToUnit(`geo:${distinctId}`);
  return SIM_COUNTRIES.find(([, w]) => (r -= w) < 0)?.[0] ?? "GB";
}

let regionNames: Intl.DisplayNames | undefined;

export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "GB" → 🇬🇧 */
export function countryFlag(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
}
