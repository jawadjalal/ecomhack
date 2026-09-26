import type { ReactNode } from "react";
import { cn } from "./cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-[0.35rem] border border-white/15 border-b-white/25 bg-white/[0.05] px-1 font-mono text-[0.66rem] leading-none font-medium text-white/60",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
