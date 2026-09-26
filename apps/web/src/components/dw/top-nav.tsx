"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useExperiments } from "@/lib/console/hooks";
import { AccountAvatar } from "./account-avatar";
import { CommandPill } from "./command/pill";
import { LiveSwitch } from "./live-switch";
import { Mascot, type MascotKind } from "./mascot";
import { useDarwin } from "./provider";
import { StoreChip } from "./store-context";

/** The roadmap: Overview, then the loop's four steps in order. */
export const NAV = [
  { key: "overview", label: "Overview", href: "/console" },
  { key: "issues", label: "Issues", href: "/console/issues" },
  { key: "fixes", label: "Fixes", href: "/console/fixes" },
  { key: "experiments", label: "Experiments", href: "/console/experiments" },
  { key: "changes", label: "Changes", href: "/console/changes" },
] as const;

/** Each section is run by one agent of the crew; its mascot stands in for a step number. */
const NAV_AGENT: Record<(typeof NAV)[number]["key"], MascotKind> = {
  overview: "analyst",
  issues: "observer",
  fixes: "designer",
  experiments: "experimenter",
  changes: "shipper",
};

const MORE = [
  { label: "Store agent", hint: "Mika sells to AI shoppers", href: "/console/agents" },
  { label: "Dashboards", hint: "What you asked Darwin to track", href: "/console/dashboards" },
  { label: "Personalize", hint: "Change pages for each traffic source", href: "/console/personalize" },
  { label: "Traffic", hint: "Where visitors come from", href: "/console/traffic" },
  { label: "Set up a store", hint: "GitHub, a script tag, or Whop", href: "/onboarding" },
  { label: "Agent readiness", hint: "Score any store for AI shoppers", href: "/readiness" },
  { label: "Classic view", hint: "The first version of this app", href: "/console/classic" },
];

export function TopNav() {
  const path = usePathname();
  const { loop, autopilot, setAutopilot, mock } = useDarwin();
  const experiments = useExperiments();
  const counts: Record<string, number> = {
    issues: loop?.insights.length ?? 0,
    fixes: loop?.proposal ? 1 : 0,
    experiments: experiments?.filter((e) => e.status === "running").length ?? 0,
    // Shipped changes (generations after Gen 0), whether or not a pull request was opened for them.
    changes: Math.max(0, (loop?.history.length ?? 1) - 1),
  };
  const active = NAV.slice()
    .reverse()
    .find((n) => (n.href === "/console" ? path === "/console" : path?.startsWith(n.href)))?.key;

  return (
    <header className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 max-lg:grid-cols-[auto_1fr] max-lg:gap-y-3 max-sm:min-h-12 max-sm:gap-2">
      <Link href="/console" className="flex items-center gap-2.5 justify-self-start text-dw-ink" aria-label="Darwin overview">
        <Mascot kind="analyst" size={34} active />
        <span className="text-[23px] font-semibold tracking-[-0.02em]">darwin</span>
      </Link>

      <nav
        aria-label="Main"
        className="flex h-[54px] max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-dw-ink max-sm:hidden p-[5px] [scrollbar-width:none] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_rgba(20,20,19,0.16)] max-lg:order-last max-lg:col-span-2 max-lg:justify-self-center"
      >
        {NAV.map((n) => {
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
                <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full", on ? "bg-dw-sand" : "bg-white/[0.10]")} aria-hidden>
                  <Mascot kind={NAV_AGENT[n.key]} size={18} active={on} />
                </span>
                {n.label}
                {!!count && <span className="size-[7px] rounded-full bg-dw-pink" title={`${count} new`} aria-label={`${count} new`} />}
              </Link>

            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 justify-self-end max-sm:gap-1.5">
        <StoreChip />
        <button
          type="button"
          onClick={() => void setAutopilot(!autopilot)}
          title={autopilot ? "Darwin's crew is improving the store on its own. Click to pause." : "Paused. Click to let Darwin's crew improve the store on its own."}
          className="flex h-11 items-center gap-2 rounded-full bg-dw-sand px-4 text-[15px] whitespace-nowrap transition-colors hover:bg-[#e4dccb] max-sm:h-9 max-sm:px-3"
        >
          <span className={cn("size-2 rounded-full", autopilot ? "dw-live-dot bg-dw-live" : "bg-dw-ink/30")} />
          <span className="max-sm:text-[13.5px] max-sm:font-medium">
            {autopilot ? (
              <>
                <span className="max-sm:hidden">Darwin running</span>
                <span className="sm:hidden">Running</span>
              </>
            ) : (
              "Paused"
            )}
          </span>
          {mock && <span className="text-[12px] text-dw-ink/50">(demo data)</span>}
        </button>
        <LiveSwitch />
        <CommandPill />
        <MoreMenu />
        <AccountAvatar />
      </div>
      <StoreChip variant="bar" />
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
        className="grid size-11 place-items-center rounded-full bg-dw-sand text-dw-ink transition-colors hover:bg-[#e4dccb] max-sm:size-9"
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
