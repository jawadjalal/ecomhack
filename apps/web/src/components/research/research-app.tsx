"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Check, CircleAlert, LoaderCircle, MessageCircle, Search, Store } from "lucide-react";
import type { ResearchKind, ResearchListItem, ResearchReport, ResearchStatus, ResearchStep, ResearchStreamEvent } from "@/lib/contracts";
import { friendlyError, writtenBy } from "@/lib/friendly";
import { ReportView } from "./report-view";
import { Card, DarwinMark, Pill, Sources, T } from "./ui";

const CHIPS: { kind: ResearchKind; q: string }[] = [
  { kind: "competitors", q: "Who are my competitors?" },
  { kind: "competitors", q: "How do competitors price and ship?" },
  { kind: "question", q: "What do shoppers expect from delivery in 2026?" },
  { kind: "question", q: "Are AI shopping agents buying from stores like mine?" },
];

const DEFAULT_STORE = "PACE, an online running-shoe store in the UK";

async function runStream(body: unknown, onStep: (s: ResearchStep) => void): Promise<ResearchReport> {
  const res = await fetch("/api/research", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(j.error ?? ""), { status: res.status });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let report: ResearchReport | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line) as ResearchStreamEvent;
      if (ev.type === "step") onStep(ev.step);
      else if (ev.type === "report") report = ev.report;
      else throw new Error(ev.error);
    }
    if (done) break;
  }
  if (!report) throw new Error("The research stopped before it finished. Please try again.");
  return report;
}

