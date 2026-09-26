"use client";

/**
 * /readiness: "Can AI agents buy from your store?" Everything on the page comes from a live run of
 * GET /api/readiness/stream: each page Darwin fetches, the scored audit, then Grok (the agent trial) talking to the
 * store turn by turn, then the certificate. Nothing is canned: before a run there are no numbers on the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, Minus, Search, X } from "lucide-react";
import type { CertificateTrial, CertificateTrialStep, CheckStatus, ReadinessCategory, ReadinessCertificate, ReadinessCheck, ReadinessReport } from "@/lib/contracts";
import type { ReadinessProgress } from "@/lib/readiness/audit";
import { BrandGlyph } from "@/components/dw/brand-logos";
import { Mascot } from "@/components/dw/mascot";
import { Typing } from "@/components/dw/ui";
import { cn } from "@/components/ui/cn";
import { CertificateEmbed } from "@/components/readiness/certificate-embed";
import { CertificateSeal, CriteriaGrid, JudgeBadge, LEVEL_STYLE, isGrok } from "@/components/readiness/certificate-view";

type StreamEvent = ReadinessProgress | { type: "done"; report?: ReadinessReport; cert: ReadinessCertificate } | { type: "error"; error: string; report?: ReadinessReport };

interface FetchRow {
  id: string;
  label: string;
  status: number;
  ms: number;
  tools?: string[];
}

type ChatMsg =
  | { from: "system"; text: string }
  | { from: "grok"; text: string; tool?: string; args?: Record<string, unknown> }
  | { from: "store"; text: string; ok: boolean; blocked?: boolean };

const CATEGORY: Record<ReadinessCategory, string> = {
  access: "Can agents get in?",
  understand: "Can they read your products?",
  act: "Can they buy?",
};

const GROUP: { status: CheckStatus; title: string; tone: string; chip: string; icon: typeof Check }[] = [
  { status: "pass", title: "Pass", tone: "bg-dw-win-bg", chip: "bg-dw-win text-white", icon: Check },
  { status: "warn", title: "Fix", tone: "bg-dw-warn-bg", chip: "bg-dw-warn text-white", icon: Minus },
  { status: "fail", title: "Fail", tone: "bg-[#fbdcdc]", chip: "bg-[#a3302b] text-white", icon: X },
];

const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).host;
  } catch {
    return u;
  }
};

/** What a fetch status means, in plain words. */
function fetchWord(r: FetchRow): { word: string; good: boolean } {
  if (r.id === "mcp") return r.status >= 200 && r.status < 300 && r.tools ? { word: `${r.tools.length} tools`, good: true } : { word: "none", good: false };
  if (r.status >= 200 && r.status < 300) return { word: "found", good: true };
  if (r.status === 404) return { word: "not there", good: false };
  if (r.status === 401 || r.status === 403) return { word: "blocked", good: false };
  if (r.status === 0) return { word: "no answer", good: false };
  return { word: `error ${r.status}`, good: false };
}

/** A tool call in words: "search_products" → "search products". */
const toolWords = (t: string) => t.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

function argsLine(args?: Record<string, unknown>): string {
  if (!args) return "";
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  const s = parts.join(", ");
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

/** The store's answer, cleaned for reading ("ok: {…}" → the JSON, trimmed). */
function storeText(step: CertificateTrialStep): string {
  if (step.blocked) return "Blocked by Darwin: agents never pay during a check.";
  return step.note.replace(/^ok:\s*/, "").replace(/^error:\s*/, "Error: ");
}

function stepMessages(step: CertificateTrialStep): ChatMsg[] {
  return [
    { from: "grok", text: step.thought?.trim() || `Let me ${toolWords(step.tool)}.`, tool: step.tool, args: step.args },
    { from: "store", text: storeText(step), ok: step.ok, blocked: step.blocked },
  ];
}

function trialMessages(trial: CertificateTrial): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const s of trial.steps ?? []) out.push(...stepMessages(s));
  out.push({ from: "grok", text: trial.summary });
  return out;
}

