import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "human" | "agent" | "good" | "bad" | "warn" | "info" | "outline";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-white/[0.06] text-white/70 border-white/[0.08]",
  brand: "bg-brand/12 text-brand border-brand/25",
  human: "bg-human/12 text-[#9cc5ff] border-human/30",
  agent: "bg-agent/12 text-[#f5a6cb] border-agent/30",
  good: "bg-good/12 text-[#7ee2a0] border-good/30",
  bad: "bg-bad/12 text-[#ff9b9b] border-bad/30",
  warn: "bg-warn/12 text-[#ffd27a] border-warn/30",
  info: "bg-sky-400/10 text-sky-200 border-sky-300/25",
  outline: "bg-transparent text-white/60 border-white/15",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[0.15rem] text-[0.72rem] leading-none font-medium whitespace-nowrap [&>svg]:size-[0.8rem]",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Tiny uppercase tag, e.g. SYNTHETIC. */
export function Tag({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[0.3rem] border border-warn/15 px-1 py-[0.08rem] font-mono text-[0.56rem] leading-none font-medium tracking-[0.08em] text-[#f8cf7a]/55 uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
