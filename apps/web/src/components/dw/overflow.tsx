"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

/**
 * One overflow control for secondary page actions (site tools, simulators, mode toggles).
 * Closes on outside click, Escape, or a link. Switches stay open so they can be flipped.
 */
export function Overflow({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid size-10 place-items-center rounded-full text-dw-ink/70 transition-colors hover:bg-dw-sand hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
      >
        <Ellipsis className="size-5" />
      </button>
      {open && (
        <div
          className="absolute top-12 right-0 z-50 flex w-[280px] flex-col items-stretch gap-2 rounded-[22px] border border-dw-hairline bg-dw-surface p-3 shadow-[0_24px_60px_-20px_rgba(20,20,19,0.35)]"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
