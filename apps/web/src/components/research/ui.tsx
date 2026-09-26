"use client";

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

/** Design tokens from the Darwin handoff (cream console). */
export const T = {
  bg: "#F7F1E5",
  ink: "#141413",
  sand: "#EDE6D6",
  surface: "#FFFDF8",
  hairline: "#EDE4D2",
  yellow: "#F6D76B",
  yellowShape: "#EDC957",
  pink: "#F3B5D5",
  pinkShape: "#EDA5C9",
  olive: "#A9B46E",
  oliveShape: "#99A460",
  blue: "#B8CAEE",
  blueShape: "#A8BCE7",
  lilac: "#D5CCF5",
  live: "#1FB57A",
  hot: "#F0579E",
  warnBg: "#FBE7D3",
  warn: "#B8621B",
  winBg: "#DDF3E8",
  win: "#137A52",
} as const;

export const PASTELS: [string, string][] = [
  [T.yellow, T.yellowShape],
  [T.blue, T.blueShape],
  [T.pink, T.pinkShape],
  [T.olive, T.oliveShape],
  [T.lilac, "#C7BCF0"],
];

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);

/** Small source chips: every claim shows where it came from. */
export function Sources({ urls, dark = false }: { urls: string[]; dark?: boolean }) {
  if (!urls.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {urls.map((u, i) => {
        const href = safeHref(u);
        return (
          <a
            key={`${u}-${i}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={`inline-flex max-w-[14rem] items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] leading-5 transition-colors ${
              dark ? "bg-white/15 text-white/85 hover:bg-white/25" : "bg-black/[0.06] text-black/65 hover:bg-black/[0.12]"
            }`}
            title={u}
          >
            <span className="truncate">{hostOf(u)}</span>
            <ExternalLink className="size-3 shrink-0 opacity-60" />
          </a>
        );
      })}
    </span>
  );
}

/** Pastel card with the faint corner silhouette from the handoff. */
export function Pastel({ fill, shape, className = "", children }: { fill: string; shape: string; className?: string; children: ReactNode }) {
  return (
    <div
      className={`group relative overflow-hidden rounded-[26px] p-5 transition-[transform,box-shadow] duration-200 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_14px_30px_-18px_rgba(20,20,19,0.45)] ${className}`}
      style={{ background: fill }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-[38%] transition-transform duration-300 motion-safe:group-hover:-rotate-10"
        style={{ background: shape }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-[26px] border p-5 ${className}`} style={{ background: T.surface, borderColor: T.hairline }}>
      {children}
    </section>
  );
}

export function Pill({ children, tone = "sand" }: { children: ReactNode; tone?: "sand" | "ink" | "warn" | "win" | "pink" }) {
  const styles: Record<string, { background: string; color: string }> = {
    sand: { background: T.sand, color: T.ink },
    ink: { background: T.ink, color: "#fff" },
    warn: { background: T.warnBg, color: T.warn },
    win: { background: T.winBg, color: T.win },
    pink: { background: T.pink, color: T.ink },
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap" style={styles[tone]}>
      {children}
    </span>
  );
}

/** Darwin's logo mark: the purple side-eye analyst disc. */
export function DarwinMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id="rsDisc" cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="#B9A4FF" />
          <stop offset="0.6" stopColor="#7C5CF0" />
          <stop offset="1" stopColor="#5536C9" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#rsDisc)" />
      <ellipse cx="14" cy="11" rx="7" ry="4" fill="#fff" opacity="0.28" />
      <ellipse cx="14.5" cy="20" rx="4" ry="3" fill="#fff" />
      <ellipse cx="25.5" cy="20" rx="4" ry="3" fill="#fff" />
      <circle cx="16" cy="20.3" r="1.7" fill={T.ink} />
      <circle cx="27" cy="20.3" r="1.7" fill={T.ink} />
      <path d="M11 15.5 l7 1.2 M29 15.5 l-7 1.2" stroke={T.ink} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M16 27 q4 2 8 0" stroke={T.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
