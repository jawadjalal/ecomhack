"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Bot, LoaderCircle, User, WandSparkles, X } from "lucide-react";
import type { DashboardData, FunnelDrill } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { Mascot } from "@/components/dw/mascot";
import { Tag } from "@/components/dw/ui";
import { TrackPill } from "@/components/dw/dashboards/charts";

const pct = (x: number, d = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "–");
const int = (n: number) => n.toLocaleString("en-GB");

async function call<T>(path: string, body?: unknown): Promise<T> {
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

/**
 * The steps to buy, clickable. A step (or the drop into it) opens a drill-down in the card: people vs AI agents
 * who left there, what they did last, three recent journeys, and "Ask Theo to fix this" (saved as a draft only).
 */
export function FunnelSteps({ d, compact, site }: { d: DashboardData; compact?: boolean; site?: string }) {
  const steps = d.steps ?? [];
  const first = steps[0]?.visitors ?? 0;
  const [open, setOpen] = useState<number>();
  const clickable = !!site && !compact;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid items-start gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1].visitors : s.visitors;
          const drop = i && prev ? 1 - s.visitors / prev : 0;
          const last = i === steps.length - 1;
          const inner = (
            <>
              <TrackPill value={s.visitors} max={first} height={compact ? 88 : 100} width={compact ? 24 : 28} label={pct(s.rate)} tip={`${int(s.visitors)} of ${int(first)} visitors`} />
              <span className={cn("mt-2 line-clamp-2 text-[12.5px] leading-tight", last ? "font-semibold" : "text-dw-ink/80")} title={s.event}>
                {s.label}
              </span>
              <span className="num mt-0.5 font-dwmono text-[11.5px] text-dw-ink/60">{int(s.visitors)}</span>
              {i > 0 && drop > 0 && (
                <span
                  className={cn("mt-1 rounded-full px-1.5 text-[11px] font-medium", drop > 0.5 ? "bg-dw-warn-bg text-dw-warn" : "bg-white/60 text-dw-ink/70")}
                  title={`${pct(drop)} drop from the step before`}
                >
                  −{pct(drop)}
                </span>
              )}
            </>
          );
          if (!clickable || i === 0)
            return (
              <div key={s.event} className="flex min-w-0 flex-col items-center py-1.5 text-center">
                {inner}
              </div>
            );
          return (
            <button
              key={s.event}
              type="button"
              onClick={() => setOpen((o) => (o === i ? undefined : i))}
              aria-expanded={open === i}
              aria-label={`Who left before ${s.label}`}
              data-testid={`funnel-step-${i}`}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-[16px] py-1.5 text-center transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink",
                open === i && "bg-white/70 shadow-[0_0_0_1.5px_#141413]",
              )}
            >
              {inner}
            </button>
          );
        })}
      </div>
      {clickable && open === undefined && steps.length > 1 && <p className="text-[12.5px] text-dw-ink/60">Tap a step to see who left before it, and why.</p>}
      {clickable && open !== undefined && steps[open] && (
        <DrillPanel key={open} site={site} dashboardId={d.id} step={open} stamp={steps.map((s) => s.visitors).join(",")} onClose={() => setOpen(undefined)} />
      )}
    </div>
  );
}

