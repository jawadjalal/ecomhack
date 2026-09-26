"use client";

import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, FileCode, GitBranch, GitPullRequest, PartyPopper } from "lucide-react";
import type { GenerationRecord } from "@/lib/contracts";
import { pct, prNumberFromUrl, signedPct, type PrInfo } from "@/lib/console/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

/* Deterministic confetti (no Math.random during render). */
const CONFETTI = Array.from({ length: 34 }, (_, i) => {
  const a = (i / 34) * Math.PI * 2 + (i % 3) * 0.21;
  const dist = 9 + ((i * 37) % 11);
  return {
    x: Math.cos(a) * dist,
    y: Math.sin(a) * dist * 0.62 - 3,
    rot: ((i * 71) % 360) - 180,
    color: ["#b6f05a", "#4c94f0", "#e0609a", "#f5b429", "#ffffff"][i % 5],
    w: 0.35 + ((i * 13) % 4) * 0.12,
    delay: (i % 7) * 0.025,
  };
});

export function Celebration({ runKey }: { runKey: string | number }) {
  return (
    <div key={runKey} className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      <motion.div
        className="absolute size-[10rem] rounded-full bg-brand/30 blur-3xl"
        initial={{ scale: 0.2, opacity: 0.9 }}
        animate={{ scale: 3.2, opacity: 0 }}
        transition={{ duration: 1.6, ease: "easeOut" }}
      />
      {CONFETTI.map((c, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[1px]"
          style={{ width: `${c.w}rem`, height: `${c.w * 0.45}rem`, background: c.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: `${c.x}rem`, y: [`0rem`, `${c.y}rem`, `${c.y + 6}rem`], opacity: [1, 1, 0], rotate: c.rot * 3, scale: 1 }}
          transition={{ duration: 2.2, delay: c.delay, ease: [0.16, 0.84, 0.44, 1] }}
        />
      ))}
    </div>
  );
}

export function PrCard({
  pr,
  prUrl,
  fallbackTitle,
  onOpen,
  className,
}: {
  pr?: PrInfo;
  prUrl?: string;
  fallbackTitle?: string;
  onOpen?: () => void;
  className?: string;
}) {
  const url = pr?.url ?? prUrl;
  const number = pr?.number ?? prNumberFromUrl(url);
  const dry = pr?.dryRun ?? !url;
  const status = pr?.queued ? "Queued" : dry ? "Dry run" : "Open";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 22, delay: 0.15 }}
      className={cn("flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0d1117] p-5", className)}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-[#238636]/20 text-[#3fb950]">
          <GitPullRequest className="size-[1.1rem]" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[0.75rem] text-white/45">
            {dry && !url ? "PR preview (dry run)" : `Pull request ${number ? `#${number}` : ""}`}
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone={dry ? "warn" : "good"}>{status}</Badge>
            {dry && <span className="text-[0.72rem] text-white/35">{pr?.repo ? `${pr.repo} · ` : ""}nothing pushed</span>}
          </span>
        </div>
      </div>
      <div className="text-[1.15rem] leading-snug font-semibold text-white">{pr?.title ?? fallbackTitle ?? "Promote the winning spec"}</div>
      {dry && pr?.note && !pr.title && <div className="line-clamp-2 text-[0.78rem] leading-relaxed text-white/45">{pr.note}</div>}
      {pr?.branch && (
        <div className="flex items-center gap-2 font-mono text-[0.74rem] text-white/50">
          <GitBranch className="size-3.5" />
          <span className="rounded bg-[#388bfd]/15 px-1.5 py-0.5 text-[#79c0ff]">{pr.branch}</span>
          <ArrowRight className="size-3" />
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5">main</span>
        </div>
      )}
      {pr?.files?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {pr.files.slice(0, 3).map((f) => (
            <span key={f.path} className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1 font-mono text-[0.7rem] text-white/60">
              <FileCode className="size-3" />
              {f.path}
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2 pt-1">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <Button variant="primary" size="sm">
              View on GitHub <ArrowUpRight />
            </Button>
          </a>
        ) : null}
        {pr && onOpen && (pr.body || pr.files?.length) ? (
          <Button variant="secondary" size="sm" onClick={onOpen}>
            {url ? "Details" : "View PR body & diff"}
          </Button>
        ) : null}
      </div>
    </motion.div>
  );
}

export function ShipStage({
  pr,
  record,
  baseline,
  previous,
  onOpenPr,
}: {
  pr?: PrInfo;
  record?: GenerationRecord;
  baseline?: GenerationRecord;
  previous?: GenerationRecord;
  onOpenPr: () => void;
}) {
  return (
    <div className="relative grid min-h-0 grid-cols-1 gap-6 sm:h-full sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Celebration runKey={record?.generation ?? 0} />
      <div className="relative flex flex-col justify-center gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-[0.8rem] font-medium tracking-[0.16em] text-brand uppercase"
        >
          <PartyPopper className="size-4" /> Shipped
        </motion.div>
        <motion.h3
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.03em] text-white"
        >
          Generation {record?.generation ?? "?"} is live
        </motion.h3>
        <div className="text-[1rem] text-white/55">{record?.label}</div>
        {record && previous && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            {(
              [
                ["🧑 Humans", previous.humanConversionRate, record.humanConversionRate, 1, baseline?.humanConversionRate],
                ["🤖 Agents", previous.agentConversionRate, record.agentConversionRate, 0, baseline?.agentConversionRate],
              ] as const
            ).map(([label, before, after, digits, base]) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
              >
                <div className="text-[0.8rem] text-white/50">{label}</div>
                <div className="mt-1 flex items-baseline gap-2 tabular">
                  <span className="text-[1rem] text-white/40">{pct(before, digits)}</span>
                  <ArrowRight className="size-4 self-center text-white/30" />
                  <span className="text-[1.8rem] leading-none font-semibold text-white">{pct(after, digits)}</span>
                </div>
                {base !== undefined && base > 0 && (
                  <div className="mt-1 text-[0.75rem] font-medium text-[#7ee2a0] tabular">{signedPct((after - base) / base)} since Gen 0</div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>
      <div className="relative flex flex-col justify-center">
        <PrCard
          pr={pr}
          prUrl={record?.prUrl}
          fallbackTitle={record ? `Darwin Gen ${record.generation}: ${record.label.replace(/^Gen \d+:\s*/, "")}` : undefined}
          onOpen={onOpenPr}
        />
      </div>
    </div>
  );
}
