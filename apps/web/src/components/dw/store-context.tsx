"use client";

/**
 * Which store is the console showing? The loop screens (Overview → Changes) always run on PACE, the demo
 * store at /store, with simulated shoppers. Dashboards and Personalize are per site: the merchant's own
 * site once onboarding made a tracking plan for it, else the North Trail demo site.
 *
 * Nothing new is stored here: the merchant's store comes from onboarding's saved progress (sessionStorage,
 * this tab: see onboarding/persist.ts) and the GitHub connection the server already knows (/api/github/status).
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Globe, Store } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useGithubStatus } from "@/lib/console/hooks";
import { BrandGlyph } from "./brand-logos";
import { Mascot } from "./mascot";
import { PROGRESS_KEY, loadProgress } from "./onboarding/persist";
import { PillButton } from "./ui";

/** darwin.js site id of the demo site (lib/web DEMO_SITE; not imported so this stays client-only). */
export const DEMO_WEB_SITE = "north-trail";

export interface StoreContext {
  /** Read after hydration: false during SSR and the first client render. */
  ready: boolean;
  /** "owner/repo", from onboarding or a GitHub connection. */
  repo?: string;
  /** The store's URL when it was connected with a script tag. */
  website?: string;
  /** website's host, without www. */
  host?: string;
  /** darwin.js site id of the merchant's tracking plan (set once onboarding made the plan). */
  site?: string;
  whop?: string;
  /** Onboarding reached the live screen. */
  setupDone: boolean;
  connected: boolean;
}

export function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const noop = () => () => {};
const readRaw = () => {
  try {
    return sessionStorage.getItem(PROGRESS_KEY) ?? "";
  } catch {
    return "";
  }
};

/** The merchant's store as onboarding and the server know it (never invents one). */
export function useStoreContext(): StoreContext {
  const raw = useSyncExternalStore(noop, readRaw, () => null);
  const { status } = useGithubStatus();
  const progress = useMemo(() => (raw ? loadProgress() : null), [raw]);
  const serverRepo = (status as { connection?: { repo?: unknown } } | undefined)?.connection?.repo;
  const repo = progress?.repo ?? (typeof serverRepo === "string" ? serverRepo : undefined);
  const website = progress?.website ?? undefined;
  return {
    ready: raw !== null,
    repo,
    website,
    host: website ? hostOf(website) : undefined,
    site: progress?.site ?? undefined,
    whop: progress?.whop?.title,
    setupDone: progress?.stage === "live",
    connected: Boolean(repo || website),
  };
}

