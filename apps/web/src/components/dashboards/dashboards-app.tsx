"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowUp, Bot, Check, Globe, LoaderCircle, Radio, Sparkles, WandSparkles } from "lucide-react";
import type { DashboardsResponse, TrackingPlan, WebSimulateResponse } from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/switch";
import { DarwinWordmark } from "@/components/console/brand";
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
          el?.animate([{ boxShadow: "0 0 0 2px rgba(182,240,90,0.9)" }, { boxShadow: "0 0 0 2px rgba(182,240,90,0)" }], { duration: 1800 });
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

  return (
    <div data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[110rem] flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/console" className="flex items-center gap-2 rounded-lg pr-2 text-white/60 hover:text-white" title="Back to mission control">
            <ArrowLeft className="size-4" />
            <DarwinWordmark sub="dashboards" />
          </Link>
          <div className="h-7 w-px bg-white/10" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("site");
              if (typeof v === "string" && /^[\w.-]{1,64}$/.test(v)) {
                setSite(v);
                window.history.replaceState(null, "", `?site=${encodeURIComponent(v)}`);
              }
            }}
            className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] text-white/60"
          >
            <Globe className="size-4 text-white/45" />
            Site
            <input name="site" defaultValue={site} placeholder="site id" className="w-44 bg-transparent font-medium text-white/90 outline-none" aria-label="Site" />
          </form>
          {data?.plan && (
            <span className="hidden text-[0.8rem] text-white/45 lg:inline">
              {data.plan.repo ?? data.site}
              {data.plan.framework ? ` · ${data.plan.framework}` : ""} · {data.plan.events.filter((e) => e.enabled).length} events · plan by {data.plan.author}
            </span>
          )}
          <div className="flex-1" />
          {!!data && data.totalEvents - data.syntheticEvents > 0 && (
            <Badge tone="good" title="Events from real visitors (not simulated)">
              <Radio /> {(data.totalEvents - data.syntheticEvents).toLocaleString("en-GB")} real {data.totalEvents - data.syntheticEvents === 1 ? "event" : "events"}
            </Badge>
          )}
          {!!data?.syntheticEvents && (
            <Badge tone="warn" title="Events generated by Darwin's simulator (properties.synthetic = true)">
              <Bot /> {data.syntheticEvents.toLocaleString("en-GB")} of {data.totalEvents.toLocaleString("en-GB")} events simulated
            </Badge>
          )}
          <Button
            size="md"
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
            {busy ? <LoaderCircle className="animate-spin" /> : <Bot />}
            +300 simulated
          </Button>
          <Toggle on={traffic} onChange={setTraffic} tone="human" icon={<Activity />} label="Traffic" title="Simulated shoppers every 3 s, labelled synthetic" />
          <Link
            href={`/console/personalize?site=${encodeURIComponent(site)}`}
            className="flex h-10 items-center gap-2 rounded-xl border border-brand/25 bg-brand/[0.07] px-3 text-[0.85rem] font-medium text-brand hover:bg-brand/[0.14]"
          >
            <WandSparkles className="size-4" /> Personalize
          </Link>
        </header>

        {!site && (
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[0.9rem] text-white/60">
            Pick a site, or <Link href="/onboarding" className="text-brand underline-offset-2 hover:underline">set one up</Link>: Darwin plans what to record and builds these dashboards from it.
          </p>
        )}
        {site && !data?.plan && data && (
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[0.9rem] text-white/60">
            No tracking plan for <b className="text-white">{site}</b> yet, so these are the default dashboards.{" "}
            <Link href="/onboarding" className="text-brand underline-offset-2 hover:underline">Plan it in onboarding</Link>.
          </p>
        )}
        {error && <p className="rounded-xl border border-bad/30 bg-bad/[0.08] px-4 py-2 text-[0.85rem] text-[#ffb4b4]">{error}</p>}
        {data?.plan && (
          <div className="flex flex-col gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                askForChart(ask);
              }}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0b0d12]/85 p-2 pl-4 focus-within:border-brand/40"
            >
              <Sparkles className="size-4 shrink-0 text-brand/80" />
              <input
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Ask for a chart: “coupon codes per minute”, “mobile vs desktop”, “funnel from product view to order”"
                aria-label="Ask for a chart"
                className="h-10 min-w-0 flex-1 bg-transparent text-[0.95rem] text-white outline-none placeholder:text-white/30"
              />
              <button type="submit" disabled={asking || !ask.trim()} aria-label="Add chart" className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-[#0b1200] hover:bg-[#c8f77c] disabled:opacity-30">
                {asking ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-1.5">
              {["Wishlist adds per minute", "Mobile vs desktop", "Where do shoppers come from", "Revenue per minute"].map((q) => (
                <button key={q} onClick={() => askForChart(q)} disabled={asking} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[0.78rem] text-white/55 hover:border-white/20 hover:text-white disabled:opacity-40">
                  {q}
                </button>
              ))}
              {reply && (
                <span className="ml-1 flex items-center gap-1.5 text-[0.8rem] text-[#a6efbf]">
                  <Check className="size-3.5" /> {reply}
                </span>
              )}
            </div>
          </div>
        )}
        {data && <DashboardGrid dashboards={data.dashboards} onRemove={removeChart} />}
      </div>
    </div>
  );
}
