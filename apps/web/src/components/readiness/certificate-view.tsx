import { Check, Minus, X } from "lucide-react";
import type { CertificateCriterion, CertificateLevel, ReadinessCertificate } from "@/lib/contracts";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { cn } from "@/components/ui/cn";

/**
 * Level colours on cream: `color` is the medal fill, `glow` the card wash, `border` the ring/hairline.
 * Kept to the same keys the certificate page reads.
 */
export const LEVEL_STYLE: Record<CertificateLevel, { label: string; color: string; glow: string; border: string }> = {
  gold: { label: "Gold", color: "#F6D76B", glow: "#FCF0C4", border: "#E2BD3F" },
  silver: { label: "Silver", color: "#DCDAD4", glow: "#F2F0EB", border: "#B9B5AB" },
  bronze: { label: "Bronze", color: "#E8B48A", glow: "#F8E3D2", border: "#C98A5A" },
  none: { label: "Not certified", color: "#EDE6D6", glow: "#FFFDF8", border: "#DCD2BE" },
};

const CRITERION_STYLE: Record<CertificateCriterion["status"], { icon: typeof Check; ring: string; word: string }> = {
  found: { icon: Check, ring: "bg-dw-win-bg text-dw-win", word: "Found" },
  missing: { icon: X, ring: "bg-dw-pink/70 text-dw-ink", word: "Missing" },
  not_applicable: { icon: Minus, ring: "bg-dw-sand text-dw-ink/55", word: "N/A" },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The medal: a scalloped seal in the level colour with the score. */
export function CertificateSeal({ level, score, className }: { level: CertificateLevel; score: number; className?: string }) {
  const s = LEVEL_STYLE[level];
  const teeth = 24;
  const pts = Array.from({ length: teeth * 2 }, (_, i) => {
    const r = i % 2 ? 56 : 61;
    const a = (i * Math.PI) / teeth - Math.PI / 2;
    return `${(64 + r * Math.cos(a)).toFixed(1)},${(64 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  return (
    <div className={cn("relative flex size-32 shrink-0 items-center justify-center", className)}>
      <svg viewBox="0 0 128 128" className="absolute inset-0 size-full drop-shadow-[0_6px_14px_rgba(20,20,19,0.14)]" aria-hidden>
        <polygon points={pts} fill={s.color} stroke={s.border} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="64" cy="64" r="44" fill="none" stroke="#141413" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 4" />
      </svg>
      <div className="relative flex flex-col items-center text-dw-ink">
        <span className="text-[1.05rem] leading-none font-semibold tracking-[-0.01em]">{level === "none" ? "—" : s.label}</span>
        <span className="num mt-1 font-dwmono text-[0.72rem] text-dw-ink/70">{score}/100</span>
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
          <li key={c.id} className="flex min-w-0 items-start gap-2.5 rounded-[16px] bg-white/70 px-3 py-2.5">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", st.ring)}>
              <Icon className="size-3" strokeWidth={2.4} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">
                {c.label} <span className="font-normal text-dw-ink/50">· {st.word}</span>
              </span>
              {c.evidence && <span className="mt-0.5 block text-[12.5px] leading-snug break-words text-dw-ink/60">{c.evidence}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[12px] text-dw-ink/50">{children}</div>;

/** The full certificate, for the public page. Pure presentational (server-renderable). */
export function CertificateView({ cert, expired }: { cert: ReadinessCertificate; expired: boolean }) {
  const s = LEVEL_STYLE[cert.level];
  const host = new URL(cert.origin).host;
  return (
    <article
      className="relative overflow-clip rounded-[30px] border p-6 shadow-[0_30px_70px_-40px_rgba(20,20,19,0.35)] sm:p-9"
      style={{ borderColor: s.border, background: s.glow }}
      data-testid="readiness-certificate"
    >
      <div className="pointer-events-none absolute inset-3 rounded-[22px] border border-dashed" style={{ borderColor: s.border, opacity: 0.6 }} />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          <CertificateSeal level={cert.level} score={cert.score} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="text-[14px] text-dw-ink/60">Agent-readiness certificate</div>
            <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.03em] break-words sm:text-[42px]">{host}</h1>
            <div className="flex flex-wrap items-center gap-2 text-[16px] text-dw-ink/75">
              {cert.level === "none" ? (
                "Not certified yet"
              ) : (
                <span>
                  Certified <b className="font-semibold text-dw-ink">{s.label}</b> for AI shopping agents
                </span>
              )}
              {cert.heuristic && <span className="inline-flex h-6 items-center rounded-full bg-dw-sand px-2.5 text-[12px] font-medium text-dw-ink/70">heuristic</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-dw-ink/55">
              <span className="num">
                Score {cert.score}/100 · grade {cert.grade}
              </span>
              {cert.platform !== "unknown" && <span className="capitalize">{cert.platform}</span>}
            </div>
          </div>
        </div>

        {expired && <div className="rounded-[16px] bg-dw-warn-bg px-4 py-2.5 text-[14px] text-dw-warn">This certificate expired on {fmtDate(cert.expiresAt)}. Re-run the check to renew it.</div>}

        <p className="text-[16px] leading-relaxed text-dw-ink/80">{cert.verdict}</p>

        {cert.trial && (
          <section className="flex flex-col gap-3">
            <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold">
              <AgentTile brand={agentBrand("grok")} size={26} />
              {cert.trial.mode === "mcp" ? "Grok's shopping trial over MCP" : "What Grok could read on the page"}
              <span
                className={cn(
                  "inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium",
                  cert.trial.passed ? "bg-dw-win-bg text-dw-win" : "bg-dw-warn-bg text-dw-warn",
                )}
              >
                {cert.trial.passed ? "passed" : "not passed"}
              </span>
            </h2>
            <CriteriaGrid criteria={cert.trial.criteria} />
            {cert.trial.steps?.length ? (
              <details className="rounded-[16px] bg-white/60">
                <summary className="cursor-pointer px-4 py-2.5 text-[14px] text-dw-ink/70 hover:text-dw-ink">
                  Transcript: {cert.trial.steps.length} tool call{cert.trial.steps.length === 1 ? "" : "s"} in {(cert.trial.durationMs / 1000).toFixed(1)}s
                </summary>
                <ol className="flex flex-col gap-2 border-t border-dw-ink/10 px-4 py-3">
                  {cert.trial.steps.map((st, i) => (
                    <li key={i} className="font-dwmono text-[12px] leading-snug">
                      <div className={cn("break-words", st.blocked ? "text-dw-warn" : st.ok ? "text-dw-ink/85" : "text-[#b0265f]")}>
                        {i + 1}. {st.tool}
                        <span className="text-dw-ink/40">({JSON.stringify(st.args)})</span>
                      </div>
                      {st.thought && <div className="text-[#3b5bb5]">… {st.thought}</div>}
                      <div className="break-words text-dw-ink/55">{st.note}</div>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </section>
        )}

        <footer className="grid gap-3 border-t border-dw-ink/10 pt-5 text-[14px] sm:grid-cols-3">
          <div>
            <Label>Issued</Label>
            {fmtDate(cert.issuedAt)}
          </div>
          <div>
            <Label>Valid until</Label>
            {fmtDate(cert.expiresAt)}
          </div>
          <div>
            <Label>Judged by</Label>
            {cert.heuristic ? "Audit score only (heuristic)" : cert.model.replace(/^llm:/, "")}
          </div>
          <div className="font-dwmono text-[11.5px] break-all text-dw-ink/40 sm:col-span-3">
            {cert.id} · {cert.url}
          </div>
        </footer>
      </div>
    </article>
  );
}
