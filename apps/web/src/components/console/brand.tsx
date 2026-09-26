import { cn } from "@/components/ui/cn";

/** Darwin mark: an open loop with a seed at its centre. */
export function DarwinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="dm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9ff9e" />
          <stop offset="1" stopColor="#7ee0a8" />
        </linearGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r="11.5"
        fill="none"
        stroke="url(#dm-g)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="56 16.3"
        transform="rotate(-58 16 16)"
      />
      <path d="M24.6 5.2 L27.9 9.9 L22.2 10.6 Z" fill="#b6f05a" />
      <circle cx="16" cy="16" r="3.4" fill="#b6f05a" />
    </svg>
  );
}

export function DarwinWordmark({ className, sub }: { className?: string; sub?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <DarwinMark />
      <div className="flex items-baseline gap-2">
        <span className="text-[1.3rem] font-semibold tracking-[-0.02em] text-white">Darwin</span>
        {sub && <span className="text-[0.8rem] font-medium text-white/40">{sub}</span>}
      </div>
    </div>
  );
}

/** GitHub mark (for the connected-repo chip). */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4", className)} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
