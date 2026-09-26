"use client";

/**
 * Two concrete pieces of the journey panel:
 * - `PathFlow`: the five steps as one horizontal line, the time between steps ("+12s") and a pin on the
 *   step where the shopper left, paid or is right now.
 * - `StorePage`: a live, scaled-down view of the real demo-store page where they left or paid, with its URL
 *   under it like a browser bar. It loads with `?preview=1` (and `variant=` for test shoppers), which the
 *   store treats as a preview: no analytics events, so it never counts as a visitor. Agents don't load pages,
 *   so for them (and for pages outside this app's /store) only the address is shown.
 */
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { money } from "@/lib/console/format";
import { cn } from "@/components/ui/cn";
import { stagesOf } from "./journey";
import type { Shopper, TestView } from "./model";

const FLOW = ["Landed", "Product", "Bag", "Checkout", "Paid"] as const;

/** "03:12" → 192. */
function secs(t: string | undefined): number | undefined {
  const m = t ? /^(\d+):(\d{2})$/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

function gapText(s: number): string {
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `+${m}m ${r}s` : `+${m}m`;
}

/** The five steps left to right, with the time it took to get from one to the next. */
export function PathFlow({ s }: { s: Shopper }) {
  const reduce = useReducedMotion();
  const stages = stagesOf(s);
  const won = s.status === "bought";
  const live = s.status === "live";
  const pinAt = Math.min(s.reach, 4);
  const pinText = won ? `Paid${s.orderTotal ? ` ${money(s.orderTotal)}` : ""}` : live ? "Here now" : "Left here";
  return (
    <div aria-label="Path through the store" role="group" className="flex min-w-0 flex-col gap-1">
      <ol className="grid grid-cols-5">
        {stages.map((st, i) => {
          const done = i < s.reach || (i === s.reach && won);
          const here = i === pinAt;
          const ahead = i > s.reach;
          const prevAt = i > 0 ? secs(stages[i - 1].at) : undefined;
          const at = secs(st.at);
          const gap = i > 0 && !ahead && at !== undefined && prevAt !== undefined ? at - prevAt : undefined;
          return (
            <li key={st.label} className="relative flex min-w-0 flex-col items-center">
              {/* pin */}
              <span className="flex h-7 items-end">
                {here && (
                  <motion.span
                    initial={reduce ? false : { y: -6, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.3, delay: reduce ? 0 : 0.2 }}
                    className={cn(
                      "relative mb-1.5 rounded-[8px] px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap tabular-nums",
                      won ? "bg-dw-olive text-dw-ink" : live ? "bg-dw-surface text-dw-ink" : "bg-dw-hot text-white",
                    )}
                  >
                    {pinText}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-full left-1/2 size-2 -translate-x-1/2 -translate-y-1 rotate-45",
                        won ? "bg-dw-olive" : live ? "bg-dw-surface" : "bg-dw-hot",
                      )}
                    />
                  </motion.span>
                )}
              </span>
              {/* line to the previous node, with the time it took */}
              {i > 0 && (
                <span aria-hidden className="absolute top-[41px] right-1/2 left-[-50%] flex items-center px-[15px]">
                  <span className={cn("h-0 flex-1 border-t-2", i <= s.reach ? "border-dw-ink" : "border-dashed border-dw-ink/25")} />
                </span>
              )}
              {i > 0 && gap !== undefined && (
                <span className="absolute top-[45px] right-1/2 left-[-50%] text-center font-dwmono text-[10.5px] text-[#3E4E70] tabular-nums">
                  {gapText(gap)}
                </span>
              )}
              {/* node */}
              <span
                className={cn(
                  "relative z-[1] grid size-[26px] place-items-center rounded-full",
                  done && (i === 4 ? "bg-dw-olive text-dw-ink" : "bg-dw-ink text-white"),
                  here && !won && live && "bg-dw-surface",
                  here && !won && !live && "bg-dw-hot text-white",
                  ahead && "border-[1.5px] border-dashed border-dw-ink/35 bg-dw-blue",
                )}
              >
                {done && (
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    <path d="M3.5 8.4l3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {here && !won && live && <span className="dw-live-dot size-2.5 rounded-full bg-dw-live" />}
                {here && !won && !live && (
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <span className={cn("mt-4 max-w-full truncate text-[13px] font-semibold", ahead && "font-medium text-dw-ink/45")}>{FLOW[i]}</span>
              <span className="font-dwmono text-[11px] text-[#3E4E70] tabular-nums">{st.at ?? " "}</span>
              <span className="sr-only">{done ? "done" : here ? pinText : "not reached"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Store endpoints the agent tools call (same map the simulator uses). */
const TOOL_PATH: Record<string, string> = {
  search_products: "GET /api/agent/products",
  get_product: "GET /api/agent/products/:id",
  check_availability: "GET /api/agent/products/:id",
  add_to_cart: "POST /api/agent/cart",
  get_cart: "GET /api/agent/cart",
  negotiate: "POST /api/agent/negotiate",
  checkout: "POST /api/agent/checkout",
};

interface PageView {
  /** iframe src (only for this app's /store). */
  src?: string;
  /** Address shown in the bar. */
  url: string;
  title: string;
  note: string;
}

/** Which page to show for this shopper, and how. */
export function pageFor(s: Shopper, test?: TestView): PageView {
  const won = s.status === "bought";
  const title = won ? "Where they paid" : s.status === "live" ? "Where they are now" : "Where they left";
  if (s.kind === "agent") {
    const tool = [...s.steps].reverse().find((st) => TOOL_PATH[st.tool])?.tool;
    return {
      url: tool ? TOOL_PATH[tool] : "/api/agent",
      title: won ? "Its last call: it paid here" : s.status === "live" ? "Its latest call" : "Its last call",
      note: "AI shoppers don’t load pages. They read the store through its agent tools, so this is the last address it called.",
    };
  }
  const raw = (s.lastPath ?? s.path ?? "").split(/[?#]/)[0];
  if (!raw.startsWith("/store")) return { url: raw || "unknown page", title, note: "This page is on another site, so only its address is shown." };
  // The thank-you page needs their order; checkout is the page they paid on.
  const path = /\/checkout\/success/.test(raw) ? "/store/checkout" : raw;
  const q = new URLSearchParams({ preview: "1" });
  const arm = test && s.experimentId === test.experiment.id ? s.arm : undefined;
  if (arm) q.set("variant", arm === "B" ? "treatment" : "control");
  const shown = arm ? `${path}?variant=${arm === "B" ? "treatment" : "control"}` : path;
  const basket = /\/(checkout|cart|bag)/.test(path) ? " The bag is a sample basket, not theirs." : "";
  return {
    src: `${path}?${q.toString()}`,
    url: shown,
    title,
    note:
      arm === "B"
        ? `The new version from the test, as it looks now. Loaded as a preview, so it doesn’t count as a visit.${basket}`
        : arm === "A"
          ? `Your current page from the test, as it looks now. Loaded as a preview, so it doesn’t count as a visit.${basket}`
          : `Your live page as it looks now. Loaded as a preview, so it doesn’t count as a visit.${basket}`,
  };
}

const FRAME_W = 1280;
const FRAME_H = 800;

/** A live, non-interactive thumbnail of the real store page, with the address under it. */
export function StorePage({ s, test }: { s: Shopper; test?: TestView }) {
  const v = pageFor(s, test);
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [loaded, setLoaded] = useState<string>();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [v.src]);
  const scale = w / FRAME_W;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-[#3E4E70]">{v.title}</span>
        {v.src && (
          <a href={v.src} target="_blank" rel="noreferrer" className="shrink-0 text-[12.5px] font-medium text-[#3E4E70] underline-offset-2 hover:underline">
            Open page
          </a>
        )}
      </figcaption>
      <div className="overflow-hidden rounded-[12px] border border-dw-ink/10 bg-dw-surface">
        {v.src ? (
          <div ref={box} className="relative w-full overflow-hidden bg-white" style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}` }}>
            {scale > 0 && (
              <iframe
                key={v.src}
                src={v.src}
                title={`${v.title}: ${v.url}`}
                loading="lazy"
                tabIndex={-1}
                aria-hidden
                sandbox="allow-same-origin allow-scripts"
                onLoad={() => setLoaded(v.src)}
                className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
                style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, opacity: loaded === v.src ? 1 : 0, transition: "opacity .35s" }}
              />
            )}
            {loaded !== v.src && <div className="absolute inset-0 grid place-items-center bg-dw-sand/60 text-[12.5px] text-dw-muted">Loading the page…</div>}
          </div>
        ) : null}
        <div className={cn("flex h-8 items-center gap-2 px-3", v.src && "border-t border-dw-ink/10")}>
          <span aria-hidden className="flex shrink-0 gap-1">
            <span className="size-[7px] rounded-full bg-dw-ink/15" />
            <span className="size-[7px] rounded-full bg-dw-ink/15" />
            <span className="size-[7px] rounded-full bg-dw-ink/15" />
          </span>
          <span className="min-w-0 flex-1 truncate font-dwmono text-[11.5px] text-dw-ink/75">{v.url}</span>
        </div>
      </div>
      <p className="text-[12.5px] leading-snug text-dw-ink/55">{v.note}</p>
    </figure>
  );
}
