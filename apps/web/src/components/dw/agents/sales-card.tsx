"use client";

import type { AgentFunnel } from "@/lib/store-agent";
import { Card, CardTitle, HBar, Tag } from "@/components/dw/ui";
import { TrackPill } from "@/components/dw/dashboards/charts";
import { BuyerAvatar } from "./avatars";

export const money = (minor: number, currency = "gbp") =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(minor / 100);

/** Agent sales: paid conversion, the conversation → payment funnel, and which agents buy. */
export function SalesCard({ funnel: f }: { funnel?: AgentFunnel }) {
  const steps = f
    ? [
        { label: "Talked to it", n: f.conversations },
        { label: "Saw offers", n: f.offersShown },
        { label: "Got a checkout link", n: f.checkouts },
        { label: "Paid", n: f.paid },
      ]
    : [];
  const top = steps[0]?.n ?? 0;
  const agents = (f?.byAgent ?? []).slice(0, 6).map((a) => ({ ...a, rate: a.conversations ? a.paid / a.conversations : 0 }));
  const best = Math.max(0.01, ...agents.map((a) => a.rate));

  return (
    <Card tone="yellow" shape="shipper" corner="tr" className="min-w-0">
      <CardTitle
        right={
          !!f?.simulated && (
            <span title="Conversations from Darwin's simulated buyer agents (properties.synthetic = true)">
              <Tag tone="warn">
                {f.simulated.toLocaleString("en-GB")} of {f.conversations.toLocaleString("en-GB")} simulated
              </Tag>
            </span>
          )
        }
      >
        Agent sales
      </CardTitle>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="num text-[46px] leading-none font-semibold tracking-[-0.03em]">{f ? `${Math.round(f.conversion * 100)}%` : "–"}</div>
          <div className="mt-1.5 text-[13.5px] text-dw-ink/70">of agent conversations end in a payment</div>
        </div>
        <div className="flex gap-6 pb-1">
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

      <div className="mt-6 grid grid-cols-4 items-start gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex min-w-0 flex-col items-center text-center">
            <TrackPill
              value={s.n}
              max={top}
              height={104}
              width={28}
              label={s.n.toLocaleString("en-GB")}
              tip={top ? `${Math.round((s.n / top) * 100)}% of conversations` : "No conversations yet"}
              emphasis={i === steps.length - 1 || undefined}
            />
            <span className={i === steps.length - 1 ? "mt-2 text-[12.5px] leading-tight font-semibold" : "mt-2 text-[12.5px] leading-tight text-dw-ink/75"}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-[22px] bg-white/45 p-4">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-semibold">By agent</span>
          <span className="text-[12px] text-dw-ink/60">paid · higher is better</span>
        </div>
        {!agents.length ? (
          <p className="py-2 text-[13.5px] text-dw-ink/65">No agent has shopped yet. Run a simulated buyer, or connect your own agent.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((a) => (
              <li key={a.agent} className="dw-row grid grid-cols-[28px_minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-2.5 py-1" title={`${a.conversations} conversations → ${a.checkouts} checkout links → ${a.paid} paid`}>
                <span className="dw-tilt">
                  <BuyerAvatar name={a.agent} size={26} />
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
    </Card>
  );
}
