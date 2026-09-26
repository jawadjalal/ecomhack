"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MotionConfig, motion } from "motion/react";
import { ArrowRight, Award, Check, ChevronDown, Download, ExternalLink, LoaderCircle, RotateCcw, Share2, Store } from "lucide-react";
import type { ReadinessCertificate, ReadinessCheck, ReadinessReport } from "@/lib/contracts";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { BrandGlyph, type BrandKey } from "@/components/dw/brand-logos";
import { Mascot } from "@/components/dw/mascot";
import { Card, CardTitle, Empty, PillButton, Tag } from "@/components/dw/ui";
import { cn } from "@/components/ui/cn";
import { CertificateEmbed } from "@/components/readiness/certificate-embed";
import { CertificateSeal, CriteriaGrid, LEVEL_STYLE } from "@/components/readiness/certificate-view";
import { ReadinessNav } from "@/components/readiness/readiness-nav";
import { GLOW, NAV_LINK } from "@/components/readiness/styles";
import {
  AssistantsStrip,
  CATEGORIES,
  CATEGORY,
  CodeBlock,
  CopyButton,
  LOADING_STEPS,
  LoadingCrew,
  Meter,
  PointsTag,
  ScoreDial,
  StatusIcon,
  lost,
  pts,
  scoreLook,
  verdictFor,
} from "@/components/readiness/readiness-parts";

const EASE = [0.2, 0.8, 0.2, 1] as const;

const ASSISTANTS: { brand: BrandKey; name: string }[] = [
  { brand: "openai", name: "ChatGPT" },
  { brand: "claude", name: "Claude" },
  { brand: "perplexity", name: "Perplexity" },
  { brand: "gemini", name: "Gemini" },
];

const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).host;
  } catch {
    return u;
  }
};