export function ResearchApp({ initialId }: { initialId?: string }) {
  const [store, setStore] = useState(DEFAULT_STORE);
  const [site, setSite] = useState("north-trail");
  const [kind, setKind] = useState<ResearchKind>("competitors");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<ResearchStep[]>([]);
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<ResearchReport>();
  const [list, setList] = useState<ResearchListItem[]>([]);
  const [status, setStatus] = useState<ResearchStatus>();
  const [follow, setFollow] = useState("");
  const [asking, setAsking] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const r = await fetch("/api/research", { cache: "no-store" });
    if (!r.ok) return;
    const j = (await r.json()) as { reports: ResearchListItem[]; status: ResearchStatus };
    setList(j.reports);
    setStatus(j.status);
  }, []);

  const open = useCallback(async (rid: string) => {
    const r = await fetch(`/api/research/${encodeURIComponent(rid)}`, { cache: "no-store" });
    if (!r.ok) return;
    const rep = (await r.json()) as ResearchReport;
    setReport(rep);
    setSteps(rep.steps);
    setError(undefined);
    history.replaceState(null, "", `/console/research?id=${rep.id}`);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadList();
      if (initialId) void open(initialId);
    }, 0);
    return () => clearTimeout(t);
  }, [loadList, open, initialId]);

  const upsertStep = (s: ResearchStep) => setSteps((prev) => (prev.some((p) => p.id === s.id) ? prev.map((p) => (p.id === s.id ? s : p)) : [...prev, s]));

  const run = async (k: ResearchKind, q: string) => {
    if (busy || q.trim().length < 2) return;
    setBusy(true);
    setError(undefined);
    setKind(k);
    setQuery(q);
    setSteps([
      { id: "search", label: "Searching the web", status: "running" },
      { id: "read", label: k === "competitors" ? "Reading competitor sites" : "Reading sources", status: "pending" },
      { id: "summarise", label: "Summarising", status: "pending" },
    ]);
    try {
      const rep = await runStream({ kind: k, query: q, store }, upsertStep);
      setReport(rep);
      history.replaceState(null, "", `/console/research?id=${rep.id}`);
      void loadList();
    } catch (e) {
      setError(friendlyError(e, "The research didn't finish. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const askFollow = async () => {
    if (!report || asking || follow.trim().length < 2) return;
    setAsking(true);
    const q = follow;
    setFollow("");
    try {
      const rep = await runStream({ kind: "question", query: q, parentId: report.id }, () => {});
      setReport(rep);
    } catch (e) {
      setError(friendlyError(e, "Couldn't answer that just now. Please try again."));
      setFollow(q);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div data-research-root className="min-h-screen w-full overflow-x-hidden pb-40" style={{ background: T.bg, color: T.ink, fontFamily: "Outfit, var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <header className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 pt-5 sm:px-7">
        <Link href="/console" className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <DarwinMark /> darwin
        </Link>
        <nav className="flex items-center gap-1 rounded-full p-1.5 text-[14px] text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.5)]" style={{ background: T.ink }}>
          <Link href="/console" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-white/75 hover:text-white">
            <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Mission control</span>
          </Link>
          <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-black">
            <Search className="size-4" /> Research
          </span>
        </nav>
        <span className="hidden items-center gap-2 rounded-full px-3 py-2 text-[14px] md:flex" style={{ background: T.sand }}>
          <span className="size-2 rounded-full" style={{ background: status?.tavily ? T.live : T.warn }} />
          {status ? (status.tavily ? "Live research on" : "Sample mode") : "…"}
        </span>
      </header>

      <main ref={top} className="mx-auto max-w-[1500px] px-4 sm:px-7">
        <div className="mt-8 flex items-center gap-3">
          <DarwinMark size={44} />
          <h1 className="text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[46px]">Know your market</h1>
        </div>
        <p className="mt-2 max-w-2xl text-[15px] text-black/70">
          Darwin reads your competitors&apos; sites and the news, then turns what it finds into tests for your store. Every claim links to its source.
        </p>

        {status && !status.tavily && (
          <div className="mt-4 flex items-start gap-3 rounded-[22px] px-4 py-3 text-[14px]" style={{ background: T.warnBg, color: T.warn }}>
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Live research is off. Add your research key to turn it on (a one-time setup step for whoever runs Darwin). Until then you&apos;ll get a clearly marked sample
              report.
            </span>
          </div>
        )}

        {/* Prompt bar */}
        <Card className="mt-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(kind, query);
            }}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex shrink-0 rounded-full p-1 text-[13px]" style={{ background: T.sand }} role="tablist">
                {(["competitors", "question"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={kind === k}
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded-full px-3 py-1.5 font-medium whitespace-nowrap transition-colors ${kind === k ? "bg-black text-white" : "text-black/65"}`}
                  >
                    {k === "competitors" ? "Competitors" : "Ask a question"}
                  </button>
                ))}
              </div>
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-2 text-[13px]" style={{ background: T.sand }}>
                <Store className="size-4 shrink-0 text-black/50" />
                <span className="sr-only">Your store</span>
                <input value={store} onChange={(e) => setStore(e.target.value)} maxLength={500} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Describe your store or paste its URL" />
              </label>
            </div>
            <div className="flex items-center gap-2 rounded-[22px] py-1.5 pr-1.5 pl-4" style={{ background: T.ink }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={500}
                className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/45"
                placeholder={kind === "competitors" ? "Who are my competitors?" : "Ask Darwin a research question"}
                aria-label="Research prompt"
              />
              <button
                type="submit"
                disabled={busy || query.trim().length < 2}
                aria-label="Run research"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black transition-opacity disabled:opacity-40"
              >
                {busy ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> : <ArrowUp className="size-5" />}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((c) => (
                <button
                  key={c.q}
                  type="button"
                  disabled={busy}
                  onClick={() => void run(c.kind, c.q)}
                  className="rounded-full px-3 py-1.5 text-[13px] transition-transform motion-safe:hover:translate-x-0.5 disabled:opacity-50"
                  style={{ background: T.sand }}
                >
                  {c.q}
                </button>
              ))}
            </div>
          </form>
        </Card>

        {steps.length > 0 && (busy || report) && <StepsBar steps={steps} />}
        {error && (
          <p className="mt-4 rounded-[22px] px-4 py-3 text-[14px]" style={{ background: T.warnBg, color: T.warn }}>
            {error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.7fr_1fr]">
          <div className="min-w-0">
            {report ? (
              <div className="flex flex-col gap-4">
                <ReportHeader report={report} />
                <ReportView report={report} site={site} />
              </div>
            ) : (
              !busy && (
                <Card className="text-[15px] text-black/60">
                  Pick a suggestion above, or ask your own question. Darwin searches the web, cites every source, and turns what it finds into A/B test ideas. Reports
                  are saved so you can come back to them.
                </Card>
              )
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            {report && (
              <Card>
                <h2 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
                  <MessageCircle className="size-5" /> Ask a follow-up
                </h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {report.followUps.map((f, i) => (
                    <li key={i} className="flex flex-col gap-2">
                      <span className="self-end rounded-[18px] rounded-br-md px-3 py-2 text-[14px] text-white" style={{ background: T.ink }}>
                        {f.question}
                      </span>
                      <div className="rounded-[18px] rounded-bl-md px-3 py-2 text-[14px] leading-snug" style={{ background: T.sand }}>
                        {f.answer}
                        <Sources urls={f.sources} />
                      </div>
                    </li>
                  ))}
                  {!report.followUps.length && <li className="text-[13px] text-black/55">e.g. &ldquo;Which of them offers the best returns?&rdquo;</li>}
                  {asking && (
                    <li className="flex items-center gap-2 text-[13px] text-black/60">
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Searching…
                    </li>
                  )}
                </ul>
                <form
                  className="mt-3 flex items-center gap-2 rounded-full py-1 pr-1 pl-3"
                  style={{ background: T.sand }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void askFollow();
                  }}
                >
                  <input value={follow} onChange={(e) => setFollow(e.target.value)} maxLength={500} className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none" placeholder="Ask about this report" aria-label="Follow-up question" />
                  <button type="submit" disabled={asking || follow.trim().length < 2} aria-label="Ask" className="grid size-9 place-items-center rounded-full bg-black text-white disabled:opacity-40">
                    <ArrowUp className="size-4" />
                  </button>
                </form>
              </Card>
            )}

            <Card>
              <h2 className="text-[22px] font-semibold tracking-tight">Test on</h2>
              <p className="mt-1 text-[13px] text-black/60">&ldquo;Draft A/B test&rdquo; saves a draft test for this store. Nothing goes live until you launch it.</p>
              <input
                value={site}
                onChange={(e) => setSite(e.target.value.replace(/[^\w.-]/g, "").slice(0, 64))}
                className="mt-2 h-10 w-full rounded-full px-3 font-mono text-[13px] outline-none"
                style={{ background: T.sand }}
                aria-label="Store to test on"
              />
            </Card>

            <Card>
              <div className="flex items-baseline justify-between">
                <h2 className="text-[22px] font-semibold tracking-tight">Past reports</h2>
                <span className="text-[12px] text-black/50">newest first</span>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {list.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => void open(r.id)}
                      className={`flex w-full items-center gap-3 rounded-[22px] px-3 py-2.5 text-left transition-transform motion-safe:hover:translate-x-1 ${report?.id === r.id ? "" : ""}`}
                      style={{ background: report?.id === r.id ? T.pink : T.sand }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{r.query}</span>
                        <span className="block font-mono text-[11px] text-black/55">
                          {new Date(r.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                          {r.kind === "competitors" ? ` · ${r.competitors} competitors` : " · question"}
                        </span>
                      </span>
                      {r.demo && <Pill tone="warn">Sample</Pill>}
                    </button>
                  </li>
                ))}
                {!list.length && <li className="text-[13px] text-black/55">No reports yet. Your first one will appear here.</li>}
              </ul>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

/** Saved reports can carry older, technical step details ("Asking llm:…", "No TAVILY_API_KEY"): show plain English. */
function stepDetail(d: string): string {
  if (/^asking |^summarised by llm|^answered by llm/i.test(d)) return "Darwin is thinking…";
  if (/TAVILY|_API_KEY/.test(d)) return "Live research is off";
  if (/llm|heuristic/i.test(d)) return "Summary from the search results";
  if (/^couldn't read pages/i.test(d)) return "Couldn't open some sites; using search snippets instead";
  return d;
}

/** Older sample reports name the env var: keep the meaning, drop the jargon. */
function plainNotice(n: string): string {
  return /TAVILY|_API_KEY|\.env/.test(n) ? "Sample report: live research isn't switched on yet (it needs a research key). The brands and numbers below are made up." : n;
}

function StepsBar({ steps }: { steps: ResearchStep[] }) {
  return (
    <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-live="polite">
      {steps.map((s) => (
        <li
          key={s.id}
          className="flex items-center gap-3 rounded-[22px] px-4 py-3 text-[14px]"
          style={{ background: s.status === "running" ? T.pink : s.status === "error" ? T.warnBg : T.sand, opacity: s.status === "pending" ? 0.55 : 1 }}
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black text-white">
            {s.status === "running" ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : s.status === "done" ? (
              <Check className="size-3.5" />
            ) : s.status === "error" ? (
              <CircleAlert className="size-3.5" />
            ) : (
              <span className="size-1.5 rounded-full bg-white/60" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block font-medium">{s.label}</span>
            {s.detail && <span className="block truncate text-[12px] text-black/60">{stepDetail(s.detail)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ReportHeader({ report }: { report: ResearchReport }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {report.demo ? <Pill tone="warn">Sample data, not real research</Pill> : <Pill tone="win">Live web research</Pill>}
        <Pill>{report.summarizer === "sample" ? "Sample" : writtenBy(report.summarizer).ai ? "Summarised by Darwin AI" : "Summary from search results"}</Pill>
        <span className="font-mono text-[12px] text-black/50">{new Date(report.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
      </div>
      {report.notice && <p className="mt-3 text-[13px] font-medium" style={{ color: T.warn }}>{plainNotice(report.notice)}</p>}
      <h2 className="mt-3 text-[22px] leading-tight font-semibold tracking-tight">{report.query}</h2>
      <p className="mt-2 text-[15px] leading-snug text-black/80">{report.summary.text}</p>
      <Sources urls={report.summary.sources} />
      {report.kind === "question" && report.sources.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-black/60">All {report.sources.length} sources</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {report.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:underline">
                  {s.title}
                </a>
                {s.snippet && <span className="block text-black/55">{s.snippet}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