/* ------------------------------------------------------------------ small parts */

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="inline-flex h-7 items-center gap-1 rounded-full bg-dw-ink px-2.5 text-[12px] font-medium text-white hover:bg-black"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function GrokTile({ size = 30 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-dw-ink text-white" style={{ width: size, height: size }} aria-label="Grok">
      <BrandGlyph brand="grok" size={Math.round(size * 0.52)} className="text-white" />
    </span>
  );
}

function StoreTile({ size = 30 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-dw-blue" style={{ width: size, height: size }} aria-label="Your store">
      <Mascot kind="shipper" size={Math.round(size * 0.8)} />
    </span>
  );
}

/* ------------------------------------------------------------------ live panes */

function FetchFeed({ rows, host, report, running }: { rows: FetchRow[]; host: string; report: ReadinessReport | null; running: boolean }) {
  return (
    <section className="flex min-w-0 flex-col rounded-[26px] border border-dw-hairline bg-dw-surface p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Mascot kind="observer" size={40} active={running && !report} />
        <div className="min-w-0">
          <div className="text-[17px] font-semibold">Darwin is reading {host}</div>
          <div className="text-[13px] text-dw-muted">Every page an agent would look at, fetched live.</div>
        </div>
      </div>
      <ol className="mt-4 flex flex-col gap-1.5">
        {rows.map((r) => {
          const w = fetchWord(r);
          return (
            <li key={r.id} className="rd-in flex min-w-0 items-center gap-3 rounded-[14px] bg-dw-bg px-3 py-2">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", w.good ? "bg-dw-win-bg text-dw-win" : "bg-dw-sand text-dw-muted")}>
                {w.good ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{r.label}</span>
              <span className={cn("shrink-0 text-[12px] font-medium", w.good ? "text-dw-win" : "text-dw-muted")}>{w.word}</span>
              <span className="hidden w-12 shrink-0 text-right font-dwmono text-[11px] text-dw-muted tabular-nums sm:block">{r.ms}ms</span>
            </li>
          );
        })}
        {running && !report && (
          <li className="flex items-center gap-3 px-3 py-2 text-[14px] text-dw-muted">
            <Typing /> {rows.length ? "Waiting for the rest of your pages…" : `Opening ${host}…`}
          </li>
        )}
      </ol>
      {report && (
        <div className="rd-in mt-4 flex items-center justify-between gap-3 rounded-[18px] bg-dw-yellow px-4 py-3">
          <span className="text-[14px] font-medium">Score from {rows.length} pages</span>
          <span className="font-dwmono text-[20px] font-semibold tabular-nums">{report.score}/100</span>
        </div>
      )}
    </section>
  );
}

function ChatPane({
  agent,
  mode,
  msgs,
  thinking,
  waiting,
  host,
}: {
  agent: string | null;
  mode: "mcp" | "page" | "none" | null;
  msgs: ChatMsg[];
  thinking: boolean;
  waiting: boolean;
  host: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current?.parentElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, thinking]);
  const grok = /grok/i.test(agent ?? "Grok");
  const who = grok ? "Grok" : agent === "Rules" ? "Darwin" : "The agent";
  return (
    <section className="flex min-w-0 flex-col rounded-[26px] bg-dw-blue p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {grok ? <GrokTile size={40} /> : <Mascot kind="designer" size={40} />}
          <StoreTile size={40} />
        </div>
        <div className="min-w-0">
          <div className="text-[17px] font-semibold">
            {who} <span className="text-dw-ink/50">↔</span> your store
          </div>
          <div className="text-[13px] text-dw-ink/65">
            {mode === "mcp"
              ? `${who} is shopping ${host} through its agent tools.`
              : mode === "page"
                ? `${who} is reading ${host} like a shopper would.`
                : mode === "none"
                  ? "No AI key here, so rules score it instead."
                  : `${grok ? "Grok" : "An AI agent"} shops your store once the pages are in.`}
          </div>
        </div>
      </div>
      <div className="mt-4 flex max-h-[26rem] min-h-[8rem] flex-col gap-2.5 overflow-y-auto pr-1">
        {msgs.map((m, i) =>
          m.from === "system" ? (
            <div key={i} className="rd-in self-center rounded-full bg-white/60 px-3 py-1 text-center text-[12px] text-dw-ink/70">
              {m.text}
            </div>
          ) : m.from === "grok" ? (
            <div key={i} className="rd-in flex max-w-[92%] items-end gap-2 self-start">
              {grok ? <GrokTile size={26} /> : <Mascot kind="designer" size={26} />}
              <div className="min-w-0 rounded-[18px] rounded-bl-[6px] bg-white px-3.5 py-2.5 text-[14px] leading-snug break-words">
                {m.text}
                {m.tool && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-dw-ink px-2 py-0.5 font-dwmono text-[11px] text-white">{m.tool}</span>
                    {argsLine(m.args) && <span className="min-w-0 font-dwmono text-[11px] break-all text-dw-muted">{argsLine(m.args)}</span>}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div key={i} className="rd-in flex max-w-[92%] items-end gap-2 self-end">
              <div
                className={cn(
                  "min-w-0 rounded-[18px] rounded-br-[6px] px-3.5 py-2.5 font-dwmono text-[12px] leading-snug break-words",
                  m.blocked ? "bg-dw-ink text-white" : m.ok ? "bg-dw-surface text-dw-ink/80" : "bg-[#fbdcdc] text-[#7a2420]",
                )}
              >
                <span className="line-clamp-4">{m.text}</span>
              </div>
              <StoreTile size={26} />
            </div>
          ),
        )}
        {thinking && (
          <div className="flex items-end gap-2 self-start">
            {grok ? <GrokTile size={26} /> : <Mascot kind="designer" size={26} />}
            <div className="rounded-[18px] rounded-bl-[6px] bg-white px-4 py-3">
              <Typing />
            </div>
          </div>
        )}
        {waiting && !msgs.length && (
          <div className="grid flex-1 place-items-center py-6 text-center text-[14px] text-dw-ink/60">
            <div className="flex flex-col items-center gap-2">
              <Typing />
              {grok ? "Grok" : "The agent"} joins once Darwin has read your pages.
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ result */

function CheckItem({ c }: { c: ReadinessCheck }) {
  const [open, setOpen] = useState(false);
  const hasMore = Boolean(c.fix || c.evidence?.length);
  return (
    <li className="rounded-[16px] bg-white/85">
      <button type="button" onClick={() => hasMore && setOpen((o) => !o)} className={cn("flex w-full items-start gap-2 p-3 text-left", hasMore && "cursor-pointer")} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">
            {c.title}
            {c.informational && <span className="ml-1.5 text-[11px] font-normal text-dw-muted">not scored</span>}
          </div>
          <div className="mt-0.5 text-[13px] leading-snug break-words text-dw-ink/70">{c.detail}</div>
          {c.status !== "pass" && c.fix && !open && <div className="mt-1.5 text-[13px] leading-snug font-medium text-dw-ink">Fix: {c.fix.summary}</div>}
        </div>
        {hasMore && <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-dw-muted transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {c.fix && (
            <div className="text-[13px] leading-snug">
              <span className="font-semibold">{c.status === "pass" ? "Tip: " : "Fix: "}</span>
              {c.fix.summary}
            </div>
          )}
          {c.fix?.snippet && (
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex justify-end">
                <CopyButton text={c.fix.snippet} />
              </div>
              <pre className="max-h-56 overflow-auto rounded-[12px] bg-dw-sand p-2.5 font-dwmono text-[11px] leading-snug whitespace-pre-wrap break-all">{c.fix.snippet}</pre>
            </div>
          )}
          {c.evidence?.length ? (
            <ul className="flex flex-col gap-0.5 text-[12px] text-dw-muted">
              {c.evidence.slice(0, 4).map((e, i) => (
                <li key={i} className="break-words">
                  · {e}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </li>
  );
}

function ScoreCard({ report, cert }: { report: ReadinessReport; cert: ReadinessCertificate | null }) {
  const counts = { pass: 0, warn: 0, fail: 0 } as Record<CheckStatus, number>;
  for (const c of report.checks) if (!c.informational) counts[c.status]++;
  return (
    <section className="rd-in grid gap-6 rounded-[26px] bg-dw-yellow p-6 sm:p-8 lg:grid-cols-[auto_1fr] lg:items-center">
      <div className="flex items-center gap-5">
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold tracking-[0.12em] text-dw-ink/60 uppercase">Agent readiness</span>
          <span className="font-dwmono text-[88px] leading-none font-medium tracking-tight tabular-nums sm:text-[112px]">{report.score}</span>
          <span className="text-[14px] text-dw-ink/70">out of 100 · {hostOf(report.url)}</span>
        </div>
        <span className="grid size-20 shrink-0 place-items-center rounded-full border-[3px] border-dw-ink bg-white text-[40px] font-semibold sm:size-24 sm:text-[48px]">{report.grade}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        {(Object.keys(CATEGORY) as ReadinessCategory[]).map((k) => {
          const c = report.categories[k];
          const pct = c.max ? Math.round((c.score / c.max) * 100) : 0;
          return (
            <div key={k} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="font-medium">{CATEGORY[k]}</span>
                <span className="font-dwmono text-[13px] tabular-nums">
                  {c.score}/{c.max}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-dw-ink transition-[width] duration-700" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="rounded-full bg-dw-win-bg px-2.5 py-1 font-medium text-dw-win">{counts.pass} pass</span>
          <span className="rounded-full bg-dw-warn-bg px-2.5 py-1 font-medium text-dw-warn">{counts.warn} to fix</span>
          <span className="rounded-full bg-[#fbdcdc] px-2.5 py-1 font-medium text-[#a3302b]">{counts.fail} fail</span>
          {cert && <JudgeBadge cert={cert} />}
          <span className="text-dw-ink/60">checked in {(report.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>
    </section>
  );
}

function Checks({ report }: { report: ReadinessReport }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[24px] font-semibold">What agents found</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {GROUP.map((g) => {
          const list = report.checks.filter((c) => c.status === g.status);
          const Icon = g.icon;
          return (
            <div key={g.status} className={cn("flex min-w-0 flex-col gap-2 rounded-[26px] p-4", g.tone)}>
              <div className="flex items-center gap-2 px-1 pb-1">
                <span className={cn("grid size-6 place-items-center rounded-full", g.chip)}>
                  <Icon className="size-3.5" />
                </span>
                <span className="text-[17px] font-semibold">{g.title}</span>
                <span className="font-dwmono text-[13px] text-dw-ink/60">{list.length}</span>
              </div>
              {list.length ? (
                <ul className="flex flex-col gap-2">
                  {list.map((c) => (
                    <CheckItem key={c.id} c={c} />
                  ))}
                </ul>
              ) : (
                <div className="px-1 text-[13px] text-dw-ink/60">Nothing here.</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CertificateBlock({ cert }: { cert: ReadinessCertificate }) {
  const s = LEVEL_STYLE[cert.level];
  return (
    <section className="rd-in overflow-hidden rounded-[26px] border border-dw-hairline bg-dw-surface">
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:p-8" style={{ background: s.fill }}>
        <CertificateSeal level={cert.level} score={cert.score} className="bg-white" />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="text-[13px] font-semibold tracking-[0.12em] text-dw-ink/60 uppercase">Your certificate</div>
          <div className="text-[28px] leading-tight font-semibold">{cert.level === "none" ? "Not certified yet" : `${s.label} agent-ready`}</div>
          <p className="text-[15px] leading-relaxed text-dw-ink/80">{cert.verdict}</p>
          <div className="flex flex-wrap items-center gap-2">
            <JudgeBadge cert={cert} />
            <Link
              href={`/readiness/certificate/${cert.id}`}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-dw-ink px-3 text-[13px] font-medium text-white hover:bg-black"
            >
              Open certificate <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </div>
      </div>
      <div className="p-6 sm:p-8">
        <CertificateEmbed certId={cert.id} levelLabel={s.label} />
      </div>
    </section>
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
    <section className="flex flex-col gap-3 rounded-[26px] bg-dw-olive p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <Mascot kind="shipper" size={44} />
        <div className="text-[20px] leading-tight font-semibold">
          Darwin can fix {fixable.length} of these, worth up to +{Math.round(gain)} points
        </div>
      </div>
      <p className="text-[15px] leading-relaxed text-dw-ink/85">
        We host the agent layer (a guide for AI, agent tools and a store agent over your catalog), open a pull request with the product data, then test what
        agents and shoppers see. No theme rewrite.
      </p>
      {state === "done" ? (
        <div className="flex flex-wrap items-center gap-3 text-[15px] font-medium">
          <Check className="size-4" /> Thanks, we&apos;ll be in touch today.
          {pilotUrl && (
            <a href={pilotUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-dw-ink px-4 text-[14px] text-white">
              Start the pilot now <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row"
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
            className="h-12 min-w-0 flex-1 rounded-full bg-white px-5 text-[15px] outline-none placeholder:text-dw-muted focus:ring-2 focus:ring-dw-ink/30"
          />
          <button type="submit" disabled={state === "sending"} className="h-12 rounded-full bg-dw-ink px-6 text-[15px] font-medium text-white hover:bg-black disabled:opacity-60">
            {state === "sending" ? "Sending…" : "Fix it with Darwin"}
          </button>
        </form>
      )}
      {state === "error" && <div className="text-[13px] text-[#7a2420]">Couldn&apos;t save that. Check the email and try again.</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ app */

export function ReadinessApp({ initialUrl = "" }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [target, setTarget] = useState("");
  const [rows, setRows] = useState<FetchRow[]>([]);
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [agent, setAgent] = useState<string | null>(null);
  const [mode, setMode] = useState<"mcp" | "page" | "none" | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [trial, setTrial] = useState<CertificateTrial | null>(null);
  const [cert, setCert] = useState<ReadinessCertificate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const onEvent = useCallback((e: StreamEvent) => {
    switch (e.type) {
      case "fetch":
        setRows((r) => [...r, { id: e.id, label: e.label, status: e.status, ms: e.ms, tools: e.tools }]);
        break;
      case "audit":
        setReport(e.report);
        break;
      case "trial":
        setAgent(e.agent);
        setMode(e.mode);
        setMsgs((m) => [
          ...m,
          {
            from: "system",
            text:
              e.mode === "mcp"
                ? `Connected to your store's agent tools${e.tools?.length ? ` (${e.tools.length})` : ""}`
                : e.mode === "page"
                  ? "No agent tools found, so reading your pages instead"
                  : (e.note ?? "No agent trial"),
          },
        ]);
        break;
      case "turn":
        setMsgs((m) => [...m, ...stepMessages(e.step)]);
        break;
      case "read":
        setMsgs((m) => [...m, { from: "grok", text: `Reading your product page and homepage (${e.chars.toLocaleString("en-GB")} characters) for price, sizes, delivery and returns.` }]);
        break;
      case "judged":
        setTrial(e.trial);
        setMsgs((m) => [...m, { from: "grok", text: e.trial.summary }]);
        break;
      case "done":
        if (e.report) setReport(e.report);
        setCert(e.cert);
        if (e.cert.trial) setTrial(e.cert.trial);
        setPhase("done");
        break;
      case "error":
        if (e.report) setReport(e.report);
        setError(e.error);
        setPhase("error");
        break;
    }
  }, []);

  const run = useCallback(
    async (input: string) => {
      const t = input.trim();
      if (!t) return;
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setTarget(t);
      setPhase("running");
      setRows([]);
      setReport(null);
      setAgent(null);
      setMode(null);
      setMsgs([]);
      setTrial(null);
      setCert(null);
      setError(null);
      try {
        const res = await fetch(`/api/readiness/stream?url=${encodeURIComponent(t)}`, { signal: ctrl.signal });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "The check failed. Try again.");
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let finished = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = chunk
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            try {
              const ev = JSON.parse(data) as StreamEvent;
              if (ev.type === "done" || ev.type === "error") finished = true;
              onEvent(ev);
            } catch {
              /* skip a malformed event */
            }
          }
        }
        if (!finished) throw new Error("The connection dropped before the check finished. Try again.");
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError((e as Error).message || "The check failed. Try again.");
        setPhase("error");
      }
    },
    [onEvent],
  );

  useEffect(() => {
    if (!initialUrl) return;
    const t = setTimeout(() => void run(initialUrl), 0);
    return () => clearTimeout(t);
  }, [initialUrl, run]);
  useEffect(() => () => abort.current?.abort(), []);

  const demo = () => {
    const t = `${window.location.origin}/store`;
    setUrl(t);
    void run(t);
  };

  const host = hostOf(target || url);
  const running = phase === "running";
  const started = phase !== "idle";
  const thinking = running && mode !== null && mode !== "none" && !trial;
  const transcript = trial && cert ? trialMessages(trial) : msgs;

  return (
    <main data-dw className="min-h-screen w-full overflow-x-clip bg-dw-bg font-dw text-dw-ink">
      <style>{`@keyframes rdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.rd-in{animation:rdIn .35s cubic-bezier(.2,.8,.2,1) both}@media (prefers-reduced-motion:reduce){.rd-in{animation:none}}`}</style>
      <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-6 px-4 pb-24 sm:px-8">
        <nav className="flex h-20 items-center justify-between gap-3">
          <Link href="/readiness" className="flex items-center gap-2 text-[18px] font-semibold">
            <Mascot kind="analyst" size={30} /> Darwin <span className="hidden font-normal text-dw-muted sm:inline">agent readiness</span>
          </Link>
          <Link href="/console" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-medium shadow-[0_0_0_1px_rgba(20,20,19,0.08)] hover:bg-[#fffaf0]">
            Console <ArrowRight className="size-4" />
          </Link>
        </nav>

        <header className={cn("flex flex-col gap-3", started ? "pt-2" : "pt-10 sm:pt-16")}>
          <div className="flex items-center gap-2">
            <GrokTile size={26} />
            <span className="text-[14px] font-medium text-dw-ink/70">Grok shops your store while you watch</span>
          </div>
          <h1 className={cn("max-w-[44rem] leading-[1.05] font-semibold tracking-tight", started ? "text-[32px] sm:text-[40px]" : "text-[40px] sm:text-[56px]")}>
            Can AI agents buy from your store?
          </h1>
          {!started && (
            <p className="max-w-[40rem] text-[17px] leading-relaxed text-dw-ink/70">
              Darwin reads your store the way an AI shopping agent does, then Grok tries to find a product, check the price and stock, and get to checkout. You get a score, the
              exact fixes and a certificate.
            </p>
          )}
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(url);
          }}
          className="flex w-full max-w-[44rem] flex-col gap-2 rounded-[26px] border border-dw-hairline bg-dw-surface p-2 shadow-[0_1px_0_rgba(20,20,19,0.04)] sm:flex-row sm:items-center"
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search className="size-5 shrink-0 text-dw-muted" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="yourstore.com"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              aria-label="Your store's URL"
              className="h-12 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-dw-ink/35"
            />
          </label>
          <button
            type="submit"
            disabled={running || !url.trim()}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-dw-pink px-6 text-[16px] font-semibold text-dw-ink transition-[background-color,transform] hover:bg-dw-pink-shape active:scale-[0.98] disabled:opacity-50"
          >
            {running ? (
              <>
                <Typing /> Checking
              </>
            ) : (
              <>
                Check my store <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </form>
        {!running && (
          <button type="button" onClick={demo} className="-mt-2 self-start px-1 text-[14px] text-dw-ink/60 underline-offset-2 hover:text-dw-ink hover:underline">
            No store handy? Check our demo store →
          </button>
        )}

        {!started && (
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { tone: "bg-dw-yellow", kind: "observer" as const, title: "Darwin reads", text: "robots.txt, your product pages, sitemap and any agent tools, fetched live." },
              { tone: "bg-dw-blue", kind: "designer" as const, title: "Grok shops", text: "It searches, asks for price and stock and tries to add to cart. It never pays." },
              { tone: "bg-dw-pink", kind: "shipper" as const, title: "You get fixes", text: "Pass, fix or fail for each check, the copy-paste fix, and a badge for your footer." },
            ].map((s) => (
              <div key={s.title} className={cn("dw-card flex items-start gap-3 rounded-[26px] p-5", s.tone)}>
                <Mascot kind={s.kind} size={44} />
                <div>
                  <div className="text-[17px] font-semibold">{s.title}</div>
                  <div className="mt-0.5 text-[14px] leading-snug text-dw-ink/75">{s.text}</div>
                </div>
              </div>
            ))}
          </section>
        )}

        {error && (
          <div role="alert" className="rd-in flex items-start gap-3 rounded-[20px] bg-[#fbdcdc] px-4 py-3 text-[15px] text-[#7a2420]">
            <X className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}

        {started && phase !== "done" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <FetchFeed rows={rows} host={host} report={report} running={running} />
            <ChatPane agent={agent} mode={mode} msgs={msgs} thinking={thinking} waiting={running && !mode} host={host} />
          </div>
        )}

        {phase === "done" && report && (
          <>
            <ScoreCard report={report} cert={cert} />
            <Checks report={report} />
            <section className="flex flex-col gap-3">
              <h2 className="text-[24px] font-semibold">{cert && isGrok(cert) ? "Grok's shopping trial" : cert?.heuristic ? "Agent trial" : "The agent's shopping trial"}</h2>
              <div className={cn("grid gap-4", trial && "lg:grid-cols-[1.2fr_1fr]")}>
                {trial && <ChatPane agent={agent ?? (cert && isGrok(cert) ? "Grok" : cert?.heuristic ? "Rules" : "AI agent")} mode={mode} msgs={transcript} thinking={false} waiting={false} host={host} />}
                <div className="flex min-w-0 flex-col gap-3 rounded-[26px] border border-dw-hairline bg-dw-surface p-5 sm:p-6">
                  {trial ? (
                    <>
                      <div className="text-[17px] font-semibold">{trial.passed ? "Trial passed" : "Trial not passed"}</div>
                      <p className="text-[14px] leading-relaxed text-dw-ink/75">{trial.summary}</p>
                      <CriteriaGrid criteria={trial.criteria} />
                      <div className="text-[12px] text-dw-muted">
                        {trial.steps?.length ? `${trial.steps.length} tool calls · ` : ""}
                        {(trial.durationMs / 1000).toFixed(1)}s · checkout is never completed
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-3">
                      <Mascot kind="analyst" size={44} />
                      <div>
                        <div className="text-[17px] font-semibold">No agent trial this time</div>
                        <p className="mt-1 text-[14px] leading-relaxed text-dw-ink/75">{cert?.note ?? "No AI key is configured, so the level comes from the score alone."}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
            {cert && <CertificateBlock cert={cert} />}
            <PilotCta report={report} />
            <button type="button" onClick={() => void run(target)} className="self-start px-1 text-[14px] text-dw-ink/60 underline-offset-2 hover:text-dw-ink hover:underline">
              Run it again →
            </button>
          </>
        )}
      </div>
    </main>
  );
}