/** One check in the full list: status, what we found, and the evidence on demand. */
function CheckRow({ c }: { c: ReadinessCheck }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!c.evidence?.length || (!!c.fix && c.status !== "pass" && !!c.informational);
  return (
    <li className="rounded-[18px] bg-dw-sand/60">
      <button
        type="button"
        onClick={() => hasMore && setOpen((v) => !v)}
        aria-expanded={hasMore ? open : undefined}
        className={cn("flex w-full items-start gap-3 rounded-[18px] px-3.5 py-3 text-left focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none", !hasMore && "cursor-default")}
      >
        <StatusIcon status={c.status} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] leading-snug font-medium">{c.title}</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-dw-ink/65">{c.detail}</span>
        </span>
        {!c.informational && (
          <span className="num shrink-0 pt-0.5 font-dwmono text-[12px] text-dw-ink/55">
            {pts(c.weight - lost(c))}/{c.weight}
          </span>
        )}
        {hasMore && <ChevronDown className={cn("mt-1 size-4 shrink-0 text-dw-ink/45 transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5 pl-[3.1rem]">
          {c.evidence?.length ? (
            <ul className="flex min-w-0 flex-col gap-0.5 font-dwmono text-[12px] text-dw-ink/55">
              {c.evidence.map((e) => (
                <li key={e} className="break-all">
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
          {c.fix && c.status !== "pass" && c.informational && <p className="text-[13px] text-dw-ink/75">{c.fix.summary}</p>}
        </div>
      )}
    </li>
  );
}

/** A prioritised fix: what's wrong, what it's worth, and the exact change. */
function FixRow({ c, n, defaultOpen }: { c: ReadinessCheck; n: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <li className="rounded-[20px] bg-dw-sand/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 rounded-[20px] px-4 py-3.5 text-left focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
      >
        <span className="num mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-dw-ink text-[13px] font-semibold text-white">{n}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15.5px] leading-snug font-medium">{c.title}</span>
          </span>
          <span className="mt-0.5 block text-[13.5px] leading-snug text-dw-ink/65">{c.detail}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <PointsTag c={c} />
            {c.fix?.darwinCanFix && <Tag tone="ink">Darwin can fix</Tag>}
            <Tag tone="outline">{CATEGORY[c.category].label}</Tag>
          </span>
        </span>
        <ChevronDown className={cn("mt-1.5 size-4 shrink-0 text-dw-ink/45 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-2.5 px-4 pb-4 sm:pl-[3.6rem]">
          {c.fix && (
            <p className="text-[14px] leading-snug">
              <span className="font-semibold">The fix: </span>
              {c.fix.summary}
            </p>
          )}
          {c.fix?.snippet && <CodeBlock code={c.fix.snippet} />}
          {c.evidence?.length ? (
            <ul className="flex min-w-0 flex-col gap-0.5 font-dwmono text-[12px] text-dw-ink/55">
              {c.evidence.map((e) => (
                <li key={e} className="break-all">
                  {e}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** "Let Darwin fix these": into onboarding, or leave an email (stored as a lead). */
function PilotCta({ report }: { report: ReadinessReport }) {
  const open = report.checks.filter((c) => !c.informational && c.status !== "pass");
  const fixable = open.filter((c) => c.fix?.darwinCanFix);
  const gain = Math.round(fixable.reduce((s, c) => s + lost(c), 0));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [pilotUrl, setPilotUrl] = useState<string | null>(null);
  return (
    <Card tone="lilac" shape="analyst" corner="br" hover={false} className="flex flex-col lg:sticky lg:top-6 lg:self-start" data-testid="readiness-cta">
      <div className="flex items-center gap-1.5">
        {(["observer", "designer", "experimenter", "shipper"] as const).map((k) => (
          <Mascot key={k} kind={k} size={34} active={false} />
        ))}
      </div>
      <h2 className="mt-4 text-[26px] leading-[1.1] font-semibold tracking-[-0.025em]">
        {fixable.length ? "Let Darwin fix these" : open.length ? "Darwin watches what agents do next" : "Agents can shop here. Now watch them."}
      </h2>
      <p className="mt-2 text-[15px] leading-snug text-dw-ink/75">
        {fixable.length ? (
          <>
            Darwin can fix <b>{fixable.length}</b> of {open.length}, worth up to <b className="num">+{gain} points</b>. It hosts your llms.txt, an MCP endpoint and an A2A merchant
            agent over your catalog, opens a pull request with the structured data, then A/B tests what agents and shoppers see.
          </>
        ) : (
          "Darwin shows you what AI shoppers and people do once they arrive, finds where they drop off, and A/B tests the page for both."
        )}
      </p>
      <PillButton href="/onboarding" size="lg" className="group mt-5 w-full sm:w-fit">
        {fixable.length ? "Let Darwin fix these" : "Set up Darwin"} <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
      </PillButton>

      <div className="mt-6 border-t border-dw-ink/10 pt-4">
        {state === "done" ? (
          <div className="flex flex-wrap items-center gap-3 text-[14px] text-dw-win" data-testid="readiness-lead-done">
            <span className="flex items-center gap-1.5 font-medium">
              <Check className="size-4" /> Thanks, we&apos;ll be in touch today.
            </span>
            {pilotUrl && (
              <a
                href={pilotUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-medium text-dw-ink hover:bg-[#fffaf0]"
              >
                Start the pilot now <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-2"
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
            <label htmlFor="readiness-email" className="text-[14px] text-dw-ink/75">
              Rather have a person set it up with you? Leave your email.
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="readiness-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourstore.com"
                className="h-11 w-full min-w-0 rounded-full border border-dw-ink/10 bg-white/85 px-4 text-[15px] text-dw-ink outline-none placeholder:text-dw-ink/35 focus:border-dw-ink/40 focus-visible:ring-2 focus-visible:ring-dw-ink/15 sm:flex-1"
              />
              <PillButton type="submit" tone="white" disabled={state === "sending"} className="h-11">
                {state === "sending" && <LoaderCircle className="animate-spin" />} Email me
              </PillButton>
            </div>
            {state === "error" && <p className="text-[13px] text-dw-warn">Couldn&apos;t save that. Check the email and try again.</p>}
          </form>
        )}
      </div>
    </Card>
  );
}

function certifySteps(report: ReadinessReport): string[] {
  const mcp = report.checks.some((c) => c.id === "mcp" && c.status === "pass");
  return [
    "Re-running the audit",
    mcp ? "Grok is shopping your store over MCP (no real checkout)" : "Grok is reading your storefront like an agent",
    "Checking price, sizes, delivery and returns",
    "Issuing your certificate",
  ];
}

/** "Get certified by Grok": Grok shops the store as an agent, then a Gold/Silver/Bronze certificate + badge. */
function CertifyPanel({ report }: { report: ReadinessReport }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [step, setStep] = useState(0);
  const [cert, setCert] = useState<ReadinessCertificate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steps = certifySteps(report);

  const certify = async () => {
    setState("running");
    setError(null);
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(steps.length - 1, s + 1)), 4000);
    try {
      const res = await fetch("/api/readiness/certify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: report.url }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setCert(body as ReadinessCertificate);
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    } finally {
      clearInterval(timer);
    }
  };

  if (state === "done" && cert) {
    const s = LEVEL_STYLE[cert.level];
    return (
      <section className="flex min-w-0 flex-col gap-5 rounded-[26px] border p-6" style={{ borderColor: s.border, background: s.glow }} data-testid="readiness-certificate-result">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <CertificateSeal level={cert.level} score={cert.score} className="size-28" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[14px] text-dw-ink/65">
              {!cert.heuristic && <AgentTile brand={agentBrand("grok")} size={22} />}
              {cert.heuristic ? "Certificate from the audit score (no agent trial ran)" : `Certified by ${cert.model.replace(/^llm:/, "")}`}
            </div>
            <h2 className="text-[26px] leading-[1.1] font-semibold tracking-[-0.025em]">{cert.level === "none" ? "Not certified yet" : `${s.label} agent-ready`}</h2>
            <p className="text-[15px] leading-snug text-dw-ink/75">{cert.verdict}</p>
            <a
              href={`/readiness/certificate/${cert.id}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-dw-ink px-4 text-[14px] font-medium text-white transition-colors hover:bg-black"
            >
              View certificate <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
        {cert.trial && <CriteriaGrid criteria={cert.trial.criteria} />}
        <CertificateEmbed certId={cert.id} levelLabel={s.label} compact />
      </section>
    );
  }

  return (
    <Card tone="blue" shape="observer" corner="tr" hover={false} className="min-w-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <AgentTile brand={agentBrand("grok")} size={44} />
          <div className="min-w-0">
            <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Get certified by Grok</h2>
            <p className="mt-1 max-w-[46rem] text-[14.5px] leading-snug text-dw-ink/75">
              Grok tries to shop your store as an AI agent (never completing a real checkout), then issues a Gold, Silver or Bronze certificate with a badge for your site.
              Takes up to a minute.
            </p>
          </div>
        </div>
        <PillButton size="lg" onClick={() => void certify()} disabled={state === "running"} className="w-full sm:w-auto" data-testid="readiness-certify">
          {state === "running" ? <LoaderCircle className="animate-spin" /> : <Award />} {state === "running" ? "Certifying" : "Get certified"}
        </PillButton>
      </div>
      {state === "running" && (
        <ol className="mt-4 flex flex-col gap-1.5 text-[14.5px]" role="status" aria-live="polite">
          {steps.map((label, i) => (
            <li key={label} className={cn("flex items-center gap-2.5", i < step ? "text-dw-ink/60" : i === step ? "font-medium text-dw-ink" : "text-dw-ink/35")}>
              {i < step ? (
                <StatusIcon status="pass" className="size-5" />
              ) : (
                <span className="grid size-5 place-items-center">
                  <span className={cn("rounded-full", i === step ? "size-2.5 animate-pulse bg-dw-ink" : "size-2 border border-dw-ink/30")} />
                </span>
              )}
              {label}
            </li>
          ))}
        </ol>
      )}
      {error && <p className="mt-3 rounded-[14px] bg-dw-warn-bg px-3.5 py-2 text-[14px] text-dw-warn">{error}</p>}
    </Card>
  );
}

function Report({ report }: { report: ReadinessReport }) {
  const scored = report.checks.filter((c) => !c.informational);
  const extra = report.checks.filter((c) => c.informational);
  const fixes = scored.filter((c) => c.status !== "pass").sort((a, b) => lost(b) - lost(a) || b.weight - a.weight);
  const look = scoreLook(report.score);
  const host = hostOf(report.url);
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
    <section className="flex flex-col gap-4" data-testid="readiness-report">
      {/* score + what agents can do */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.7fr]">
        <Card tone={look.tone} shape={look.shape} corner="br" hover={false} className="flex min-w-0 flex-col justify-center">
          <div className="flex min-w-0 items-center gap-5">
            <ScoreDial score={report.score} size={136} />
            <div className="min-w-0">
              <Tag tone="ink" className="num">
                Grade {report.grade}
              </Tag>
              <p className="mt-2 text-[24px] leading-[1.1] font-semibold tracking-[-0.025em]">{look.headline}</p>
            </div>
          </div>
          <div className="mt-5 flex min-w-0 flex-col gap-1 text-[13.5px] text-dw-ink/70">
            <span className="truncate font-dwmono text-[13px] text-dw-ink" title={report.url}>
              {report.url}
            </span>
            {report.productUrl && (
              <span className="truncate" title={report.productUrl}>
                Product page read: <span className="font-dwmono text-[12.5px]">{report.productUrl.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {report.platform !== "unknown" && (
              <Tag tone="white" className="capitalize">
                {report.platform}
              </Tag>
            )}
            <Tag tone="white" className="num">
              Checked in {(report.durationMs / 1000).toFixed(1)}s
            </Tag>
            <button
              type="button"
              onClick={share}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-dw-ink px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-black"
            >
              {copied ? <Check className="size-3" /> : <Share2 className="size-3" />} {copied ? "Link copied" : "Share"}
            </button>
          </div>
        </Card>

        <Card tone="white" hover={false} className="min-w-0">
          <CardTitle right={<span className="num max-sm:hidden">{host}</span>}>What AI agents can do here</CardTitle>
          <ul className="mt-5 flex flex-col gap-4">
            {CATEGORIES.map((k) => {
              const cat = report.categories[k];
              const ratio = cat.max ? cat.score / cat.max : 0;
              const v = verdictFor(ratio);
              return (
                <li key={k} className="grid grid-cols-[2.25rem_1fr] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[2.25rem_minmax(0,1fr)_10rem_auto]">
                  <Mascot kind={CATEGORY[k].mascot} size={36} active={false} className="row-span-2 sm:row-span-1" />
                  <span className="min-w-0">
                    <span className="block text-[15.5px] leading-tight font-medium">{CATEGORY[k].can}</span>
                    <span className="text-[12.5px] text-dw-ink/55">{CATEGORY[k].label}</span>
                  </span>
                  <span className="flex items-center gap-2.5 sm:contents">
                    <Meter value={ratio} className="flex-1 sm:w-40" />
                    <span className="flex items-center gap-2 sm:justify-self-end">
                      <span className="num font-dwmono text-[12.5px] text-dw-ink/60">
                        {cat.score}/{cat.max}
                      </span>
                      <Tag tone={v.tone} className="w-[4.6rem] justify-center">
                        {v.word}
                      </Tag>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-6">
            <p className="mb-2.5 text-[14px] text-dw-ink/70">Which shopping assistants robots.txt lets in</p>
            <AssistantsStrip report={report} />
          </div>
        </Card>
      </div>

      <CertifyPanel key={report.url + report.checkedAt} report={report} />

      {/* prioritised fixes + the way into Darwin */}
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Card tone="white" hover={false} className="min-w-0">
          <CardTitle right={fixes.length ? <span className="num">{fixes.length} to fix, biggest first</span> : undefined}>
            {fixes.length ? "Fix these first" : "Nothing to fix"}
          </CardTitle>
          {fixes.length ? (
            <ol className="mt-4 flex flex-col gap-2">
              {fixes.map((c, i) => (
                <FixRow key={c.id} c={c} n={i + 1} defaultOpen={i === 0} />
              ))}
            </ol>
          ) : (
            <Empty mascot={<Mascot kind="shipper" frame size={64} active />}>Agents can reach your store, read your products and buy through an API. Nice work.</Empty>
          )}
        </Card>
        <PilotCta report={report} />
      </div>

      {/* every check, by what it lets agents do */}
      <Card tone="white" hover={false} className="min-w-0">
        <CardTitle right={<span className="num">{scored.length} checks</span>}>Everything we checked</CardTitle>
        <div className="mt-5 grid gap-6 lg:grid-cols-3 lg:gap-4">
          {CATEGORIES.map((k) => (
            <div key={k} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2 px-1">
                <h3 className="text-[16px] font-semibold">{CATEGORY[k].label}</h3>
                <span className="num font-dwmono text-[12.5px] text-dw-ink/55">
                  {report.categories[k].score}/{report.categories[k].max}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {scored
                  .filter((c) => c.category === k)
                  .sort((a, b) => ["fail", "warn", "pass"].indexOf(a.status) - ["fail", "warn", "pass"].indexOf(b.status) || b.weight - a.weight)
                  .map((c) => (
                    <CheckRow key={c.id} c={c} />
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {/* llms.txt + unscored notes */}
      <div className={cn("grid gap-4", extra.length > 0 && "lg:grid-cols-[1.7fr_1fr]")}>
        <Card tone="white" hover={false} className="min-w-0">
          <CardTitle>Your llms.txt, drafted from your store</CardTitle>
          <p className="mt-1.5 text-[14px] text-dw-ink/65">Review it, then upload it to the root of your site (yourstore.com/llms.txt).</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={report.generated.llmsTxt} label="Copy llms.txt" />
            <PillButton tone="sand" size="sm" onClick={download}>
              <Download /> Download
            </PillButton>
          </div>
          <div className="mt-3">
            <CodeBlock code={report.generated.llmsTxt} maxH="max-h-72" />
          </div>
        </Card>
        {extra.length > 0 && (
          <Card tone="sand" hover={false} className="min-w-0">
            <CardTitle>Also worth knowing</CardTitle>
            <p className="mt-1.5 text-[14px] text-dw-ink/65">Not scored: business choices and standards that are still emerging.</p>
            <ul className="mt-4 flex flex-col gap-1.5">
              {extra.map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </section>
  );
}

/** Before the first check: what we look at, and the way into Darwin. */
function Intro() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]" data-testid="readiness-intro">
      <Card tone="white" hover={false} className="min-w-0 lg:min-h-[340px]">
        <CardTitle>What agents need from your store</CardTitle>
        <div className="mt-5 grid gap-5 sm:grid-cols-3 sm:gap-4">
          {CATEGORIES.map((k) => (
            <div key={k} className="min-w-0">
              <div className="flex items-center gap-2.5">
                <Mascot kind={CATEGORY[k].mascot} size={34} active={false} />
                <span className="text-[17px] font-semibold">{CATEGORY[k].label}</span>
              </div>
              <p className="mt-2 text-[14px] leading-snug text-dw-ink/70">{CATEGORY[k].can}.</p>
              <ul className="mt-2.5 flex flex-col gap-1.5 text-[13.5px]">
                {CATEGORY[k].needs.map((n) => (
                  <li key={n} className="flex items-start gap-2">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-dw-ink/40" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
      <Card tone="yellow" shape="shipper" corner="br" hover={false} className="flex min-w-0 flex-col">
        <h2 className="text-[24px] leading-[1.1] font-semibold tracking-[-0.025em]">Darwin fixes most of it for you</h2>
        <p className="mt-2 text-[15px] leading-snug text-dw-ink/75">
          It hosts an agent layer for your store (llms.txt, MCP and an A2A merchant agent), then A/B tests what agents and shoppers see.
        </p>
        <div className="mt-auto pt-5">
          <PillButton href="/onboarding" size="lg" className="group w-full sm:w-fit">
            Set up your store <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </PillButton>
        </div>
      </Card>
    </div>
  );
}

function ErrorCard({ message, onRetry, onDemo }: { message: string; onRetry: () => void; onDemo: () => void }) {
  return (
    <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 rounded-[26px] bg-dw-warn-bg px-6 py-10 text-center" role="alert" data-testid="readiness-error">
      <Mascot kind="leader" frame size={64} state="error" title="Darwin" />
      <div>
        <p className="text-[22px] font-semibold tracking-[-0.02em]">We couldn&apos;t check that store</p>
        <p className="mx-auto mt-1.5 max-w-[34rem] text-[15px] break-words text-dw-warn">{message}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <PillButton onClick={onRetry}>
          <RotateCcw /> Try again
        </PillButton>
        <PillButton tone="white" onClick={onDemo}>
          Check our demo store
        </PillButton>
      </div>
    </div>
  );
}

export function ReadinessApp({ initialUrl = "" }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState("");
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const results = useRef<HTMLDivElement>(null);

  const run = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setStep(0);
    setTarget(value.trim());
    const timer = setInterval(() => setStep((s) => Math.min(LOADING_STEPS.length - 1, s + 1)), 1600);
    try {
      const res = await fetch("/api/readiness", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: value }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? (res.status === 429 ? "Too many checks. Try again in a few minutes." : `The audit failed (HTTP ${res.status}).`));
      setReport(body as ReadinessReport);
      const u = new URL(window.location.href);
      u.searchParams.set("url", (body as ReadinessReport).url);
      window.history.replaceState(null, "", u);
    } catch (e) {
      setError(e instanceof TypeError ? "We couldn't reach Darwin. Check your connection and try again." : (e as Error).message);
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

  // Bring the results into view when they land below the fold.
  useEffect(() => {
    if (!report || !results.current) return;
    if (results.current.getBoundingClientRect().top > window.innerHeight * 0.4) results.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [report]);

  const demo = () => {
    const t = `${window.location.origin}/store`;
    setUrl(t);
    void run(t);
  };

  const rise = (delay: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay, ease: EASE } });

  return (
    <MotionConfig reducedMotion="user">
      <div data-dw className="relative isolate flex min-h-[100svh] w-full flex-col overflow-x-hidden bg-dw-bg font-dw text-dw-ink">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[56rem]" style={{ background: GLOW }} />

        <ReadinessNav>
          <Link href="/store" className={NAV_LINK} aria-label="Demo store">
            <Store className="size-4" aria-hidden />
            <span className="max-sm:hidden">Demo store</span>
          </Link>
          <Link href="/console" className={cn(NAV_LINK, "max-sm:hidden")}>
            Open Darwin
          </Link>
          <PillButton href="/onboarding" size="sm" className="ml-1.5 h-9 px-4">
            Get started
          </PillButton>
        </ReadinessNav>

        <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-4 pb-24 sm:px-7">
          {/* hero */}
          <section className="mx-auto flex w-full max-w-[52rem] flex-col items-center pt-10 text-center sm:pt-14">
            <motion.h1 {...rise(0.05)} className="isolate text-[34px] leading-[1.06] font-semibold tracking-[-0.035em] text-balance sm:text-[52px]">
              Can AI agents{" "}
              <span className="relative inline-block">
                <motion.span
                  aria-hidden
                  className="absolute inset-x-[-0.1em] bottom-[0.06em] -z-10 h-[0.4em] rounded-full bg-dw-yellow"
                  style={{ originX: 0 }}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.45, duration: 0.7, ease: EASE }}
                />
                buy from your store?
              </span>
            </motion.h1>
            <motion.p {...rise(0.12)} className="mt-4 max-w-[40rem] text-[16px] leading-snug text-dw-ink/70 sm:text-[18px]">
              Paste your store&apos;s address. In about 10 seconds you&apos;ll see what AI shopping assistants can and can&apos;t do there, and exactly what to fix.
            </motion.p>

            <motion.form
              {...rise(0.18)}
              className="mt-7 flex w-full flex-col gap-2 rounded-[30px] border border-dw-hairline bg-dw-surface p-2 shadow-[0_30px_70px_-34px_rgba(20,20,19,0.35)] transition-[border-color] focus-within:border-dw-ink/25 sm:flex-row sm:items-center sm:rounded-full"
              onSubmit={(e) => {
                e.preventDefault();
                void run(url);
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-2">
                <Mascot kind="observer" size={34} state={loading ? "working" : "idle"} className="max-sm:hidden" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="yourstore.com"
                  aria-label="Store URL"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-12 w-full min-w-0 bg-transparent px-2 font-dwmono text-[16px] text-dw-ink outline-none placeholder:text-dw-ink/35"
                />
              </div>
              <PillButton type="submit" size="lg" disabled={loading} className="h-12 min-w-[11.5rem]">
                {loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
                {loading ? "Checking" : "Check my store"}
              </PillButton>
            </motion.form>

            <motion.div {...rise(0.24)} className="mt-4 flex flex-col items-center gap-2.5 text-[13.5px] text-dw-ink/55">
              <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <span>Checks access for</span>
                <span className="flex items-center gap-3 text-dw-ink/60">
                  {ASSISTANTS.map((a) => (
                    <BrandGlyph key={a.brand} brand={a.brand} size={16} title={a.name} />
                  ))}
                </span>
                <span>and any agent that speaks MCP or A2A</span>
              </span>
              <button type="button" onClick={demo} disabled={loading} className="rounded-full px-2 py-0.5 text-dw-ink/70 underline decoration-dw-ink/25 underline-offset-4 hover:text-dw-ink disabled:opacity-50">
                No store handy? Check our demo store
              </button>
            </motion.div>
          </section>

          {/* intro → loading → error | report; each fills the same space so nothing jumps */}
          <div ref={results} className="mt-10 scroll-mt-6 sm:mt-14">
            {loading ? (
              <LoadingCrew step={step} host={hostOf(target)} />
            ) : error ? (
              <ErrorCard message={error} onRetry={() => void run(target || url)} onDemo={demo} />
            ) : report ? (
              <motion.div key={report.url + report.checkedAt} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
                <Report report={report} />
              </motion.div>
            ) : (
              <Intro />
            )}
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}
