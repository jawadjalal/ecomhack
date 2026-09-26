import type { Metadata } from "next";
import { headers } from "next/headers";
import { PersonalizeForStore } from "@/components/dw/site-default";
import { DEMO_SITE, SiteSchema } from "@/lib/web";

export const metadata: Metadata = {
  title: "Darwin · Personalize",
  description: "Change any store page per traffic source and search query, and test it.",
};

/** /console/personalize?site=… — web personalization & experiments for any site running darwin.js. */
export default async function PersonalizePage({ searchParams }: PageProps<"/console/personalize">) {
  const sp = await searchParams;
  const parsed = SiteSchema.safeParse(typeof sp.site === "string" ? sp.site : "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") ? "http" : "https");
  // Without ?site=: the site onboarding set up in this tab, else the demo site.
  return <PersonalizeForStore urlSite={parsed.success ? parsed.data : undefined} fallback={DEMO_SITE} origin={`${proto}://${host}`} />;
}
