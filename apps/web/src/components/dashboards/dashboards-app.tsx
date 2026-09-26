"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, Globe, LoaderCircle, Plus, Sparkles, Users, WandSparkles, X } from "lucide-react";
import type { DashboardsResponse, TrackingPlan, WebSimulateResponse } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { Mascot } from "@/components/dw/mascot";
import { Card, Empty, PageHead, PillButton, Tag } from "@/components/dw/ui";
import { SwitchPill } from "@/components/dw/agents/switch";
import { recallLastSite, recallPlan, recallSimulated, rememberPlan, rememberSimulated, rememberSite } from "@/lib/tracking/remember";
import { DashboardGrid } from "./dashboard-grid";
import { useLiveInterval } from "@/lib/console/live";
import { boardNames, boardsFor } from "@/lib/tracking/boards";

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

/** The simulator's per-call cap (lib/web MAX_SIM_VISITORS). */
const MAX_RESEND = 2000;
/** Don't retry a restore / re-send more often than this while polling. */
const HEAL_EVERY_MS = 5000;

const ASK_CHIPS = ["Orders per day by device", "How many orders today", "Do shoppers come back", "Where do people go after the product page", "When do people shop", "How long do people take to buy"];

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
  const [ideas, setIdeas] = useState(false);
  const [restoredNote, setRestoredNote] = useState<string>();
  const [board, setBoardState] = useState("Overview");
  const [naming, setNaming] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [making, setMaking] = useState(false);
  const ticking = useRef(false);
  const restoredAt = useRef(0);
  const resentAt = useRef(0);

  // No ?site=: open on the site this browser set up last (lib/tracking/remember.ts), not an empty box.
  useEffect(() => {
    if (initialSite) return;
    const t = setTimeout(() => {
      const last = recallLastSite();
      if (last) setSite((cur) => cur || last.site);
    }, 0);
    return () => clearTimeout(t);
  }, [initialSite]);

  // ?board= picks the tab (read after mount so the server and first client render agree).
  useEffect(() => {
    const t = setTimeout(() => {
      const b = new URLSearchParams(window.location.search).get("board");
      if (b) setBoardState(b.slice(0, 40));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const setBoard = useCallback((b: string) => {
    setBoardState(b);
    const q = new URLSearchParams(window.location.search);
    if (b === "Overview") q.delete("board");
    else q.set("board", b);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  const load = useCallback(async () => {
    if (!site) return;
    try {
      setData(await get<DashboardsResponse>(`/api/dashboards?site=${encodeURIComponent(site)}`));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [site]);

  const every = useLiveInterval(5000);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = every ? setInterval(load, every) : undefined;
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load, every]);

  // The plan's goal events, as a stable string so the simulator callback doesn't change every poll.
  const goalsKey = (data?.plan?.events ?? [])
    .filter((e) => e.enabled && e.category === "goal")
    .map((e) => e.name)
    .slice(0, 12)
    .join(",");
  const simulate = useCallback(
    async (visitors: number) => {
      const res = await get<WebSimulateResponse>("/api/web/simulate", { site, visitors, events: goalsKey ? goalsKey.split(",") : [] });
      rememberSimulated(site, res.visitors);
      await load();
    },
    [site, load, goalsKey],
  );

  // Vercel runs several instances, each with its own memory: the one answering may not have the plan (or the
  // simulated shoppers) onboarding made on another. Keep the browser's copy fresh, and send it back when missing.
  useEffect(() => {
    if (!data || !site || data.site !== site) return;
    if (data.plan) {
      rememberPlan(data.plan);
      rememberSite(site, data.plan.siteUrl);
    }
    if (!data.plan) {
      const saved = recallPlan(site);
      if (!saved || Date.now() - restoredAt.current < HEAL_EVERY_MS) return;
      restoredAt.current = Date.now();
      get<{ restored: boolean; plan: TrackingPlan }>("/api/onboarding/restore", { plan: saved })
        .then(() => load())
        .catch(() => undefined);
      return;
    }
    const sims = recallSimulated(site);
    if (data.totalEvents > 0 || sims <= 0 || Date.now() - resentAt.current < HEAL_EVERY_MS) return;
    resentAt.current = Date.now();
    const goals = data.plan.events.filter((e) => e.enabled && e.category === "goal").map((e) => e.name).slice(0, 12);
    get<WebSimulateResponse>("/api/web/simulate", { site, visitors: Math.min(sims, MAX_RESEND), events: goals })
      .then((res) => {
        const n = res.visitors;
        setRestoredNote(`Restored your ${n.toLocaleString("en-GB")} simulated shoppers (simulated)`);
        return load();
      })
      .catch(() => undefined);
  }, [data, site, load]);

  const askForChart = async (message: string) => {
    if (!message.trim() || asking) return;
    setAsking(true);
    try {
      const res = await get<{ plan: TrackingPlan; reply: string; id?: string }>("/api/dashboards", { site, message, board });
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

  const makeBoard = async (name: string) => {
    if (name.trim().length < 2 || making) return;
    setMaking(true);
    try {
      const res = await get<{ reply: string; board: string; ids: string[] }>("/api/dashboards", { site, newBoard: name.trim() });
      setReply(res.reply);
      setBoardName("");
      setNaming(false);
      await load();
      if (res.ids.length) setBoard(res.board);
    } catch (e) {
      setReply((e as Error).message);
    } finally {
      setMaking(false);
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
  const tabs = boardNames(plan?.dashboards ?? []);
  if (!tabs.includes(board)) tabs.push(board);
  const shown = (data?.dashboards ?? []).filter((d) => boardsFor(d).includes(board));
  const real = data ? data.totalEvents - data.syntheticEvents : 0;
  const enabled = plan?.events.filter((e) => e.enabled).length ?? 0;
  const honesty = data && (
    <span className="inline-flex translate-y-[-2px] flex-wrap items-center gap-1.5 align-middle">
      {real > 0 && (
        <span title="Events from real visitors (not simulated)">
          <Tag tone="win">
            {real.toLocaleString("en-GB")} real {real === 1 ? "event" : "events"}
          </Tag>
        </span>
      )}
      {!!data.syntheticEvents && (
        <span title="Events made by Darwin's simulator, kept apart from real ones">
          <Tag tone="warn">
            {data.syntheticEvents.toLocaleString("en-GB")} of {data.totalEvents.toLocaleString("en-GB")} events simulated
          </Tag>
        </span>
      )}
      {!data.totalEvents && <Tag tone="sand">No events yet</Tag>}
    </span>
  );
  const lede = !site ? (
    "Pick a site, or set one up. Darwin plans what to record and builds these dashboards from it."
  ) : plan ? (
    <>
      Built from the tracking plan for <b className="font-semibold text-dw-ink">{storeName(plan)}</b>: {enabled} event{enabled === 1 ? "" : "s"}, updating live.{" "}
      {honesty}
    </>
  ) : data ? (
    <>
      No tracking plan for <b className="font-semibold text-dw-ink">{site}</b> yet, so these are the default dashboards.{" "}
      <Link href="/onboarding" className="font-medium text-dw-ink underline underline-offset-2 hover:no-underline">
        Plan it in onboarding
      </Link>
      . {honesty}
    </>
  ) : (
    "Loading the dashboards…"
  );

  return (
    <>
      <PageHead
        mascot={<Mascot kind="leader" size={52} frame active />}
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
                  setBoardState("Overview");
                }
              }}
              className="flex h-10 min-w-0 items-center gap-2 rounded-full bg-dw-sand pr-1 pl-4 text-[14px] text-dw-ink/70 transition-shadow focus-within:shadow-[0_0_0_2px_#141413]"
            >
              <Globe className="size-4 shrink-0" />
              <span className="hidden sm:inline">Site</span>
              <input key={site} name="site" defaultValue={site} placeholder="site id" className="w-32 min-w-0 bg-transparent font-medium text-dw-ink outline-none placeholder:text-dw-ink/40 sm:w-44" aria-label="Site" />
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
      {restoredNote && (
        <p className="flex flex-wrap items-center gap-2 pl-2 text-[13.5px] leading-snug text-dw-ink/80" aria-live="polite" data-testid="restored-simulated">
          <Tag tone="warn">Simulated</Tag>
          {restoredNote}
        </p>
      )}

      {!site ? (
        <Card tone="white" shape="analyst" hover={false}>
          <Empty mascot={<Mascot kind="leader" size={72} frame active />} action={<PillButton href="/onboarding">Set up a store</PillButton>}>
            No site picked. Type a site id above, or set up a store and Darwin will plan what to record.
          </Empty>
        </Card>
      ) : (
        <div className="-mt-1 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {plan ? (
              <div
                className="relative min-w-0 flex-1 basis-[20rem]"
                onFocus={() => setIdeas(true)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIdeas(false);
                }}
                onKeyDown={(e) => e.key === "Escape" && setIdeas(false)}
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setIdeas(false);
                    askForChart(ask);
                  }}
                  className="flex h-12 items-center gap-2.5 rounded-full bg-dw-surface pr-1.5 pl-2 shadow-[0_0_0_1px_#EDE4D2] transition-shadow focus-within:shadow-[0_0_0_2px_#141413]"
                >
                  <Mascot kind="leader" size={32} active={asking} />
                  <input
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    placeholder="Ask for a chart: “coupon codes per minute”, “mobile vs desktop”, “steps from product view to order”"
                    aria-label="Ask for a chart"
                    className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-dw-ink/45"
                  />
                  <button
                    type="submit"
                    disabled={asking || !ask.trim()}
                    aria-label="Add chart"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-[transform,opacity] hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink active:scale-95 disabled:opacity-30"
                  >
                    {asking ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
                  </button>
                </form>
                {ideas && !ask.trim() && (
                  <div
                    role="group"
                    aria-label="Chart ideas"
                    className="absolute top-full left-0 z-30 mt-2 w-full max-w-[34rem] rounded-[22px] bg-dw-surface p-2 shadow-[0_0_0_1px_#EDE4D2,0_24px_50px_-20px_rgba(20,20,19,0.35)]"
                  >
                    <p className="px-3 pt-1.5 pb-1 text-[12.5px] text-dw-ink/60">Try one of these</p>
                    {ASK_CHIPS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => {
                          setIdeas(false);
                          askForChart(q);
                        }}
                        disabled={asking}
                        className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-[14px] transition-colors hover:bg-dw-sand focus-visible:bg-dw-sand focus-visible:outline-none disabled:opacity-40"
                      >
                        <Sparkles className="size-3.5 text-dw-ink/50" /> {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-12 min-w-0 flex-1 basis-[20rem] items-center gap-3 rounded-full bg-dw-surface pr-1.5 pl-2 shadow-[0_0_0_1px_#EDE4D2]">
                <Mascot kind="leader" size={32} active={false} />
                <p className="min-w-0 flex-1 truncate text-[14px] text-dw-ink/70">With a tracking plan you can ask Darwin for any chart in plain words.</p>
                <PillButton tone="ink" size="sm" href="/onboarding">
                  Plan it
                </PillButton>
              </div>
            )}
            <SwitchPill on={traffic} onChange={setTraffic} label="Traffic" title="Simulated shoppers every 3 s, labelled simulated" className="h-12" />
            <PillButton
              tone="sand"
              className="h-12"
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
          {reply && (
            <p className="flex items-start gap-2 pl-2 text-[13.5px] leading-snug text-dw-ink/80" aria-live="polite">
              <Mascot kind="leader" size={20} active={false} className="mt-[-1px]" />
              {reply}
            </p>
          )}
        </div>
      )}

      {data && site && (
        <nav aria-label="Dashboards" className="flex min-w-0 flex-col gap-2">
          <div className="-mx-1 flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]" role="tablist">
            {tabs.map((b) => {
              const n = data.dashboards.filter((d) => boardsFor(d).includes(b)).length;
              return (
                <button
                  key={b}
                  type="button"
                  role="tab"
                  aria-selected={board === b}
                  data-testid={`board-${b}`}
                  onClick={() => setBoard(b)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink",
                    board === b ? "bg-dw-ink text-white" : "bg-dw-surface text-dw-ink/80 shadow-[0_0_0_1px_#EDE4D2] hover:bg-dw-sand",
                  )}
                >
                  {b}
                  <span className={cn("num font-dwmono text-[11.5px]", board === b ? "text-white/70" : "text-dw-ink/50")}>{n}</span>
                </button>
              );
            })}
            {plan && !naming && (
              <button
                type="button"
                onClick={() => setNaming(true)}
                data-testid="new-board"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-dw-ink/25 px-3.5 text-[14px] font-medium whitespace-nowrap text-dw-ink/80 hover:border-dw-ink/50 hover:text-dw-ink"
              >
                <Plus className="size-4" /> New dashboard
              </button>
            )}
          </div>
          {plan && naming && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                makeBoard(boardName);
              }}
              className="flex h-11 max-w-[34rem] min-w-0 items-center gap-2 rounded-full bg-dw-surface pr-1.5 pl-4 shadow-[0_0_0_1px_#EDE4D2] focus-within:shadow-[0_0_0_2px_#141413]"
            >
              <input
                autoFocus
                value={boardName}
                onChange={(e) => setBoardName(e.target.value)}
                maxLength={40}
                placeholder="What is it for? “my coupon launch”"
                aria-label="New dashboard name"
                data-testid="new-board-name"
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-dw-ink/45"
              />
              <button type="submit" disabled={making || boardName.trim().length < 2} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-dw-ink px-3 text-[13.5px] font-medium text-white disabled:opacity-30">
                {making ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Make it
              </button>
              <button type="button" onClick={() => setNaming(false)} aria-label="Cancel" className="grid size-8 shrink-0 place-items-center rounded-full text-dw-ink/60 hover:bg-dw-sand">
                <X className="size-4" />
              </button>
            </form>
          )}
        </nav>
      )}
      {data && site && (shown.length ? (
        <DashboardGrid dashboards={shown} onRemove={removeChart} site={site} />
      ) : (
        <Card tone="white" shape="analyst" hover={false}>
          <Empty mascot={<Mascot kind="analyst" size={56} frame active={false} />}>
            No charts on “{board}” yet. Ask for a chart above and it lands here.
          </Empty>
        </Card>
      ))}
      {!data && site && !error && (
        <div className={cn("grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]")} aria-hidden>
          <div className="h-56 animate-pulse rounded-[26px] bg-dw-sand/70 motion-reduce:animate-none" />
          <div className="h-56 animate-pulse rounded-[26px] bg-dw-sand/70 motion-reduce:animate-none" />
        </div>
      )}
    </>
  );
}
