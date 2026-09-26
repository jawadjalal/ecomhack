"use client";

/**
 * "Money and events": the latest things that matter across the store, newest first. Payments lead (green,
 * with the £ amount), then bags, checkouts, and the store agent's checkout links and payments. Built only from
 * real events: people's store events, AI shoppers' finished sessions and the store agent's own sales feed.
 * New rows arrive calmly, at most one every 1.5 s.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { AnalyticsEvent } from "@/lib/contracts";
import { money, productName, timeAgo } from "@/lib/console/format";
import { useApi, useNow } from "@/lib/console/hooks";
import { cn } from "@/components/ui/cn";
import { AgentTile, agentBrand } from "../agent-tile";
import { EASE } from "./fx";
import { useStoreAgentSales, usePeopleEvents, type StoreAgentSale } from "./hooks";
import { PersonTile } from "./journey";
import { isStoreEvent, type Shopper } from "./model";

interface FeedItem {
  id: string;
  at: string;
  who: "person" | string;
  paid: boolean;
  text: string;
  sub: string;
  amount?: number;
  synthetic?: boolean;
}

const ROWS = 5;
const HOUR = 60 * 60 * 1000;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function fromPerson(e: AnalyticsEvent): FeedItem | undefined {
  const p = e.properties;
  if ((p.visitor_kind ?? "human") !== "human" || !isStoreEvent(e)) return undefined;
  const device = typeof p.$device_type === "string" ? p.$device_type.toLowerCase() : "desktop";
  const product = productName(p.product_id);
  const base = { id: e.uuid || `${e.distinct_id}:${e.event}:${e.timestamp}`, at: e.timestamp, who: "person", sub: `Person on ${device}`, synthetic: Boolean(p.synthetic) };
  if (e.event === "order_completed") {
    const n = num(p.item_count) ?? num(p.items);
    return { ...base, paid: true, text: product ? `Paid for ${product}` : n && n > 1 ? `Paid for ${n} items` : "Paid for an order", amount: num(p.revenue) ?? num(p.value) };
  }
  if (e.event === "product_added") return { ...base, paid: false, text: `Added ${product ?? "a product"} to the bag`, amount: num(p.price) };
  if (e.event === "checkout_started") return { ...base, paid: false, text: "Started checkout", amount: num(p.value) };
  return undefined;
}

function fromAgent(s: Shopper): FeedItem | undefined {
  if (s.kind !== "agent" || s.status !== "bought") return undefined;
  return {
    id: `a:${s.id}`,
    at: s.lastAt,
    who: s.model,
    paid: true,
    text: "Paid through agent checkout",
    sub: `${s.model} · AI shopper`,
    amount: s.orderTotal,
    synthetic: s.synthetic,
  };
}

function fromStoreAgent(r: StoreAgentSale): FeedItem {
  const paid = r.step === "paid";
  return {
    id: `sa:${r.at}:${r.ref}:${r.step}`,
    at: r.at,
    who: r.agent,
    paid,
    text: paid ? "Paid on the Whop store" : "Got a checkout link from the store agent",
    sub: `${r.agent} · via the store agent`,
    amount: r.price,
  };
}

/** Shows new items one at a time, at most one every `everyMs` (the first load shows the latest at once). */
function useTrickle(items: FeedItem[], ready: boolean, max: number, everyMs = 1500): FeedItem[] {
  const [shown, setShown] = useState<FeedItem[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const queue = useRef<FeedItem[]>([]);
  useEffect(() => {
    if (!ready || !items.length) return;
    if (!seen.current) {
      seen.current = new Set(items.map((i) => i.id));
      const first = items.slice(0, max);
      const t = setTimeout(() => setShown(first), 0);
      return () => clearTimeout(t);
    }
    const known = seen.current;
    const fresh = items.filter((i) => !known.has(i.id));
    fresh.forEach((i) => known.add(i.id));
    // Oldest first, so the newest ends up on top; keep only what could still be on screen.
    queue.current = [...queue.current, ...fresh.reverse()].slice(-max);
  }, [items, ready, max]);
  useEffect(() => {
    const t = setInterval(() => {
      const next = queue.current.shift();
      if (next) setShown((s) => [next, ...s.filter((x) => x.id !== next.id)].slice(0, max));
    }, everyMs);
    return () => clearInterval(t);
  }, [everyMs, max]);
  return shown;
}

export function MoneyFeed({ agents, className }: { agents: Shopper[]; className?: string }) {
  const events = usePeopleEvents();
  const sales = useStoreAgentSales();
  const mock = useApi().mode === "mock";
  // Wait for every source's first answer, so the first screen shows the latest rows at once.
  const ready = events !== undefined && (mock || sales !== undefined);
  const now = useNow();
  const reduce = useReducedMotion();

  const all = useMemo(() => {
    const out: FeedItem[] = [];
    for (const e of events ?? []) {
      const it = fromPerson(e);
      if (it) out.push(it);
    }
    for (const s of agents) {
      const it = fromAgent(s);
      if (it) out.push(it);
    }
    for (const r of sales ?? []) out.push(fromStoreAgent(r));
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [events, agents, sales]);

  // Payments first: the newest payments always make the list, then the newest other events fill it.
  const picked = useMemo(() => {
    const pays = all.filter((i) => i.paid).slice(0, 3);
    const rest = all.filter((i) => !pays.includes(i)).slice(0, ROWS - pays.length);
    return [...pays, ...rest].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [all]);
  const rows = useTrickle(picked, ready, ROWS);

  const hour = now ? all.filter((i) => i.paid && now - Date.parse(i.at) < HOUR) : [];
  const taken = hour.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const simulated = all.some((i) => i.synthetic);

  return (
    <section aria-label="Money and events" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[15px] font-semibold whitespace-nowrap">Money and events</h3>
        <span className="text-[12.5px] text-dw-muted tabular-nums">
          {hour.length ? (
            <>
              <span className="font-semibold text-dw-win">{money(taken)}</span> from {hour.length} {hour.length === 1 ? "order" : "orders"} in the last hour
            </>
          ) : (
            "No payments in the last hour"
          )}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-dw-hairline py-4 text-[13px] text-dw-muted">Bags, checkouts and payments show up here as they happen.</p>
      ) : (
        <ul className="flex flex-col border-t border-dw-hairline">
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.li
                key={r.id}
                layout={reduce ? false : "position"}
                initial={reduce ? false : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                transition={{ duration: 0.45, ease: EASE }}
                className="flex items-center gap-2.5 border-b border-dw-hairline py-[7px]"
              >
                {r.who === "person" ? <PersonTile size={30} bought={r.paid} /> : <AgentTile brand={agentBrand(r.who)} size={30} />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("truncate text-[13.5px] leading-snug", r.paid ? "font-semibold text-dw-win" : "text-dw-ink")}>{r.text}</span>
                  <span className="truncate text-[12px] text-dw-muted">
                    {r.sub}
                    {r.synthetic ? " · simulated" : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  {r.amount ? (
                    <span className={cn("text-[13.5px] font-semibold tabular-nums", r.paid ? "text-dw-win" : "text-dw-ink/80")}>
                      {r.paid ? "+" : ""}
                      {money(r.amount)}
                    </span>
                  ) : null}
                  <span className="font-dwmono text-[11px] text-dw-muted tabular-nums">{timeAgo(r.at, now) || "now"}</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {simulated && rows.length > 0 && <span className="text-[12px] text-dw-muted">Includes simulated shoppers, labelled on each row.</span>}
    </section>
  );
}
