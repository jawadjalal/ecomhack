"use client";

/**
 * "Darwin's watch": last check, what the team looked at, signals found against messages sent (he stays quiet
 * on purpose), and when the next check is. A signal opens the group chat the team used, or the Inbox.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { WatchRun, WatchStateResponse } from "@/lib/contracts/watch";
import { cn } from "@/components/ui/cn";

function ago(iso: string | undefined, now: number): string {
  if (!iso) return "not yet";
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function until(iso: string | undefined, now: number): string {
  if (!iso) return "when you ask";
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
  if (mins < 1) return "any moment";
  return mins < 60 ? `in ${mins} min` : `in ${Math.round(mins / 60)}h`;
}

export function WatchStrip() {
  const [state, setState] = useState<WatchStateResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let stop = false;
    const load = () => {
      fetch("/api/team/watch", { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: WatchStateResponse | null) => {
          if (!stop && body?.runs) setState(body);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(() => {
      setNow(Date.now());
      load();
    }, 15000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const run: WatchRun | undefined = state?.runs[0];
  const looked = run?.checks.filter((c) => c.ok).map((c) => c.label) ?? [];
  const quiet = (state?.signalsToday ?? 0) > (state?.messagesToday ?? 0);

  return (
    <section aria-label="Darwin’s watch" className="flex flex-col gap-2 rounded-[22px] border border-dw-hairline bg-dw-surface px-5 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] font-semibold tracking-[-0.01em]">
          Darwin’s watch
          <span className="ml-2 font-normal text-dw-ink/60">{state ? `last check ${ago(state.lastRunAt, now)}` : "checking…"}</span>
        </p>
        <p className="text-[13px] text-dw-ink/60">
          {state?.signalsToday ?? 0} signal{(state?.signalsToday ?? 0) === 1 ? "" : "s"}, {state?.messagesToday ?? 0} message{(state?.messagesToday ?? 0) === 1 ? "" : "s"}
          {quiet ? " · staying quiet on purpose" : ""}
          {" · "}next {until(state?.nextRunAt, now)}
        </p>
      </div>
      {run && (
        <p className="text-[13px] leading-snug text-dw-ink/70">
          Looked at {looked.length ? looked.join(", ") : "nothing this pass"}.
          {run.checks.some((c) => !c.ok) ? ` Couldn't check ${run.checks.filter((c) => !c.ok).map((c) => c.label).join(", ")}.` : ""}
        </p>
      )}
      {run && run.signals.length > 0 && (
        <ul className="flex flex-col">
          {run.signals.slice(0, 4).map((signal) => {
            const href = signal.chatId ? `/console/inbox?chat=${signal.chatId}` : "/console/inbox";
            return (
              <li key={signal.id}>
                <Link href={href} className="flex items-baseline gap-2 rounded-lg px-1 py-1 text-[13.5px] hover:bg-dw-ink/[0.04]">
                  <span className={cn("size-1.5 shrink-0 rounded-full", signal.severity === "high" || signal.severity === "urgent" ? "bg-dw-warn" : "bg-dw-ink/40")} />
                  <span className="min-w-0 flex-1 truncate">{signal.title}</span>
                  {signal.synthetic && <span className="shrink-0 text-[12px] text-dw-ink/45">simulated</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
