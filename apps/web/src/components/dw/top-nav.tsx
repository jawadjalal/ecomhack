"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/cn";
import { useExperiments } from "@/lib/console/hooks";
import { useDemoStatus } from "@/components/demo/demo-badge";
import { Mascot } from "./mascot";
import { useDarwin } from "./provider";

/** The roadmap: Overview, then the loop's four steps in order. */
export const NAV = [
  { key: "overview", label: "Overview", href: "/console" },
  { key: "issues", label: "Issues", href: "/console/issues" },
  { key: "fixes", label: "Fixes", href: "/console/fixes" },
  { key: "experiments", label: "Experiments", href: "/console/experiments" },
  { key: "changes", label: "Changes", href: "/console/changes" },
] as const;

const MORE = [
  { label: "Demo store", hint: "The shop Darwin is watching", href: "/store" },
  { label: "Store agent", hint: "AI shoppers buy over A2A", href: "/console/agents" },
  { label: "Dashboards", hint: "What you asked Darwin to track", href: "/console/dashboards" },
  { label: "Personalize", hint: "Any store, per traffic source", href: "/console/personalize" },
  { label: "Traffic", hint: "Where visitors come from", href: "/console/traffic" },
  { label: "Set up a store", hint: "GitHub, a script tag, or Whop", href: "/onboarding" },
  { label: "Agent readiness", hint: "Score any store for AI shoppers", href: "/readiness" },
  { label: "Classic mission control", hint: "The original loop view", href: "/console/classic" },
  { label: "Settings", hint: "Autopilot, your store, demo mode", href: "/console/settings" },
];

/** Keep the in-browser demo (?mock=1) when moving between console pages. */
function hrefFor(href: string, mock: boolean) {
  if (!mock || !href.startsWith("/console")) return href;
  return href.includes("?") ? `${href}&mock=1` : `${href}?mock=1`;
}

export function TopNav() {
  const path = usePathname();
  const { loop, autopilot, setAutopilot, mock } = useDarwin();
  const experiments = useExperiments();
  const counts: Record<string, number> = {
    issues: loop?.insights.length ?? 0,
    fixes: loop?.proposal ? 1 : 0,
    experiments: experiments?.filter((e) => e.status === "running").length ?? 0,
    changes: Math.max(0, (loop?.history.length ?? 1) - 1),
  };
  const active = NAV.slice()
    .reverse()
    .find((n) => (n.href === "/console" ? path === "/console" : path?.startsWith(n.href)))?.key;

  return (
    <header className="flex h-16 items-center gap-4 sm:gap-8">
      <Link href={hrefFor("/console", mock)} className="flex shrink-0 items-center gap-2.5 text-dw-ink" aria-label="Darwin overview">
        <Mascot kind="analyst" size={32} active />
        <span className="text-[22px] font-semibold tracking-[-0.03em]">darwin</span>
      </Link>

      <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV.map((n) => {
          const on = n.key === active;
          const count = counts[n.key];
          return (
            <Link
              key={n.key}
              href={hrefFor(n.href, mock)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] whitespace-nowrap transition-colors",
                on ? "font-semibold text-dw-ink" : "font-medium text-dw-ink/45 hover:text-dw-ink",
              )}
            >
              <span className={cn(on && "underline decoration-dw-yellow decoration-2 underline-offset-[6px]")}>{n.label}</span>
              {!!count && <span className="text-[12px] text-dw-ink/40 tabular-nums">{count}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void setAutopilot(!autopilot)}
          title={autopilot ? "Darwin is improving the store on its own. Click to pause." : "Paused. Click to let Darwin run the loop on its own."}
          className="flex h-10 items-center gap-2 rounded-full px-3 text-[14px] font-medium whitespace-nowrap text-dw-ink transition-colors hover:bg-dw-sand"
        >
          <span className={cn("size-2 rounded-full", autopilot ? "dw-live-dot bg-dw-live" : "bg-dw-ink/30")} />
          <span className="max-sm:hidden">{autopilot ? "Running" : "Paused"}</span>
        </button>
        <AccountMenu mock={mock} path={path || "/console"} />
      </div>
    </header>
  );
}

function AccountMenu({ mock, path }: { mock: boolean; path: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const demo = useDemoStatus();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const note = demo ? (demo.seeding ? "sending simulated shoppers…" : "simulated shoppers") : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account and more"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full bg-dw-ink text-[13px] font-semibold text-white transition-transform hover:scale-[1.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
      >
        JJ
      </button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-72 rounded-[22px] border border-dw-hairline bg-dw-surface p-2 shadow-[0_24px_60px_-20px_rgba(20,20,19,0.35)]">
          {(mock || note) && (
            <div className="px-3.5 pt-2 pb-1 text-[12.5px] leading-snug text-dw-ink/55">
              {mock && <p>In-browser demo data</p>}
              {note && (
                <p>
                  {demo?.store.name} · {note}
                </p>
              )}
            </div>
          )}
          <Link
            href={mock ? path : `${path}?mock=1`}
            onClick={() => setOpen(false)}
            className="flex flex-col rounded-2xl px-3.5 py-2.5 hover:bg-dw-sand"
          >
            <span className="text-[15px] font-medium">{mock ? "Use live data" : "Open in-browser demo"}</span>
            <span className="text-[12.5px] text-dw-ink/60">{mock ? "Leave ?mock=1 on this page" : "Run the loop in this browser"}</span>
          </Link>
          {MORE.map((m) => (
            <Link key={m.href} href={hrefFor(m.href, mock)} onClick={() => setOpen(false)} className="flex flex-col rounded-2xl px-3.5 py-2.5 hover:bg-dw-sand">
              <span className="text-[15px] font-medium">{m.label}</span>
              <span className="text-[12.5px] text-dw-ink/60">{m.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
