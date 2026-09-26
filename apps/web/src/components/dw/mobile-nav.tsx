"use client";

/**
 * Phones (<640px): the main nav as a bottom tab bar (Overview, Issues, Fixes, Tests, Changes, with
 * counts) above the safe area. 64px tall plus the safe area: overview/chat.tsx seats its prompt bar
 * on top of it with the same number (TAB_BAR there). Desktop keeps the top nav's black pill.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig, motion } from "motion/react";
import { FlaskConical, GitPullRequestArrow, House, ScanSearch, WandSparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useExperiments } from "@/lib/console/hooks";
import { useDarwin } from "./provider";
import { NAV } from "./top-nav";

export const TAB_BAR_HEIGHT = 64;

const TABS: Record<(typeof NAV)[number]["key"], { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: House },
  issues: { label: "Issues", icon: ScanSearch },
  fixes: { label: "Fixes", icon: WandSparkles },
  experiments: { label: "Tests", icon: FlaskConical },
  changes: { label: "Changes", icon: GitPullRequestArrow },
};

export function MobileTabBar() {
  const path = usePathname();
  const { loop, mock } = useDarwin();
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
    <MotionConfig reducedMotion="user">
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 rounded-t-[24px] bg-dw-ink pb-[env(safe-area-inset-bottom)] sm:hidden">
        <ul className="mx-auto grid h-16 max-w-lg grid-cols-5 px-1">
          {NAV.map((n) => {
            const on = n.key === active;
            const count = counts[n.key] ?? 0;
            const { label, icon: Icon } = TABS[n.key];
            return (
              <li key={n.key} className="min-w-0">
                <Link
                  href={mock ? `${n.href}?mock=1` : n.href}
                  aria-current={on ? "page" : undefined}
                  className="flex h-full flex-col items-center justify-center gap-1 rounded-2xl transition-transform duration-150 [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-dw-bg/60 focus-visible:outline-none active:scale-[0.94]"
                >
                  <span className="relative grid h-7 w-[3.25rem] place-items-center">
                    {on && <motion.span layoutId="dw-tab" className="absolute inset-0 rounded-full bg-dw-bg" transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
                    <Icon className={cn("relative size-[19px]", on ? "text-dw-ink" : "text-[#CFCAC0]")} strokeWidth={on ? 2.3 : 1.9} aria-hidden />
                    {count > 0 && (
                      <span className="num absolute -top-1.5 right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-dw-pink px-1 text-[10px] leading-none font-semibold text-dw-ink ring-2 ring-dw-ink">
                        {count}
                        <span className="sr-only"> {n.key === "issues" ? "open" : n.key === "experiments" ? "running" : "new"}</span>
                      </span>
                    )}
                  </span>
                  <span className={cn("max-w-full truncate text-[11px] leading-none", on ? "font-semibold text-white" : "font-medium text-[#CFCAC0]")}>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </MotionConfig>
  );
}
