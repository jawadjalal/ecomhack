"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { prsByGeneration } from "@/lib/console/format";
import { useExperiments } from "@/lib/console/hooks";
import { Mascot } from "./mascot";
import { useDarwin } from "./provider";

/** The roadmap: Overview, then the loop's four steps in order. */
export const NAV = [
  { key: "overview", label: "Overview", href: "/console" },
  { key: "issues", label: "Issues", href: "/console/issues" },
  { key: "fixes", label: "Fixes", href: "/console/fixes" },
  { key: "experiments", label: "Experiments", href: "/console/experiments" },
  { key: "prs", label: "Pull requests", href: "/console/pulls" },
] as const;

const MORE = [
  { label: "Store agent", hint: "AI shoppers buy over A2A", href: "/console/agents" },
  { label: "Dashboards", hint: "What you asked Darwin to track", href: "/console/dashboards" },
  { label: "Personalize", hint: "Any store, per traffic source", href: "/console/personalize" },
  { label: "Traffic", hint: "Where visitors come from", href: "/console/traffic" },
  { label: "Set up a store", hint: "GitHub, a script tag, or Whop", href: "/onboarding" },
  { label: "Agent readiness", hint: "Score any store for AI shoppers", href: "/readiness" },
  { label: "Classic mission control", hint: "The original loop view", href: "/console/classic" },
];

export function TopNav() {
  const path = usePathname();
  const { loop, autopilot, setAutopilot, mock } = useDarwin();
  const experiments = useExperiments();
  const counts: Record<string, number> = {
    issues: loop?.insights.length ?? 0,
    fixes: loop?.proposal ? 1 : 0,
    experiments: experiments?.filter((e) => e.status === "running").length ?? 0,
    prs: prsByGeneration(loop).size,
  };
  const active = NAV.slice()
    .reverse()
    .find((n) => (n.href === "/console" ? path === "/console" : path?.startsWith(n.href)))?.key;

  return (
    <header className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 max-lg:grid-cols-[auto_1fr] max-lg:gap-y-3">
      <Link href="/console" className="flex items-center gap-2.5 justify-self-start text-dw-ink" aria-label="Darwin overview">
        <Mascot kind="analyst" size={34} active />
        <span className="text-[23px] font-semibold tracking-[-0.02em]">darwin</span>
      </Link>

      <nav
        aria-label="Main"
        className="flex h-[54px] max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-dw-ink p-[5px] [scrollbar-width:none] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_rgba(20,20,19,0.16)] max-lg:order-last max-lg:col-span-2 max-lg:justify-self-center"
      >
        {NAV.map((n, i) => {
          const on = n.key === active;
          const count = counts[n.key];
          return (
            <div key={n.key} className="flex items-center">
              <Link
                href={mock ? `${n.href}?mock=1` : n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-full px-4 text-[15px] whitespace-nowrap transition-colors",
                  on ? "bg-dw-bg font-semibold text-dw-ink" : "font-medium text-[#CFCAC0] hover:text-white",
                )}
              >
                {i > 0 && (
                  <span
                    className={cn(
                      "grid size-[18px] place-items-center rounded-full text-[11px] font-semibold",
                      on ? "bg-dw-ink text-dw-bg" : "bg-white/[0.12] text-[#CFCAC0]",
                    )}
                  >
                    {i}
                  </span>
                )}
                {n.label}
                {!!count && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-dw-pink px-[5px] text-[11px] font-semibold text-dw-ink">{count}</span>}
              </Link>
              {i < NAV.length - 1 && <ChevronRight className="mx-0.5 size-3 shrink-0 text-[#5E5A52]" strokeWidth={2.2} aria-hidden />}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 justify-self-end">
        <button
          type="button"
          onClick={() => void setAutopilot(!autopilot)}
          title={autopilot ? "Darwin is improving the store on its own. Click to pause." : "Paused. Click to let Darwin run the loop on its own."}
          className="flex h-11 items-center gap-2 rounded-full bg-dw-sand px-4 text-[15px] whitespace-nowrap transition-colors hover:bg-[#e4dccb]"
        >
          <span className={cn("size-2 rounded-full", autopilot ? "dw-live-dot bg-dw-live" : "bg-dw-ink/30")} />
          <span className="max-sm:hidden">{autopilot ? "Darwin running" : "Paused"}</span>
          {mock && <span className="text-[12px] text-dw-ink/50">(demo data)</span>}
        </button>
        <MoreMenu />
        <Link
          href="/console/settings"
          aria-label="Profile and settings"
          className="grid size-11 place-items-center rounded-full bg-dw-ink text-[14px] font-semibold text-white transition-transform hover:scale-[1.06]"
        >
          JJ
        </Link>
      </div>
    </header>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More tools"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-11 place-items-center rounded-full bg-dw-sand text-dw-ink transition-colors hover:bg-[#e4dccb]"
      >
        <Ellipsis className="size-5" />
      </button>
      {open && (
        <div className="absolute top-[52px] right-0 z-50 w-72 rounded-[22px] border border-dw-hairline bg-dw-surface p-2 shadow-[0_24px_60px_-20px_rgba(20,20,19,0.35)]">
          {MORE.map((m) => (
            <Link key={m.href} href={m.href} onClick={() => setOpen(false)} className="flex flex-col rounded-2xl px-3.5 py-2.5 hover:bg-dw-sand">
              <span className="text-[15px] font-medium">{m.label}</span>
              <span className="text-[12.5px] text-dw-ink/60">{m.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
