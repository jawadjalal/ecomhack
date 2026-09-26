"use client";

/**
 * The signed-in merchant's repositories as a searchable dropdown (combobox): merchants have many repos.
 * Data: GET /api/auth/github/repos (most recently updated first). Keyboard: ↑/↓, Home/End, Enter, Esc.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, GitBranch, RotateCw, Search } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { BrandGlyph } from "@/components/dw/brand-logos";
import { Tag } from "@/components/dw/ui";
import { CheckPop, EASE } from "./bits";

export interface RepoSummary {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  description?: string;
}

type Load = { state: "loading" } | { state: "ready"; repos: RepoSummary[] } | { state: "error"; message: string };

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

/** "updated 3 days ago", "updated yesterday". */
export function updatedAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !rtf) return "";
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  const [v, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60
      ? [s, "second"]
      : abs < 3600
        ? [Math.round(s / 60), "minute"]
        : abs < 86400
          ? [Math.round(s / 3600), "hour"]
          : abs < 86400 * 30
            ? [Math.round(s / 86400), "day"]
            : abs < 86400 * 365
              ? [Math.round(s / (86400 * 30)), "month"]
              : [Math.round(s / (86400 * 365)), "year"];
  return `updated ${abs < 45 ? "just now" : rtf.format(v, unit)}`;
}

