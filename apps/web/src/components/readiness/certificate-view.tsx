import { Bot, Check, Minus, ShieldCheck, X } from "lucide-react";
import type { CertificateCriterion, CertificateLevel, ReadinessCertificate } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";

export const LEVEL_STYLE: Record<CertificateLevel, { label: string; color: string; glow: string; border: string }> = {
  gold: { label: "Gold", color: "#f3d36b", glow: "rgba(243,211,107,0.18)", border: "rgba(243,211,107,0.45)" },
  silver: { label: "Silver", color: "#d5dbe3", glow: "rgba(213,219,227,0.14)", border: "rgba(213,219,227,0.4)" },
  bronze: { label: "Bronze", color: "#e0a068", glow: "rgba(224,160,104,0.16)", border: "rgba(224,160,104,0.42)" },
  none: { label: "Not certified", color: "rgba(255,255,255,0.55)", glow: "rgba(255,255,255,0.05)", border: "rgba(255,255,255,0.14)" },
};

const CRITERION_STYLE: Record<CertificateCriterion["status"], { icon: typeof Check; ring: string; word: string }> = {
  found: { icon: Check, ring: "bg-good/15 text-[#8ff0b2]", word: "Found" },
  missing: { icon: X, ring: "bg-bad/15 text-[#ff9b9b]", word: "Missing" },
  not_applicable: { icon: Minus, ring: "bg-white/[0.06] text-white/50", word: "N/A" },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The medal: a ringed seal in the level colour. */
export function CertificateSeal({ level, score, className }: { level: CertificateLevel; score: number; className?: string }) {
  const s = LEVEL_STYLE[level];
  return (
    <div className={cn("relative flex size-32 shrink-0 items-center justify-center", className)}>
      <svg viewBox="0 0 128 128" className="absolute inset-0 size-full" aria-hidden>
        <circle cx="64" cy="64" r="60" fill="none" stroke={s.color} strokeOpacity="0.35" strokeWidth="2" strokeDasharray="2 5" />
        <circle cx="64" cy="64" r="50" fill={s.glow} stroke={s.color} strokeWidth="3" />
      </svg>
      <div className="relative flex flex-col items-center">
        <ShieldCheck className="size-5" style={{ color: s.color }} />
        <span className="mt-0.5 text-[1.05rem] leading-none font-semibold" style={{ color: s.color }}>
          {level === "none" ? "—" : s.label}
        </span>
        <span className="mt-1 font-mono text-[0.72rem] text-white/55 tabular-nums">{score}/100</span>
      </div>
    </div>
  );
}

export function CriteriaGrid({ criteria }: { criteria: CertificateCriterion[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {criteria.map((c) => {
        const st = CRITERION_STYLE[c.status];
        const Icon = st.icon;
        return (
          <li key={c.id} className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", st.ring)}>
              <Icon className="size-3" />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.86rem] font-medium text-white/90">
                {c.label} <span className="font-normal text-white/40">· {st.word}</span>
              </span>
              {c.evidence && <span className="mt-0.5 block text-[0.78rem] leading-snug break-words text-white/50">{c.evidence}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The full certificate, for the public page. Pure presentational (server-renderable). */
export function CertificateView({ cert, expired }: { cert: ReadinessCertificate; expired: boolean }) {
  const s = LEVEL_STYLE[cert.level];
  const host = new URL(cert.origin).host;
  return (
    <article
      className="relative overflow-hidden rounded-3xl border bg-white/[0.025] p-6 sm:p-9"
      style={{ borderColor: s.border, boxShadow: `0 0 80px -20px ${s.glow}` }}
      data-testid="readiness-certificate"
    >
      <div className="pointer-events-none absolute inset-3 rounded-[1.25rem] border border-dashed" style={{ borderColor: s.border, opacity: 0.35 }} />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <CertificateSeal level={cert.level} score={cert.score} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[0.75rem] font-semibold tracking-[0.18em] text-white/45 uppercase">Agent-readiness certificate</div>
            <h1 className="text-[1.9rem] leading-tight font-semibold tracking-[-0.03em] break-words sm:text-[2.4rem]">{host}</h1>
            <div className="text-[1rem] text-white/65">
              {cert.level === "none" ? (
                "Not certified yet"
              ) : (
                <>
                  Certified <span style={{ color: s.color }} className="font-semibold">{s.label}</span> for AI shopping agents
                </>
              )}
              {cert.heuristic && <span className="ml-2 rounded-md bg-white/[0.07] px-1.5 py-0.5 align-middle text-[0.7rem] font-medium text-white/60">heuristic</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-white/45">
              <span>Score {cert.score}/100 · grade {cert.grade}</span>
              {cert.platform !== "unknown" && <span className="capitalize">{cert.platform}</span>}
            </div>
          </div>
        </div>

        {expired && (
          <div className="rounded-xl border border-warn/30 bg-warn/[0.08] px-4 py-2.5 text-[0.86rem] text-[#ffd27a]">
            This certificate expired on {fmtDate(cert.expiresAt)}. Re-run the check to renew it.
          </div>
        )}

        <p className="text-[1rem] leading-relaxed text-white/75">{cert.verdict}</p>

        {cert.trial && (
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-[0.78rem] font-semibold tracking-[0.14em] text-white/45 uppercase">
              <Bot className="size-4" /> {cert.trial.mode === "mcp" ? "Grok's shopping trial over MCP" : "What Grok could read on the page"}
              <span className={cn("rounded-md px-1.5 py-0.5 text-[0.66rem] tracking-normal normal-case", cert.trial.passed ? "bg-good/15 text-[#8ff0b2]" : "bg-bad/15 text-[#ff9b9b]")}>
                {cert.trial.passed ? "passed" : "not passed"}
              </span>
            </h2>
            <CriteriaGrid criteria={cert.trial.criteria} />
            {cert.trial.steps?.length ? (
              <details className="rounded-xl border border-white/[0.07] bg-black/20">
                <summary className="cursor-pointer px-4 py-2.5 text-[0.84rem] text-white/60 hover:text-white">
                  Transcript: {cert.trial.steps.length} tool call{cert.trial.steps.length === 1 ? "" : "s"} in {(cert.trial.durationMs / 1000).toFixed(1)}s
                </summary>
                <ol className="flex flex-col gap-2 border-t border-white/[0.06] px-4 py-3">
                  {cert.trial.steps.map((st, i) => (
                    <li key={i} className="font-mono text-[0.74rem] leading-snug">
                      <div className={cn(st.blocked ? "text-[#ffd27a]" : st.ok ? "text-white/80" : "text-[#ff9b9b]")}>
                        {i + 1}. {st.tool}
                        <span className="text-white/35">({JSON.stringify(st.args)})</span>
                      </div>
                      {st.thought && <div className="text-[#9ad7ff]/70">… {st.thought}</div>}
                      <div className="break-words text-white/45">{st.note}</div>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </section>
        )}

        <footer className="grid gap-3 border-t border-white/[0.08] pt-5 text-[0.8rem] text-white/50 sm:grid-cols-3">
          <div>
            <div className="text-[0.68rem] font-semibold tracking-[0.14em] text-white/35 uppercase">Issued</div>
            {fmtDate(cert.issuedAt)}
          </div>
          <div>
            <div className="text-[0.68rem] font-semibold tracking-[0.14em] text-white/35 uppercase">Valid until</div>
            {fmtDate(cert.expiresAt)}
          </div>
          <div>
            <div className="text-[0.68rem] font-semibold tracking-[0.14em] text-white/35 uppercase">Judged by</div>
            {cert.heuristic ? "Audit score only (heuristic)" : cert.model.replace(/^llm:/, "")}
          </div>
          <div className="font-mono text-[0.7rem] text-white/30 sm:col-span-3">
            {cert.id} · {cert.url}
          </div>
        </footer>
      </div>
    </article>
  );
}