/** "north-trail" → "North Trail". */
function siteName(site: string) {
  return site.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const PER_SITE = ["/console/dashboards", "/console/personalize"];

/** The header chip: which store this page shows, and a way to connect yours. */
export function StoreChip() {
  return (
    <Suspense fallback={null}>
      <Chip />
    </Suspense>
  );
}

function Chip() {
  const path = usePathname() ?? "";
  const params = useSearchParams();
  const store = useStoreContext();
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

  const perSite = PER_SITE.some((p) => path.startsWith(p));
  const shownSite = perSite ? (params?.get("site") ?? store.site ?? DEMO_WEB_SITE) : undefined;
  const mine = Boolean(shownSite && store.site && shownSite === store.site);

  let label: string;
  let short: string;
  let icon = <Store className="size-4 shrink-0" aria-hidden />;
  if (shownSite && mine) {
    label = store.host ?? store.repo ?? shownSite;
    short = label;
    icon = <Globe className="size-4 shrink-0" aria-hidden />;
  } else if (shownSite && shownSite !== DEMO_WEB_SITE) {
    label = shownSite;
    short = shownSite;
    icon = <Globe className="size-4 shrink-0" aria-hidden />;
  } else if (shownSite) {
    label = `Demo site · ${siteName(DEMO_WEB_SITE)}`;
    short = "Demo";
  } else {
    label = "Demo store · PACE";
    short = "Demo";
  }
  const isDemo = short === "Demo";

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Store: ${label}. ${isDemo ? "Connect your store" : "Store details"}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-11 max-w-[16rem] min-w-0 items-center gap-2 rounded-full px-4 text-[14.5px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink max-sm:h-9 max-sm:max-w-[6.5rem] max-sm:gap-1.5 max-sm:px-3 max-sm:text-[13px]",
          isDemo ? "border border-dashed border-dw-ink/35 text-dw-ink/80 hover:border-dw-ink/60 hover:text-dw-ink" : "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
        )}
      >
        {icon}
        <span className="truncate max-sm:hidden">{label}</span>
        <span className="truncate sm:hidden">{short}</span>
        <ChevronDown className={cn("size-3.5 shrink-0 transition-transform max-sm:hidden", open && "rotate-180")} aria-hidden />
      </button>
      {open && <Panel store={store} shownSite={shownSite} mine={mine} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Panel({ store, shownSite, mine, onClose }: { store: StoreContext; shownSite?: string; mine: boolean; onClose: () => void }) {
  const siteQ = store.site ? `?site=${encodeURIComponent(store.site)}` : "";
  return (
    <div
      role="dialog"
      aria-label="Which store Darwin is showing"
      className="absolute top-[52px] right-0 z-50 flex w-[22rem] flex-col gap-3 rounded-[22px] border border-dw-hairline bg-dw-surface p-4 text-[14px] leading-snug shadow-[0_24px_60px_-20px_rgba(20,20,19,0.35)] max-sm:fixed max-sm:inset-x-4 max-sm:top-16 max-sm:w-auto"
    >
      {shownSite && (mine || shownSite !== DEMO_WEB_SITE) ? (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-dw-sand">
            <Globe className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{mine ? (store.host ?? store.repo ?? shownSite) : shownSite}</p>
            <p className="text-dw-ink/70">This page shows this site&apos;s own visitors, read by darwin.js. Simulated visitors are labelled.</p>
          </div>
        </div>
      ) : shownSite ? (
        <div className="flex items-start gap-3">
          <Mascot kind="observer" size={36} frame active={false} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">North Trail, a demo site</p>
            <p className="text-dw-ink/70">
              {store.site ? "This page is showing Darwin's demo site, not yours." : "No site of yours is connected yet, so this page runs on a demo site with simulated visitors."}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <Mascot kind="analyst" size={36} frame active={false} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">PACE, Darwin&apos;s demo store</p>
            <p className="text-dw-ink/70">Overview, Issues, Fixes, Experiments and Changes run on this demo running-shoe store. Its shoppers are simulated and labelled that way.</p>
            <a
              href="/store"
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 font-medium text-dw-ink underline-offset-2 hover:underline"
            >
              Open the demo store <ArrowUpRight className="size-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>
      )}

      {(store.website || store.repo) && (
        <div className="flex flex-col gap-2 rounded-[16px] bg-dw-sand/60 p-3">
          {store.website && (
            <div className="flex items-start gap-2">
              <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="truncate font-medium">{store.host}</p>
                {store.site ? (
                  <p className="text-[13px] text-dw-ink/70">Your site. Dashboards and Personalize show it.</p>
                ) : (
                  <p className="text-[13px] text-dw-ink/70">Setup isn&apos;t finished, so nothing is recorded yet.</p>
                )}
              </div>
            </div>
          )}
          {store.repo && (
            <div className="flex items-start gap-2">
              <BrandGlyph brand="github" size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="truncate font-medium">{store.repo}</p>
                <p className="text-[13px] text-dw-ink/70">Winning changes open pull requests on this repo.</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-medium">
            {store.site ? (
              <>
                <Link href={`/console/dashboards${siteQ}`} onClick={onClose} className="inline-flex items-center gap-0.5 hover:underline">
                  Dashboards <ChevronRight className="size-3.5" aria-hidden />
                </Link>
                <Link href={`/console/personalize${siteQ}`} onClick={onClose} className="inline-flex items-center gap-0.5 hover:underline">
                  Personalize <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </>
            ) : (
              <Link href="/onboarding" onClick={onClose} className="inline-flex items-center gap-0.5 hover:underline">
                Finish setup <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      )}

      <PillButton href="/onboarding" tone={store.connected ? "sand" : "ink"} className="w-full">
        {store.connected ? "Set up another store" : "Connect your store"}
      </PillButton>
    </div>
  );
}