export function RepoPicker({
  login,
  selected,
  onPick,
  onUnauthorized,
}: {
  /** The signed-in account: its repos are listed first. */
  login: string;
  selected?: string | null;
  onPick: (fullName: string) => void;
  /** 401 from the repos API: the sign-in expired. */
  onUnauthorized: () => void;
}) {
  const uid = useId().replace(/:/g, "");
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/github/repos", { cache: "no-store" });
      if (res.status === 401) return onUnauthorized();
      const j = (await res.json().catch(() => ({}))) as {
        repos?: RepoSummary[];
        error?: string;
      };
      if (!res.ok || !Array.isArray(j.repos)) throw new Error(j.error ?? `GitHub answered ${res.status}`);
      setLoad({ state: "ready", repos: j.repos });
    } catch (err) {
      setLoad({ state: "error", message: (err as Error).message });
    }
  }, [onUnauthorized]);

  useEffect(() => {
    const t = setTimeout(() => void fetchRepos(), 0);
    return () => clearTimeout(t);
  }, [fetchRepos]);

  const retry = () => {
    setLoad({ state: "loading" });
    void fetchRepos();
  };

  // Your account first, then organisations (alphabetical); inside a group, most recently updated first.
  const groups = useMemo(() => {
    if (load.state !== "ready") return [];
    const q = query.trim().toLowerCase();
    const hits = load.repos.filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
    const by = new Map<string, RepoSummary[]>();
    for (const r of hits) {
      const owner = r.fullName.split("/")[0];
      by.set(owner, [...(by.get(owner) ?? []), r]);
    }
    const me = login.toLowerCase();
    const sorted = [...by.entries()].sort(([a], [b]) => (a.toLowerCase() === me ? -1 : b.toLowerCase() === me ? 1 : a.localeCompare(b)));
    // `start`: the group's first index in the flat list (the keyboard moves through that).
    let start = 0;
    return sorted.map(([owner, repos]) => {
      const g = { owner, mine: owner.toLowerCase() === me, repos, start };
      start += repos.length;
      return g;
    });
  }, [load, query, login]);
  const flat = useMemo(() => groups.flatMap((g) => g.repos), [groups]);
  const at = Math.min(active, Math.max(0, flat.length - 1));
  const optId = (i: number) => `${uid}-repo-${i}`;

  // Keep the active option in view.
  useEffect(() => {
    if (open) document.getElementById(optId(at))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const show = (q = query) => {
    setQuery(q);
    const i = flat.findIndex((r) => r.fullName === selected);
    setActive(i >= 0 && !q ? i : 0);
    setOpen(true);
    setTimeout(() => search.current?.focus(), 0);
  };
  const hide = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) setTimeout(() => trigger.current?.focus(), 0);
  };
  const pick = (r: RepoSummary | undefined) => {
    if (!r) return;
    setOpen(false);
    onPick(r.fullName);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const last = flat.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(at >= last ? 0 : at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(at <= 0 ? last : at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, last));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(flat[at]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const [owner, name] = selected ? selected.split("/") : [];

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        onClick={() => (open ? hide(false) : show(""))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show("");
          } else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            show(e.key);
          }
        }}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-full border bg-white pr-4 pl-2 text-left transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-dw-ink/25 focus-visible:outline-none",
          open ? "border-dw-ink/40 shadow-[0_0_0_4px_rgba(20,20,19,0.05)]" : "border-dw-hairline hover:border-dw-ink/25",
        )}
      >
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-ink text-white">
          <BrandGlyph brand="github" size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px]">
          {selected ? (
            <>
              <span className="text-dw-ink/50">{owner}/</span>
              <span className="font-semibold">{name}</span>
            </>
          ) : (
            <span className="font-medium text-dw-ink/70">{load.state === "loading" ? "Loading your repositories…" : "Choose your store's repository"}</span>
          )}
        </span>
        {load.state === "ready" && <span className="num hidden shrink-0 font-dwmono text-[12px] text-dw-ink/45 sm:inline">{load.repos.length} repos</span>}
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-dw-ink/60 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: EASE }}
            style={{ originY: 0 }}
            className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-[22px] border border-dw-hairline bg-dw-surface shadow-[0_28px_70px_-24px_rgba(20,20,19,0.42),0_2px_6px_rgba(20,20,19,0.05)]"
          >
            <div className="border-b border-dw-hairline p-2.5">
              <label className="flex h-10 items-center gap-2 rounded-full bg-dw-sand/80 px-3.5 focus-within:ring-2 focus-within:ring-dw-ink/15">
                <Search aria-hidden className="size-4 shrink-0 text-dw-ink/50" />
                <input
                  ref={search}
                  role="combobox"
                  aria-expanded
                  aria-controls={`${uid}-list`}
                  aria-autocomplete="list"
                  aria-activedescendant={flat.length ? optId(at) : undefined}
                  aria-label="Search your repositories"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKey}
                  placeholder="Search your repositories"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-dw-ink/40"
                />
              </label>
            </div>

            <div className="max-h-[19rem] overflow-y-auto overscroll-contain p-1.5">
              {load.state === "loading" &&
                [0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    aria-hidden
                    className="m-1 h-[58px] rounded-[16px] bg-dw-sand"
                    animate={{ opacity: [0.45, 1, 0.45] }}
                    transition={{
                      duration: 1.4,
                      repeat: Infinity,
                      delay: i * 0.12,
                    }}
                  />
                ))}
              {load.state === "error" && (
                <div role="alert" className="flex flex-col items-center gap-3 px-4 py-6 text-center text-[14px] text-dw-ink/70">
                  Couldn&apos;t load your repositories.
                  <button
                    type="button"
                    onClick={retry}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-dw-ink px-4 text-[13.5px] font-medium text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    <RotateCw className="size-3.5" /> Try again
                  </button>
                </div>
              )}
              {load.state === "ready" && !flat.length && (
                <div className="px-4 py-6 text-center text-[14px] text-dw-ink/60">
                  {load.repos.length ? <>No repositories match &ldquo;{query.trim()}&rdquo;.</> : "No repositories on this account yet."}
                </div>
              )}
              <div id={`${uid}-list`} role="listbox" aria-label="Your repositories">
                {groups.map((g) => (
                  <div key={g.owner} role="group" aria-labelledby={`${uid}-g-${g.owner}`} className="pb-1">
                    <div id={`${uid}-g-${g.owner}`} className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 text-[12.5px] font-medium text-dw-ink/55">
                      <span className="truncate">{g.owner}</span>
                      {g.mine && (
                        <Tag tone="yellow" className="h-5 px-2 text-[11px]">
                          Your account
                        </Tag>
                      )}
                    </div>
                    {g.repos.map((r, j) => {
                      const i = g.start + j;
                      const on = i === at;
                      const isSel = r.fullName === selected;
                      const [o, nm] = r.fullName.split("/");
                      return (
                        <div
                          key={r.fullName}
                          id={optId(i)}
                          role="option"
                          aria-selected={isSel}
                          onMouseMove={() => active !== i && setActive(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pick(r)}
                          className={cn("flex cursor-pointer items-start gap-3 rounded-[16px] px-3 py-2.5 transition-colors", on ? "bg-dw-sand" : "bg-transparent")}
                        >
                          <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] bg-white text-dw-ink shadow-[0_0_0_1px_rgba(20,20,19,0.07)]">
                            <BrandGlyph brand="github" size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="min-w-0 truncate text-[14.5px]">
                                <span className="text-dw-ink/45">{o}/</span>
                                <span className="font-semibold text-dw-ink">{nm}</span>
                              </span>
                              {r.private && (
                                <Tag tone="outline" className="h-5 px-2 text-[11px]">
                                  private
                                </Tag>
                              )}
                            </span>
                            {r.description && <span className="mt-0.5 block truncate text-[13px] text-dw-ink/60">{r.description}</span>}
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-dw-ink/50">
                              <span>{updatedAgo(r.updatedAt)}</span>
                              {r.defaultBranch && (
                                <span className="inline-flex h-5 items-center gap-1 rounded-full bg-white px-2 font-dwmono text-[11px] text-dw-ink/65 shadow-[0_0_0_1px_rgba(20,20,19,0.07)]">
                                  <GitBranch aria-hidden className="size-3" />
                                  {r.defaultBranch}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="grid size-6 shrink-0 place-items-center self-center">{isSel && <CheckPop size={20} tone="live" />}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div aria-hidden className="hidden items-center gap-3 border-t border-dw-hairline px-4 py-2 font-dwmono text-[11.5px] text-dw-ink/45 sm:flex">
              <span>↑↓ move</span>
              <span>↵ pick</span>
              <span>esc close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
