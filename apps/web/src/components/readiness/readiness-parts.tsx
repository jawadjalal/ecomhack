/**
 * Building blocks for /readiness in the cream Darwin design: score dial, the assistants strip (real
 * brand glyphs), code blocks, status icons and the loading crew. Presentational only.
 */
"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, X } from "lucide-react";
import type { CheckStatus, ReadinessCategory, ReadinessCheck, ReadinessReport } from "@/lib/contracts";
import { ASSISTANT_AGENTS } from "@/lib/readiness/robots";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { Tag, type Tone } from "@/components/dw/ui";
import { cn } from "@/components/ui/cn";

export const CATEGORY: Record<ReadinessCategory, { label: string; can: string; mascot: MascotKind; needs: string[] }> = {
  access: { label: "Reach", can: "Find and open your pages", mascot: "observer", needs: ["robots.txt lets assistants in", "No bot wall or captcha", "Served over HTTPS"] },
  understand: {
    label: "Read",
    can: "Read products, prices, delivery and returns",
    mascot: "analyst",
    needs: ["Product data with price and stock", "Delivery and returns as data", "Prices in the HTML, not only JavaScript", "A sitemap"],
  },
  act: { label: "Buy", can: "Search, ask and buy without scraping", mascot: "experimenter", needs: ["An llms.txt", "An MCP endpoint", "An A2A agent card", "The catalog as data"] },
};

export const CATEGORIES = Object.keys(CATEGORY) as ReadinessCategory[];

/** Points a check loses (warn = half). */
export const lost = (c: ReadinessCheck) => (c.status === "fail" ? c.weight : c.status === "warn" ? c.weight / 2 : 0);
export const pts = (n: number) => (n % 1 ? n.toFixed(1) : String(n));

export function scoreLook(score: number): { tone: Tone; shape: MascotKind; headline: string } {
  if (score >= 85) return { tone: "olive", shape: "shipper", headline: "AI agents can shop here" };
  if (score >= 55) return { tone: "yellow", shape: "designer", headline: "Agents can shop here, with gaps" };
  return { tone: "pink", shape: "experimenter", headline: "Most AI agents give up here" };
}

