export function PaceMark({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 28" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 26 L20 2 H31 L19 26 Z" />
      <path d="M24 26 L36 2 H42 L30 26 Z" opacity=".55" />
    </svg>
  );
}

export function PaceLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <PaceMark className="h-[18px] w-auto text-(--accent-logo)" />
      <span className="pace-display text-[1.35rem] font-extrabold tracking-[0.02em]" style={{ fontVariationSettings: '"wdth" 125' }}>
        PACE
      </span>
    </span>
  );
}
