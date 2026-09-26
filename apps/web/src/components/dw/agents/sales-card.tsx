"use client";

import type { AgentFunnel } from "@/lib/store-agent";
import { Card, CardTitle, HBar, Tag } from "@/components/dw/ui";
import { TrackPill } from "@/components/dw/dashboards/charts";
import { BuyerAvatar } from "./avatars";

export const money = (minor: number, currency = "gbp") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(minor / 100);

const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/** Agent sales: paid conversion, the conversation → payment funnel, and which agents buy. */
export function SalesCard({ funnel: f }: { funnel?: AgentFunnel }) {
  const steps = f
    ? [
        { label: "Talked to it", n: f.conversations },
        { label: "Saw offers", n: f.offersShown },
        { label: "Checkout link", n: f.checkouts },
        { label: "Paid", n: f.paid },
      ]
    : [];
  const top = steps[0]?.n ?? 0;
  const agents = (f?.byAgent ?? []).slice(0, 4).map((a) => ({
    ...a,
    rate: a.conversations ? a.paid / a.conversations : 0,
  }));
  const best = Math.max(0.01, ...agents.map((a) => a.rate));

  return (
    <Card tone="yellow" shape="shipper" corner="tr" className="flex min-w-0 flex-col p-5 sm:p-6 [&>div.relative]:flex [&>div.relative]:flex-1 [&>div.relative]:flex-col">
      <CardTitle
        right={
          !!f?.simulated && (
            <span title="Chats from Darwin's simulated buyer agents, kept apart from real ones">
              <Tag tone="warn">
                {f.simulated.toLocaleString("en-GB")} of {f.conversations.toLocaleString("en-GB")} simulated
              </Tag>
            </span>
          )
        }
      >
        Agent sales
      </CardTitle>

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="num text-[40px] leading-none font-semibold tracking-[-0.03em]">{f ? `${Math.round(f.conversion * 100)}%` : "–"}</div>
          <div className="mt-1 text-[13px] text-dw-ink/70">of agent conversations end in a payment</div>
        </div>
        <div className="flex gap-5 pb-0.5">
          <div>
            <div className="num text-[20px] leading-tight font-semibold">{f ? money(f.revenue) : "–"}</div>
            <div className="text-[12px] tracking-[0.02em] text-dw-ink/70 uppercase">Revenue</div>
          </div>
          <div>
            <div className="num text-[20px] leading-tight font-semibold">{f ? f.paid.toLocaleString("en-GB") : "–"}</div>
            <div className="text-[12px] tracking-[0.02em] text-dw-ink/70 uppercase">Paid</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 items-start gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex min-w-0 flex-col items-center text-center">
            <TrackPill
              value={s.n}
              max={top}
              height={60}
              width={26}
              label={s.n.toLocaleString("en-GB")}
              tip={top ? `${Math.round((s.n / top) * 100)}% of conversations` : "No conversations yet"}
              emphasis={i === steps.length - 1 || undefined}
            />
            <span className={i === steps.length - 1 ? "mt-1.5 text-[12px] leading-tight font-semibold" : "mt-1.5 text-[12px] leading-tight text-dw-ink/75"}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[20px] bg-white/45 px-3.5 py-3">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-semibold">By agent</span>
          <span className="text-[12px] text-dw-ink/60">{(f?.byAgent.length ?? 0) > agents.length ? `busiest ${agents.length} of ${f?.byAgent.length}` : "paid · higher is better"}</span>
        </div>
        {!agents.length ? (
          <p className="py-2 text-[13.5px] text-dw-ink/65">No agent has shopped yet. Run a simulated buyer, or connect your own agent.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((a) => (
              <li
                key={a.agent}
                className="dw-row grid grid-cols-[26px_minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-2.5 py-[3px]"
                title={`${a.conversations} conversations → ${a.checkouts} checkout links → ${a.paid} paid`}
              >
                <span className="dw-tilt">
                  <BuyerAvatar name={a.agent} size={24} />
                </span>
                <span className="truncate text-[13.5px] font-medium">{a.agent}</span>
                <HBar value={a.rate / best} dashed={a.paid === 0} className="h-2.5" />
                <span className="num text-right font-dwmono text-[12.5px]">
                  {a.paid}/{a.conversations}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!!f?.recent.length && (
        <div className="relative mt-3 h-40 lg:h-auto lg:min-h-12 lg:flex-1" aria-label="Latest agent sales">
          <div className="absolute inset-0 overflow-hidden">
            <div className="mb-1 flex items-baseline justify-between gap-3 px-1">
              <span className="text-[13px] font-semibold">Just now</span>
              <span className="text-[11.5px] text-dw-ink/55">checkout links and payments</span>
            </div>
            <ul className="flex flex-col">
              {f.recent.slice(0, 6).map((r, i) => (
                <li key={`${i}-${r.at}-${r.ref}-${r.step}`} className="flex items-center gap-2 px-1 py-[3px] text-[12.5px]">
                  <span className={r.step === "paid" ? "size-1.5 shrink-0 rounded-full bg-dw-ink" : "size-1.5 shrink-0 rounded-full border border-dw-ink/60"} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{r.agent}</span> <span className="text-dw-ink/65">{r.step === "paid" ? "paid" : "got a checkout link"}</span>
                  </span>
                  {!!r.price && <span className="num shrink-0 font-dwmono text-[11.5px]">{money(r.price)}</span>}
                  <span className="num w-14 shrink-0 text-right font-dwmono text-[11px] text-dw-ink/50">{ago(r.at)}</span>
                </li>
              ))}
            </ul>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-dw-yellow to-transparent" />
          </div>
        </div>
      )}
    </Card>
  );
}
