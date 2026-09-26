import type { Metadata } from "next";
import { DashboardsApp } from "@/components/dashboards/dashboards-app";

export const metadata: Metadata = {
  title: "Darwin · Dashboards",
  description: "The dashboards Darwin built from your tracking plan, live.",
};

/** /console/dashboards?site=… — the dashboards a site's tracking plan asked for, updating live. */
export default async function DashboardsPage({ searchParams }: PageProps<"/console/dashboards">) {
  const sp = await searchParams;
  const site = typeof sp.site === "string" && /^[\w.-]{1,64}$/.test(sp.site) ? sp.site : "";
  return <DashboardsApp initialSite={site} />;
}
