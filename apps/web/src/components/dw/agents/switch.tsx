"use client";

import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** The design's switch: 48×28 ink track when on, a white knob that glides. Presentational only. */
export function Track({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex h-7 w-12 shrink-0 items-center rounded-full p-[3px] transition-colors duration-300",
        on ? "bg-dw-ink" : "bg-dw-ink/15",
        className,
      )}
    >
      <span
        className={cn(
          "size-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(20,20,19,0.25)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          on ? "translate-x-5" : "translate-x-0",
        )}
      />
    </span>
  );
}

/**
 * A settings-style row that is itself the switch (role="switch", named by `label` exactly), with a
 * one-line hint under the label.
 */
export function SwitchRow({
  on,
  onChange,
  label,
  hint,
  icon,
  title,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: ReactNode;
  icon?: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink",
        on ? "bg-white/80" : "bg-white/50 hover:bg-white/70",
        className,
      )}
    >
      {icon && <span className="grid size-8 shrink-0 place-items-center rounded-full bg-dw-ink/[0.06] [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-tight font-semibold">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-dw-ink/65">{hint}</span>}
      </span>
      <Track on={on} />
    </button>
  );
}

/** A compact pill switch for toolbars ("Traffic ◯"). */
export function SwitchPill({ on, onChange, label, title, className }: { on: boolean; onChange: (on: boolean) => void; label: string; title?: string; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2.5 rounded-full pr-1.5 pl-4 text-[14px] font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink",
        on ? "bg-dw-ink text-white" : "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
        className,
      )}
    >
      {on && <span className="dw-live-dot size-2 rounded-full bg-dw-live" />}
      {label}
      <span aria-hidden className={cn("relative flex h-7 w-12 items-center rounded-full p-[3px] transition-colors", on ? "bg-white/20" : "bg-dw-ink/15")}>
        <span className={cn("size-[22px] rounded-full bg-white transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none", on ? "translate-x-5" : "translate-x-0")} />
      </span>
    </button>
  );
}
