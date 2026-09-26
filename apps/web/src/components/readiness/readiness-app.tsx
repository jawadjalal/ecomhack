"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, Copy, Download, ExternalLink, LoaderCircle, Search, Share2, Sparkles, X } from "lucide-react";
import type { CheckStatus, ReadinessCategory, ReadinessCheck, ReadinessReport } from "@/lib/contracts";
import { DarwinWordmark } from "@/components/console/brand";
import { cn } from "@/components/ui/cn";

const CATEGORY: Record<ReadinessCategory, { label: string; blurb: string }> = {
  access: { label: "Access", blurb: "Can AI shopping assistants reach your store?" },
  understand: { label: "Understand", blurb: "Can they read products, prices, delivery and returns?" },
  act: { label: "Act", blurb: "Can they search, ask and buy through an API?" },
};

const STEPS = ["Loading your storefront", "Reading robots.txt and sitemap", "Inspecting a product page", "Probing llms.txt, MCP and A2A", "Scoring"];

const STATUS_STYLE: Record<CheckStatus, { icon: typeof Check; ring: string; text: string }> = {
  pass: { icon: Check, ring: "bg-good/15 text-[#8ff0b2]", text: "text-[#8ff0b2]" },
  warn: { icon: AlertTriangle, ring: "bg-warn/15 text-[#ffd27a]", text: "text-[#ffd27a]" },
  fail: { icon: X, ring: "bg-bad/15 text-[#ff9b9b]", text: "text-[#ff9b9b]" },
};

function gradeColor(score: number) {
  return score >= 85 ? "#8ff0b2" : score >= 55 ? "#ffd27a" : "#ff9b9b";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
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
      className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.72rem] text-white/70 hover:bg-white/[0.08] hover:text-white"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? "Copied" : label}
    </button>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 128 128" className="size-32 -rotate-90 sm:size-36">
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke={gradeColor(score)}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
    </svg>
  );
}