function DrillPanel({ site, dashboardId, step, stamp, onClose }: { site: string; dashboardId: string; step: number; stamp: string; onClose: () => void }) {
  const [drill, setDrill] = useState<FunnelDrill>();
  const [error, setError] = useState<string>();
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<{ name: string } | { error: string }>();

  useEffect(() => {
    let live = true;
    call<{ drill: FunnelDrill }>(`/api/dashboards?site=${encodeURIComponent(site)}&drill=${encodeURIComponent(dashboardId)}&step=${step}`)
      .then((r) => {
        if (!live) return;
        setDrill(r.drill);
        setError(undefined);
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [site, dashboardId, step, stamp]);

  const askTheo = async () => {
    if (!drill || drafting) return;
    setDrafting(true);
    try {
      const reason = drill.reasons[0]?.text;
      const prompt = `${pct(drill.share)} of visitors leave between "${drill.from}" and "${drill.to}"${reason ? ` (most often: ${reason})` : ""}. Draft a page change that helps them reach "${drill.to}".`;
      const made = await call<{ rule: unknown }>("/api/web/draft", { site, prompt });
      const saved = await call<{ rule: { id: string; name: string } }>("/api/web/rules", { rule: made.rule, status: "draft" });
      setDraft({ name: saved.rule.name });
    } catch (e) {
      setDraft({ error: (e as Error).message });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <section className="rounded-[20px] border border-dw-hairline bg-dw-surface p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_1px_2px_rgba(20,20,19,0.06)]" aria-live="polite" data-testid="funnel-drill">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-dw-ink/60">Left between</p>
          <h4 className="text-[16px] leading-snug font-semibold">
            {drill ? (
              <>
                {drill.from} <ArrowRight className="inline size-3.5 -translate-y-px" /> {drill.to}
              </>
            ) : (
              "Loading…"
            )}
          </h4>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-dw-ink/60 hover:bg-dw-sand hover:text-dw-ink">
          <X className="size-4" />
        </button>
      </div>
      {error && <p className="mt-2 text-[13.5px] text-dw-warn">{error}</p>}
      {drill && (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="num text-[26px] leading-none font-semibold tracking-[-0.02em]">{int(drill.dropped)}</div>
              <div className="mt-1 text-[12.5px] text-dw-ink/60">left, {pct(drill.share)} of {int(drill.previous)}</div>
            </div>
            <div className="flex items-center gap-1.5 text-[14px]">
              <User className="size-4 text-dw-ink/60" /> <b className="num font-semibold">{int(drill.humans)}</b> people
            </div>
            <div className="flex items-center gap-1.5 text-[14px]">
              <Bot className="size-4 text-dw-ink/60" /> <b className="num font-semibold">{int(drill.agents)}</b> AI agents
            </div>
            {drill.simulated > 0 && (
              <Tag tone="warn">
                {drill.simulated === drill.dropped ? "All simulated" : `${int(drill.simulated)} simulated`}
              </Tag>
            )}
          </div>
          {drill.dropped === 0 ? (
            <p className="mt-3 text-[14px] text-dw-ink/70">Nobody left here yet.</p>
          ) : (
            <div className="mt-3 grid gap-3 @xl:grid-cols-2">
              <div className="min-w-0 rounded-[16px] border border-dw-hairline p-3">
                <p className="text-[12.5px] text-dw-ink/60">Top reasons</p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {drill.reasons.map((r) => (
                    <li key={r.text} className="flex items-start justify-between gap-3 text-[13.5px] leading-snug">
                      <span className="min-w-0 break-words">{r.text}</span>
                      <span className="num shrink-0 font-dwmono text-[12px] text-dw-ink/60">{int(r.count)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0 rounded-[16px] border border-dw-hairline p-3">
                <p className="text-[12.5px] text-dw-ink/60">Recent journeys that stopped here</p>
                <ul className="mt-1.5 flex flex-col gap-2">
                  {drill.journeys.map((j) => (
                    <li key={j.id} className="text-[13px] leading-snug">
                      <span className="flex items-center gap-1.5 font-medium">
                        {j.kind === "agent" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                        {j.kind === "agent" ? "AI agent" : "Shopper"} {j.id.slice(-6)}
                        {j.simulated && <span className="text-[11.5px] font-normal text-dw-warn">simulated</span>}
                      </span>
                      <span className="block break-words text-dw-ink/70">{j.steps.join(" → ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {drill.dropped > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={askTheo}
                disabled={drafting || (!!draft && "name" in draft)}
                data-testid="ask-theo"
                className="inline-flex h-10 items-center gap-2 rounded-full bg-dw-ink px-4 text-[14px] font-medium text-white transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                {drafting ? <LoaderCircle className="size-4 animate-spin" /> : <Mascot kind="designer" size={20} active={false} />}
                Ask Theo to fix this
              </button>
              {draft && "name" in draft && (
                <p className="flex items-center gap-1.5 text-[13.5px]" data-testid="draft-saved">
                  <WandSparkles className="size-4" /> Draft saved, not live: “{draft.name}”.{" "}
                  <Link href={`/console/personalize?site=${encodeURIComponent(site)}`} className="font-medium underline underline-offset-2">
                    Review in Personalize
                  </Link>
                </p>
              )}
              {draft && "error" in draft && <p className="text-[13.5px] text-dw-warn">{draft.error}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