/** Ink ring on a faint track. */
export function ScoreDial({ score, size = 148 }: { score: number; size?: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(20,20,19,0.12)" strokeWidth="11" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="#141413"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(0.5, (score / 100) * c)} ${c}`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      <div className="relative flex flex-col items-center">
        <span className="num text-[46px] leading-none font-semibold tracking-[-0.03em]" data-testid="readiness-score">
          {score}
        </span>
        <span className="mt-1 text-[13px] text-dw-ink/60">out of 100</span>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<CheckStatus, { icon: typeof Check; cls: string; word: string }> = {
  pass: { icon: Check, cls: "bg-dw-win-bg text-dw-win", word: "Works" },
  warn: { icon: AlertTriangle, cls: "bg-dw-warn-bg text-dw-warn", word: "Partly" },
  fail: { icon: X, cls: "bg-dw-pink/70 text-dw-ink", word: "Missing" },
};

export function StatusIcon({ status, className }: { status: CheckStatus; className?: string }) {
  const s = STATUS_ICON[status];
  const Icon = s.icon;
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", s.cls, className)} aria-label={s.word} role="img">
      <Icon className="size-3.5" strokeWidth={2.4} />
    </span>
  );
}

export function CopyButton({ text, label = "Copy", dark }: { text: string; label?: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none",
        dark ? "bg-white/10 text-white/85 hover:bg-white/20" : "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
      )}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

/** Ink code block with a copy bar. Scrolls inside itself, never widens the page. */
export function CodeBlock({ code, maxH = "max-h-64" }: { code: string; maxH?: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[14px] bg-dw-ink">
      <div className="flex justify-end px-2 pt-2">
        <CopyButton text={code} dark />
      </div>
      <pre className={cn("overflow-auto px-3.5 pt-1 pb-3 font-dwmono text-[12.5px] leading-snug text-[#9EE6B8]", maxH)}>{code}</pre>
    </div>
  );
}

/** The live assistants we check in robots.txt, grouped by the product a shopper uses. */
const ASSISTANT_GROUPS: { name: string; match: RegExp }[] = [
  { name: "ChatGPT", match: /^(OAI-SearchBot|ChatGPT-User)$/ },
  { name: "Claude", match: /^Claude-/ },
  { name: "Perplexity", match: /^Perplexity/ },
  { name: "Gemini", match: /^Googlebot$/ },
  { name: "Siri", match: /^Applebot$/ },
];

/** Which assistants robots.txt lets in, from the robots-assistants check's evidence. */
export function assistantAccess(report: ReadinessReport): { name: string; allowed: boolean | null }[] {
  const robots = report.checks.find((c) => c.id === "robots-assistants");
  const blocked = new Set((robots?.evidence ?? []).filter((e) => e.endsWith("is disallowed")).map((e) => e.split(" ")[0]));
  return ASSISTANT_GROUPS.map((g) => {
    const tokens = ASSISTANT_AGENTS.filter((a) => g.match.test(a.token)).map((a) => a.token);
    // A failing check whose evidence we can't read: say "not checked" rather than claim access.
    const known = robots && (robots.status === "pass" || blocked.size > 0);
    return { name: g.name, allowed: known ? !tokens.some((t) => blocked.has(t)) : null };
  });
}

export function AssistantsStrip({ report }: { report: ReadinessReport }) {
  const list = assistantAccess(report);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {list.map((a) => (
        <li key={a.name} className="flex items-center gap-2.5 rounded-[16px] bg-dw-sand/70 px-3 py-2.5 sm:flex-col sm:items-start sm:gap-2">
          <AgentTile brand={agentBrand(a.name)} size={30} />
          <span className="min-w-0">
            <span className="block text-[14px] leading-tight font-medium">{a.name}</span>
            <span className={cn("block text-[12.5px] leading-tight", a.allowed === false ? "font-medium text-dw-warn" : "text-dw-ink/60")}>
              {a.allowed === null ? "Not checked" : a.allowed ? "Let in" : "Blocked"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal ink bar with a faint track (0..1). */
export function Meter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("relative block h-2.5 overflow-hidden rounded-full bg-dw-ink/10", className)}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-dw-ink transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export function verdictFor(ratio: number): { word: string; tone: "win" | "warn" | "pink" } {
  if (ratio >= 0.999) return { word: "Yes", tone: "win" };
  if (ratio >= 0.5) return { word: "Partly", tone: "warn" };
  return { word: "Not yet", tone: "pink" };
}

export const LOADING_STEPS: { label: string; mascot: MascotKind }[] = [
  { label: "Loading your storefront", mascot: "observer" },
  { label: "Reading robots.txt and the sitemap", mascot: "analyst" },
  { label: "Inspecting a product page", mascot: "designer" },
  { label: "Probing llms.txt, MCP and A2A", mascot: "experimenter" },
  { label: "Scoring", mascot: "shipper" },
];

/** The crew works through the audit, one step each. */
export function LoadingCrew({ step, host }: { step: number; host: string }) {
  return (
    <div className="flex min-h-[340px] flex-col justify-center gap-6 rounded-[26px] bg-dw-sand/70 p-6 sm:p-8" role="status" aria-live="polite" data-testid="readiness-loading">
      <div className="flex items-end justify-center gap-2 sm:gap-4">
        {LOADING_STEPS.map((s, i) => (
          <div key={s.mascot} className={cn("transition-[opacity,transform] duration-500", i === step ? "scale-110 opacity-100" : i < step ? "opacity-70" : "opacity-30")}>
            <Mascot kind={s.mascot} size={i === step ? 60 : 44} frame={i === step} state={i === step ? "working" : i < step ? "idle" : "sleeping"} />
          </div>
        ))}
      </div>
      <div className="text-center">
        <p className="text-[20px] font-semibold tracking-[-0.02em]">
          Checking <span className="break-all">{host}</span> like an AI shopper would
        </p>
        <p className="mt-1 text-[14px] text-dw-ink/60">Usually about 10 seconds.</p>
      </div>
      <ol className="mx-auto flex w-full max-w-[26rem] flex-col gap-1.5 text-[14.5px]">
        {LOADING_STEPS.map((s, i) => (
          <li key={s.label} className={cn("flex items-center gap-2.5", i < step ? "text-dw-ink/60" : i === step ? "font-medium text-dw-ink" : "text-dw-ink/30")}>
            {i < step ? (
              <StatusIcon status="pass" className="size-5" />
            ) : i === step ? (
              <span className="grid size-5 place-items-center">
                <span className="size-2.5 animate-pulse rounded-full bg-dw-ink" />
              </span>
            ) : (
              <span className="grid size-5 place-items-center">
                <span className="size-2 rounded-full border border-dw-ink/30" />
              </span>
            )}
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PointsTag({ c }: { c: ReadinessCheck }) {
  return (
    <Tag tone="white" className="num">
      +{pts(lost(c))} pts
    </Tag>
  );
}