function CheckRow({ c }: { c: ReadinessCheck }) {
  const [open, setOpen] = useState(c.status === "fail");
  const s = STATUS_STYLE[c.status];
  const Icon = s.icon;
  const earned = c.status === "pass" ? c.weight : c.status === "warn" ? c.weight / 2 : 0;
  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", s.ring)}>
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white/90">{c.title}</span>
            {c.fix?.darwinCanFix && c.status !== "pass" && (
              <span className="rounded-md bg-brand/15 px-1.5 py-0.5 text-[0.66rem] font-semibold text-brand">Darwin can fix</span>
            )}
          </span>
          <span className="mt-0.5 block text-[0.86rem] leading-relaxed text-white/55">{c.detail}</span>
        </span>
        {!c.informational && (
          <span className={cn("shrink-0 font-mono text-[0.78rem] tabular-nums", s.text)}>
            {earned % 1 ? earned.toFixed(1) : earned}/{c.weight}
          </span>
        )}
      </button>
      {open && (c.evidence?.length || c.fix) && (
        <div className="flex flex-col gap-2.5 border-t border-white/[0.06] px-4 py-3 pl-13">
          {c.evidence?.length ? (
            <ul className="flex flex-col gap-0.5 font-mono text-[0.74rem] text-white/45">
              {c.evidence.map((e) => (
                <li key={e} className="truncate">
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
          {c.fix && c.status !== "pass" && (
            <div className="flex flex-col gap-2">
              <div className="text-[0.84rem] text-white/75">
                <span className="font-semibold text-white/90">Fix: </span>
                {c.fix.summary}
              </div>
              {c.fix.snippet && (
                <div className="relative">
                  <pre className="max-h-64 overflow-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[0.74rem] leading-snug text-white/75">
                    {c.fix.snippet}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyButton text={c.fix.snippet} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PilotCta({ report }: { report: ReadinessReport }) {
  const fixable = report.checks.filter((c) => c.status !== "pass" && c.fix?.darwinCanFix);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [pilotUrl, setPilotUrl] = useState<string | null>(null);
  if (!fixable.length) return null;
  const gain = fixable.reduce((s, c) => s + (c.status === "warn" ? c.weight / 2 : c.weight), 0);
  return (
    <div className="rounded-2xl border border-brand/25 bg-brand/[0.05] p-5">
      <div className="flex items-center gap-2 text-[0.8rem] font-semibold tracking-[0.12em] text-brand uppercase">
        <Sparkles className="size-4" /> Darwin can fix {fixable.length} of these
      </div>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-white/75">
        Worth up to <span className="font-semibold text-white">+{Math.round(gain)} points</span>: we host your agent layer (llms.txt, an MCP endpoint and an A2A merchant agent over
        your catalog), open a pull request with the structured data, then A/B test what agents and shoppers see. No theme rewrite.
      </p>
      {state === "done" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[0.9rem] text-[#8ff0b2]">
          <Check className="size-4" /> Thanks, we&apos;ll be in touch today.
          {pilotUrl && (
            <a href={pilotUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 font-semibold text-[#0b1200]">
              Start the pilot now <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      ) : (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setState("sending");
            const res = await fetch("/api/leads", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, storeUrl: report.url, score: report.score, source: "readiness" }),
            }).catch(() => null);
            if (!res?.ok) return setState("error");
            setPilotUrl(((await res.json()) as { pilotUrl: string | null }).pilotUrl);
            setState("done");
          }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourstore.com"
            className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none placeholder:text-white/30 focus:border-brand/50"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-semibold text-[#0b1200] hover:bg-[#c8f77c] disabled:opacity-60"
          >
            {state === "sending" ? <LoaderCircle className="size-4 animate-spin" /> : null} Fix it with Darwin
          </button>
        </form>
      )}
      {state === "error" && <div className="mt-2 text-[0.8rem] text-[#ff9b9b]">Couldn&apos;t save that. Check the email and try again.</div>}
    </div>
  );
}

function Report({ report }: { report: ReadinessReport }) {
  const scored = report.checks.filter((c) => !c.informational);
  const extra = report.checks.filter((c) => c.informational);
  const [copied, setCopied] = useState(false);
  const share = () => {
    const u = new URL(window.location.href);
    u.searchParams.set("url", report.url);
    void navigator.clipboard?.writeText(u.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const download = () => {
    const blob = new Blob([report.generated.llmsTxt], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "llms.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="flex flex-col gap-5" data-testid="readiness-report">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col items-start gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="relative flex shrink-0 items-center justify-center">
            <ScoreRing score={report.score} />
            <div className="absolute flex flex-col items-center">
              <span className="text-[2.6rem] leading-none font-semibold tabular-nums" data-testid="readiness-score">
                {report.score}
              </span>
              <span className="mt-1 text-[0.75rem] text-white/40">/ 100</span>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-1.5">
            <div className="text-[0.75rem] font-semibold tracking-[0.14em] text-white/40 uppercase">Agent readiness</div>
            <div className="text-[1.6rem] font-semibold" style={{ color: gradeColor(report.score) }}>
              Grade {report.grade}
            </div>
            <div className="truncate font-mono text-[0.8rem] text-white/55" title={report.url}>
              {report.url}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[0.74rem] text-white/40">
              {report.platform !== "unknown" && <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 capitalize text-white/60">{report.platform}</span>}
              <span>checked in {(report.durationMs / 1000).toFixed(1)}s</span>
              <button type="button" onClick={share} className="flex items-center gap-1 hover:text-white">
                <Share2 className="size-3" /> {copied ? "Link copied" : "Share"}
              </button>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
          {(Object.keys(CATEGORY) as ReadinessCategory[]).map((k) => {
            const cat = report.categories[k];
            const pct = cat.max ? (cat.score / cat.max) * 100 : 0;
            return (
              <div key={k}>
                <div className="flex items-baseline justify-between text-[0.85rem]">
                  <span>
                    <span className="font-semibold text-white/90">{CATEGORY[k].label}</span>
                    <span className="ml-2 hidden text-white/40 sm:inline">{CATEGORY[k].blurb}</span>
                  </span>
                  <span className="font-mono text-white/60 tabular-nums">
                    {cat.score}/{cat.max}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: gradeColor(pct) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <PilotCta report={report} />

      {(Object.keys(CATEGORY) as ReadinessCategory[]).map((k) => (
        <div key={k} className="flex flex-col gap-2">
          <h3 className="text-[0.78rem] font-semibold tracking-[0.14em] text-white/45 uppercase">{CATEGORY[k].label}</h3>
          <ul className="flex flex-col gap-2">
            {scored
              .filter((c) => c.category === k)
              .sort((a, b) => ["fail", "warn", "pass"].indexOf(a.status) - ["fail", "warn", "pass"].indexOf(b.status) || b.weight - a.weight)
              .map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
          </ul>
        </div>
      ))}

      <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-white/90">Your llms.txt, drafted from your store</div>
            <div className="text-[0.84rem] text-white/50">Review it, then upload it to the root of your site (yourstore.com/llms.txt).</div>
          </div>
          <div className="flex gap-2">
            <CopyButton text={report.generated.llmsTxt} />
            <button
              type="button"
              onClick={download}
              className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.72rem] text-white/70 hover:bg-white/[0.08] hover:text-white"
            >
              <Download className="size-3" /> Download
            </button>
          </div>
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[0.74rem] leading-snug text-white/70">
          {report.generated.llmsTxt}
        </pre>
      </div>

      {extra.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[0.78rem] font-semibold tracking-[0.14em] text-white/45 uppercase">Also worth knowing (not scored)</h3>
          <ul className="flex flex-col gap-2">
            {extra.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ReadinessApp({ initialUrl = "" }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (target: string) => {
    if (!target.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 1600);
    try {
      const res = await fetch("/api/readiness", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: target }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReport(body as ReadinessReport);
      const u = new URL(window.location.href);
      u.searchParams.set("url", (body as ReadinessReport).url);
      window.history.replaceState(null, "", u);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }, []);

  // A shared link (?url=…) runs the check straight away.
  useEffect(() => {
    if (!initialUrl) return;
    const t = setTimeout(() => void run(initialUrl), 0);
    return () => clearTimeout(t);
  }, [initialUrl, run]);

  const demo = () => {
    const target = `${window.location.origin}/store`;
    setUrl(target);
    void run(target);
  };

  return (
    <main data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-[60rem] flex-col gap-8 px-5 pb-20 sm:px-8">
        <nav className="flex h-20 items-center justify-between">
          <Link href="/">
            <DarwinWordmark sub="agent readiness" />
          </Link>
          <Link href="/console" className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[0.9rem] font-medium text-white/90 hover:bg-white/10">
            Mission control <ArrowRight className="size-4" />
          </Link>
        </nav>

        <header className="flex flex-col items-start gap-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand/[0.07] px-3 py-1 text-[0.8rem] font-medium text-brand">
            Free merchant tool
          </div>
          <h1 className="text-[2.3rem] leading-[1.05] font-semibold tracking-[-0.04em] sm:text-[3.2rem]">Can AI agents buy from your store?</h1>
          <p className="max-w-[40rem] text-[1.05rem] leading-relaxed text-white/60">
            More shoppers now ask ChatGPT, Claude or Perplexity to find and buy things for them. Check in about 10 seconds whether those agents can reach your store, read your
            prices and stock, and check out, with the exact fixes.
          </p>
          <form
            className="flex w-full flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(url);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-white/35" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="yourstore.com"
                aria-label="Store URL"
                className="h-13 w-full rounded-xl border border-white/12 bg-black/30 pr-4 pl-11 text-[1rem] text-white outline-none placeholder:text-white/30 focus:border-brand/50"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex h-13 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-[1rem] font-semibold text-[#0b1200] hover:bg-[#c8f77c] disabled:opacity-60"
            >
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Check my store
            </button>
          </form>
          <button type="button" onClick={demo} className="text-[0.85rem] text-white/45 underline-offset-2 hover:text-white hover:underline">
            No store handy? Check our demo store →
          </button>
        </header>

        {error && <div className="rounded-xl border border-bad/30 bg-bad/[0.08] px-4 py-3 text-[0.9rem] text-[#ffb4b4]">{error}</div>}

        {loading && (
          <ol className="flex flex-col gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5 text-[0.9rem]">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("flex items-center gap-2", i < step ? "text-white/60" : i === step ? "text-white" : "text-white/25")}>
                {i < step ? <Check className="size-4 text-[#8ff0b2]" /> : i === step ? <LoaderCircle className="size-4 animate-spin" /> : <span className="size-4" />}
                {s}
              </li>
            ))}
          </ol>
        )}

        {report && <Report report={report} />}
      </div>
    </main>
  );
}
