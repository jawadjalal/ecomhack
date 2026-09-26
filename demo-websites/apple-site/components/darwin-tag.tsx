import Script from "next/script";

/**
 * Darwin's analytics tag. Configure with NEXT_PUBLIC_DARWIN_URL (default http://localhost:3000; "off" to
 * disable, e.g. once Darwin's GitHub install PR has added its own tag to app/layout.tsx) and
 * NEXT_PUBLIC_DARWIN_SITE (default "orchard").
 *
 * darwin.js records page views, clicks and rage clicks, and loads Darwin's web personalization runtime
 * for this site id. Commerce events come from lib/track.ts.
 */
export const DARWIN_URL = (process.env.NEXT_PUBLIC_DARWIN_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
export const DARWIN_SITE = (process.env.NEXT_PUBLIC_DARWIN_SITE ?? "orchard").trim() || "orchard";
export const DARWIN_ENABLED = DARWIN_URL !== "" && DARWIN_URL.toLowerCase() !== "off";

export function DarwinTag() {
  if (!DARWIN_ENABLED) return null;
  return <Script src={`${DARWIN_URL}/darwin.js`} data-darwin-site={DARWIN_SITE} strategy="afterInteractive" />;
}
