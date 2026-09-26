"use client";

/**
 * Dashboards and Personalize are per site. Opened without ?site=, they show the merchant's own site when
 * onboarding made a tracking plan for it in this tab (a script tag or a GitHub repo), else the last site this
 * browser set up (lib/tracking/remember.ts, survives new tabs), else the demo site.
 * ?site= in the URL always wins. The URL is updated so a reload keeps the same site.
 */
import { useEffect } from "react";
import { DashboardsApp } from "@/components/dashboards/dashboards-app";
import { PersonalizeApp } from "@/components/web/personalize-app";
import { recallLastSite } from "@/lib/tracking/remember";
import { DEMO_WEB_SITE, useStoreContext } from "./store-context";

function usePickedSite(urlSite: string | undefined, fallback: string): string | undefined {
  const store = useStoreContext();
  // store.ready is false on the server and the first client render, so localStorage is only read after hydration.
  const site = urlSite || (store.ready ? (store.site ?? recallLastSite()?.site ?? fallback) : undefined);
  useEffect(() => {
    if (urlSite || !site) return;
    try {
      window.history.replaceState(null, "", `?site=${encodeURIComponent(site)}`);
    } catch {
      /* history blocked: the page still shows the site */
    }
  }, [urlSite, site]);
  return site;
}

function Waiting() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-4">
      <div className="h-14 w-[min(520px,90%)] animate-pulse rounded-full bg-dw-sand/70 motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-[26px] bg-dw-sand/70 motion-reduce:animate-none" />
    </div>
  );
}

export function DashboardsForStore({ urlSite }: { urlSite?: string }) {
  const site = usePickedSite(urlSite, DEMO_WEB_SITE);
  if (!site) return <Waiting />;
  return <DashboardsApp key={site} initialSite={site} />;
}

export function PersonalizeForStore({ urlSite, fallback, origin }: { urlSite?: string; fallback: string; origin: string }) {
  const site = usePickedSite(urlSite, fallback);
  if (!site) return <Waiting />;
  return <PersonalizeApp key={site} initialSite={site} origin={origin} />;
}
