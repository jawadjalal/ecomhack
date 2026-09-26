import Script from "next/script";
import { darwinTag } from "@/lib/config";

/**
 * Darwin's tag (analytics for humans + AI agents, plus the web-personalization runtime it loads).
 * Configured with DARWIN_URL / DARWIN_SITE (see .env.example); DARWIN_URL=off renders nothing.
 *
 * It lives in this component rather than in app/layout.tsx on purpose: when this folder is its own
 * repo, Darwin's "connect your repo" install PR still finds a layout without the tag and adds one.
 * If both end up loaded, darwin.js runs once (the second copy exits early).
 */
export function DarwinTag() {
  const tag = darwinTag();
  if (!tag) return null;
  return <Script src={tag.src} data-darwin-site={tag.site} strategy="afterInteractive" />;
}
