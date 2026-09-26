import { Check, Minus, X } from "lucide-react";
import type { CertificateCriterion, CertificateLevel, ReadinessCertificate } from "@/lib/contracts";
import { BrandGlyph } from "@/components/dw/brand-logos";
import { Mascot } from "@/components/dw/mascot";
import { cn } from "@/components/ui/cn";

/** Level colours in the cream design: solid pastel fills, ink text. */
export const LEVEL_STYLE: Record<CertificateLevel, { label: string; fill: string; shape: string }> = {
  gold: { label: "Gold", fill: "#F6D76B", shape: "#EDC957" },
  silver: { label: "Silver", fill: "#DCE1EA", shape: "#CDD4E0" },
  bronze: { label: "Bronze", fill: "#EBC19C", shape: "#E0AF86" },
  none: { label: "Not certified", fill: "#EDE6D6", shape: "#E3DAC6" },
};

/** Who judged it, in plain words. Only "Grok" is ever named. */
export function judgedBy(cert: Pick<ReadinessCertificate, "heuristic" | "model">): string {
  if (cert.heuristic) return "Scored by rules";
  if (/^llm:x-ai\//.test(cert.model)) return "Tried by Grok (via OpenRouter)";
  if (/grok/i.test(cert.model)) return "Tried by Grok";
  return "Tried by an AI agent";
}

export const isGrok = (cert: Pick<ReadinessCertificate, "heuristic" | "model">) => !cert.heuristic && /grok|x-ai\//i.test(cert.model);

const CRITERION: Record<CertificateCriterion["status"], { icon: typeof Check; chip: string; word: string }> = {
  found: { icon: Check, chip: "bg-dw-win-bg text-dw-win", word: "Found" },
  missing: { icon: X, chip: "bg-[#fbdcdc] text-[#a3302b]", word: "Missing" },
  not_applicable: { icon: Minus, chip: "bg-dw-sand text-dw-muted", word: "Not needed" },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The medal: a solid disc in the level colour with the level and score. */
export function CertificateSeal({ level, score, className }: { level: CertificateLevel; score: number; className?: string }) {
  const s = LEVEL_STYLE[level];
  return (
    <div
      className={cn("relative grid size-32 shrink-0 place-items-center rounded-full border-[3px] border-dw-ink text-dw-ink", className)}
      style={{ background: s.fill }}
      aria-label={`${s.label}, ${score} out of 100`}
    >
      <div className="absolute inset-[7px] rounded-full border border-dashed border-dw-ink/35" />
      <div className="relative flex flex-col items-center leading-none">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-dw-ink/60 uppercase">Agent-ready</span>
        <span className="mt-1.5 text-[22px] font-semibold">{level === "none" ? "—" : s.label}</span>
        <span className="mt-1.5 font-dwmono text-[12px] text-dw-ink/70 tabular-nums">{score}/100</span>
      </div>
    </div>
  );
}

/** Could the agent find price, sizes, delivery and returns? */
export function CriteriaGrid({ criteria }: { criteria: CertificateCriterion[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {criteria.map((c) => {
        const s = CRITERION[c.status];
        const Icon = s.icon;
        return (
          <div key={c.id} className="flex min-w-0 items-start gap-3 rounded-[18px] bg-white/80 p-3">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", s.chip)}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-medium">
                {c.label} <span className="text-[12px] font-normal text-dw-muted">{s.word}</span>
              </div>
              {c.evidence && <div className="mt-0.5 line-clamp-2 text-[13px] break-words text-dw-ink/65">&ldquo;{c.evidence}&rdquo;</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Small agent badge: Grok's glyph, or the Darwin mascot when rules scored it. */
export function JudgeBadge({ cert }: { cert: Pick<ReadinessCertificate, "heuristic" | "model"> }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-medium text-dw-ink shadow-[0_0_0_1px_rgba(20,20,19,0.08)]">
      {isGrok(cert) ? <BrandGlyph brand="grok" size={14} /> : <Mascot kind="analyst" size={16} />}
      {judgedBy(cert)}
    </span>
  );
}

/** The public certificate. */
export function CertificateView({ cert, expired }: { cert: ReadinessCertificate; expired: boolean }) {
  const s = LEVEL_STYLE[cert.level];
  const host = new URL(cert.origin).host;
  return (
    <article className="overflow-hidden rounded-[26px] border border-dw-hairline bg-dw-surface">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8" style={{ background: s.fill }}>
        <CertificateSeal level={cert.level} score={cert.score} className="bg-white" />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="text-[13px] font-semibold tracking-[0.14em] text-dw-ink/60 uppercase">Darwin agent-readiness certificate</div>
          <h1 className="text-[32px] leading-[1.1] font-semibold break-words sm:text-[40px]">{host}</h1>
          <div className="text-[18px] font-medium">
            {cert.level === "none" ? "Not certified yet" : `${s.label} · AI shopping agents can buy here`}
            {expired && <span className="ml-2 rounded-full bg-dw-ink px-2.5 py-0.5 text-[12px] text-white">Expired</span>}
          </div>
          <div>
            <JudgeBadge cert={cert} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6 sm:p-8">
        <p className="text-[16px] leading-relaxed text-dw-ink/85">{cert.verdict}</p>

        {cert.trial && (
          <section className="flex flex-col gap-3">
            <div className="text-[13px] font-semibold tracking-[0.12em] text-dw-muted uppercase">
              What {isGrok(cert) ? "Grok" : "the agent"} could find {cert.trial.mode === "mcp" ? "by shopping your store's tools" : "on your pages"}
            </div>
            <CriteriaGrid criteria={cert.trial.criteria} />
          </section>
        )}

        <dl className="grid grid-cols-2 gap-4 border-t border-dw-hairline pt-5 text-[14px] sm:grid-cols-4">
          <div>
            <dt className="text-[12px] font-semibold tracking-[0.12em] text-dw-muted uppercase">Score</dt>
            <dd className="mt-1 font-dwmono tabular-nums">
              {cert.score}/100 · {cert.grade}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold tracking-[0.12em] text-dw-muted uppercase">Issued</dt>
            <dd className="mt-1">{fmtDate(cert.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold tracking-[0.12em] text-dw-muted uppercase">Valid until</dt>
            <dd className="mt-1">{fmtDate(cert.expiresAt)}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold tracking-[0.12em] text-dw-muted uppercase">Checked</dt>
            <dd className="mt-1 break-all font-dwmono text-[12px] text-dw-ink/60">{cert.id}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
