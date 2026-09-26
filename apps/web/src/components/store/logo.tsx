export function PaceMark({ className = "h-5 w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 28" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 26 L20 2 H31 L19 26 Z" />
      <path d="M24 26 L36 2 H42 L30 26 Z" opacity=".55" />
    </svg>
  );
}

export function BrandWordmark({ brand, className = "" }: { brand: string; className?: string }) {
  return <span className={`text-[1.15rem] font-medium uppercase tracking-[0.28em] ${className}`}>{brand}</span>;
}

export function PaceLogo({ className = "" }: { className?: string }) {
  return <BrandWordmark brand="PACE" className={className} />;
}
