"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Globe, LoaderCircle, Users, WandSparkles } from "lucide-react";
import type { DashboardsResponse, TrackingPlan, WebSimulateResponse } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { Mascot } from "@/components/dw/mascot";
import { Card, Empty, PageHead, PillButton, Tag } from "@/components/dw/ui";
import { SwitchPill } from "@/components/dw/agents/switch";
import { DashboardGrid } from "./dashboard-grid";

async function get<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

const ASK_CHIPS = ["Wishlist adds per minute", "Mobile vs desktop", "Where do shoppers come from", "Revenue per minute"];

/** Where the plan's store lives, for people: "trail-shop.co.uk", "acme/storefront", or the site id. */
function storeName(plan: TrackingPlan): string {
  if (plan.repo) return plan.repo;
  if (plan.siteUrl) {
    try {
      return new URL(plan.siteUrl).host.replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return plan.site;
}

export function DashboardsApp({ initialSite }: { initialSite: string }) {
  const [site, setSite] = useState(initialSite);
  const [data, setData] = useState<DashboardsResponse>();
  const [error, setError] = useState<string>();
  const [traffic, setTraffic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [reply, setReply] = useState<string>();
  const ticking = useRef(false);

  const load = useCallback(async () => {
    if (!site) return;
    try {
      setData(await get<DashboardsResponse>(`/api/dashboards?site=${encodeURIComponent(site)}`));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  // The plan's goal events, as a stable string so the simulator callback doesn't change every poll.
  const goalsKey = (data?.plan?.events ?? [])
    .filter((e) => e.enabled && e.category === "goal")
    .map((e) => e.name)
    .slice(0, 12)
    .join(",");
  const simulate = useCallback(
    async (visitors: number) => {
      await get<WebSimulateResponse>("/api/web/simulate", { site, visitors, events: goalsKey ? goalsKey.split(",") : [] });
      await load();
    },
    [site, load, goalsKey],
  );

  const askForChart = async (message: string) => {
    if (!message.trim() || asking) return;
    setAsking(true);
    try {
      const res = await get<{ plan: TrackingPlan; reply: string; id?: string }>("/api/dashboards", { site, message });
      setReply(res.reply);
      setAsk("");
      await load();
      if (res.id) {
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>(`[data-dashboard="${res.id}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          el?.animate([{ boxShadow: "0 0 0 3px #141413" }, { boxShadow: "0 0 0 3px rgba(20,20,19,0)" }], { duration: 1800 });
        }, 150);
      }
    } catch (e) {
      setReply((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const removeChart = async (id: string) => {
    await get("/api/dashboards", { site, remove: id }).catch(() => undefined);
    await load();
  };

  useEffect(() => {
    if (!traffic) return;
    const t = setInterval(async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        await simulate(150);
      } catch {
        setTraffic(false);
      } finally {
        ticking.current = false;
      }
    }, 3000);
    return () => clearInterval(t);
  }, [traffic, simulate]);

  const plan = data?.plan;
  const real = data ? data.totalEvents - data.syntheticEvents : 0;
  const enabled = plan?.events.filter((e) => e.enabled).length ?? 0;
  const lede = !site ? (
    "Pick a site, or set one up: Darwin plans what to record and builds these dashboards from it."
  ) : plan ? (
    <>
      Built from the tracking plan for <b className="font-semibold text-dw-ink">{storeName(plan)}</b>: {enabled} event{enabled === 1 ? "" : "s"}
      {plan.framework ? ` on ${plan.framework}` : ""}, updating live.
    </>
  ) : data ? (
    <>
      No tracking plan for <b className="font-semibold text-dw-ink">{site}</b> yet, so these are the default dashboards.{" "}
      <Link href="/onboarding" className="font-medium text-dw-ink underline underline-offset-2 hover:no-underline">
        Plan it in onboarding
      </Link>
      .
    </>
  ) : (
    "Loading the dashboards…"
  );

  return (
    <>
      <PageHead
        mascot={<Mascot kind="analyst" size={52} frame active />}
        title="Your dashboards"
        lede={lede}
        right={
          <div className="flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get("site");
                if (typeof v === "string" && /^[\w.-]{1,64}$/.test(v)) {
                  setSite(v);
                  setData(undefined);
                  window.history.replaceState(null, "", `?site=${encodeURIComponent(v)}`);
                }
              }}
              className="flex h-10 min-w-0 items-center gap-2 rounded-full bg-dw-sand pr-1 pl-4 text-[14px] text-dw-ink/70 transition-shadow focus-within:shadow-[0_0_0_2px_#141413]"
            >
              <Globe className="size-4 shrink-0" />
              <span className="hidden sm:inline">Site</span>
              <input name="site" defaultValue={site} placeholder="site id" className="w-32 min-w-0 bg-transparent font-medium text-dw-ink outline-none placeholder:text-dw-ink/40 sm:w-44" aria-label="Site" />
              <button type="submit" aria-label="Show this site" className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink">
                <ArrowRight className="size-4" />
              </button>
            </form>
            {site && (
              <PillButton tone="sand" href={`/console/personalize?site=${encodeURIComponent(site)}`}>
                <WandSparkles /> Personalize
              </PillButton>
            )}
          </div>
        }
      />

      {error && (
        <p role="alert" className="rounded-[22px] bg-dw-warn-bg px-5 py-3 text-[14px] text-dw-warn">
          {error}
        </p>
      )}

      {!site ? (
        <Card tone="white" shape="analyst" hover={false}>
          <Empty mascot={<Mascot kind="analyst" size={72} frame active />} action={<PillButton href="/onboarding">Set up a store</PillButton>}>
            No site picked. Type a site id above, or set up a store and Darwin will plan what to record.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {plan ? (
            <div className="flex min-w-0 flex-col justify-center gap-2.5 rounded-[26px] bg-dw-surface p-4 shadow-[0_0_0_1px_#EDE4D2] sm:p-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  askForChart(ask);
                }}
                className="flex h-14 items-center gap-2.5 rounded-full bg-dw-sand pr-2 pl-2.5 transition-shadow focus-within:shadow-[0_0_0_2px_#141413]"
              >
                <Mascot kind="analyst" size={36} active={asking} />
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="Ask for a chart: “coupon codes per minute”, “mobile vs desktop”, “funnel from product view to order”"
                  aria-label="Ask for a chart"
                  className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-dw-ink/45"
                />
                <button
                  type="submit"
                  disabled={asking || !ask.trim()}
                  aria-label="Add chart"
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-[transform,opacity] hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink active:scale-95 disabled:opacity-30"
                >
                  {asking ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
                </button>
              </form>
              <div className="flex flex-wrap items-center gap-1.5">
                {ASK_CHIPS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => askForChart(q)}
                    disabled={asking}
                    className="h-8 rounded-full border border-dw-ink/10 bg-white px-3.5 text-[13px] text-dw-ink/75 transition-colors hover:border-dw-ink/30 hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
              {reply && (
                <p className="flex items-start gap-2 text-[13.5px] leading-snug text-dw-ink/80" aria-live="polite">
                  <Mascot kind="analyst" size={20} active={false} className="mt-[-1px]" />
                  {reply}
                </p>
              )}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-4 rounded-[26px] bg-dw-surface p-5 shadow-[0_0_0_1px_#EDE4D2]">
              <Mascot kind="analyst" size={48} frame active={false} />
              <p className="min-w-0 flex-1 text-[14px] text-dw-ink/75">Once there&apos;s a tracking plan you can ask Darwin for any chart in plain words.</p>
              <PillButton tone="ink" size="sm" href="/onboarding">
                Plan it
              </PillButton>
            </div>
          )}

          <div className="flex min-w-0 flex-col justify-center gap-3 rounded-[26px] bg-dw-sand/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <SwitchPill on={traffic} onChange={setTraffic} label="Traffic" title="Simulated shoppers every 3 s, labelled synthetic" />
              <PillButton
                tone="white"
                disabled={busy || !site}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await simulate(300);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Users />}
                +300 simulated
              </PillButton>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-dw-ink/70">
              {real > 0 && (
                <span title="Events from real visitors (not simulated)">
                  <Tag tone="win">
                    {real.toLocaleString("en-GB")} real {real === 1 ? "event" : "events"}
                  </Tag>
                </span>
              )}
              {!!data?.syntheticEvents && (
                <span title="Events generated by Darwin's simulator (properties.synthetic = true)">
                  <Tag tone="warn">
                    {data.syntheticEvents.toLocaleString("en-GB")} of {data.totalEvents.toLocaleString("en-GB")} events simulated
                  </Tag>
                </span>
              )}
              {data && !data.totalEvents && <span>No events yet. Add simulated shoppers, or wait for real visitors.</span>}
            </div>
          </div>
        </div>
      )}

      {data && site && <DashboardGrid dashboards={data.dashboards} onRemove={removeChart} />}
      {!data && site && !error && (
        <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]")} aria-hidden>
          <div className="h-56 animate-pulse rounded-[26px] bg-dw-sand/70 motion-reduce:animate-none" />
          <div className="h-56 animate-pulse rounded-[26px] bg-dw-sand/70 motion-reduce:animate-none" />
        </div>
      )}
    </>
  );
}
