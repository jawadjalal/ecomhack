/**
 * Small cream-design controls shared by Personalize and Traffic: a labelled switch, icon buttons,
 * a site picker, a browser-window frame and a toast. Presentation only.
 */
"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Globe, LoaderCircle, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink";

/**
 * Pill switch with a visible label. The accessible name is exactly `label` (scripts look for
 * "Autopilot", "Traffic", "Heatmap"), and `title` explains what it does.
 */
export function DwSwitch({
  on,
  onChange,
  label,
  title,
  disabled,
  busy,
  className,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2.5 rounded-full pr-4 pl-1.5 text-[14px] font-medium whitespace-nowrap transition-colors select-none disabled:opacity-45",
        on ? "bg-dw-ink text-white" : "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
        FOCUS,
        className,
      )}
    >
      <span className={cn("relative flex h-7 w-12 items-center rounded-full p-[3px] transition-colors", on ? "bg-white/20" : "bg-dw-ink/15")}>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 600, damping: 35 }}
          className={cn("grid size-[22px] place-items-center rounded-full bg-white shadow-[0_1px_3px_rgba(20,20,19,0.25)]", on && "ml-auto")}
        >
          {busy ? <LoaderCircle className="size-3 animate-spin text-dw-ink" /> : on ? <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" /> : null}
        </motion.span>
      </span>
      <span aria-hidden>{label}</span>
    </button>
  );
}

/** Round icon button (aria-label = title). */
export function IconBtn({
  title,
  onClick,
  busy,
  children,
  tone = "ghost",
  className,
}: {
  title: string;
  onClick: () => void;
  busy?: boolean;
  children: ReactNode;
  tone?: "ghost" | "white" | "ink";
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full transition-[background-color,transform] active:scale-95 [&_svg]:size-4",
        tone === "ghost" && "text-dw-ink/60 hover:bg-white/70 hover:text-dw-ink",
        tone === "white" && "bg-white text-dw-ink shadow-[0_1px_0_rgba(20,20,19,0.06)] hover:bg-[#fffaf0]",
        tone === "ink" && "bg-dw-ink text-white hover:bg-black",
        FOCUS,
        className,
      )}
    >
      {busy ? <LoaderCircle className="animate-spin" /> : children}
    </button>
  );
}

/** Native select dressed as a sand pill ("Site  north-trail ▾"). */
export function SiteSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="relative flex h-10 shrink-0 items-center gap-2 rounded-full bg-dw-sand pr-3 pl-3.5 text-[14px] text-dw-ink/70 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-dw-ink">
      <Globe className="size-4 text-dw-ink/50" aria-hidden />
      <span>Site</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Site"
        className="max-w-[12rem] cursor-pointer appearance-none truncate bg-transparent pr-5 font-semibold text-dw-ink outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-dw-ink/50" aria-hidden />
    </label>
  );
}

/** A browser window: traffic-light dots, an address pill and a slot for actions, around `children`. */
export function BrowserFrame({ address, badge, actions, children, className }: { address: ReactNode; badge?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[20px] border border-dw-ink/10 bg-white shadow-[0_24px_50px_-28px_rgba(20,20,19,0.45)]", className)}>
      <div className="flex h-12 items-center gap-3 border-b border-dw-hairline bg-[#FBF7EE] px-4">
        <span className="flex shrink-0 gap-1.5 max-sm:hidden" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#F0A59A]" />
          <span className="size-2.5 rounded-full bg-[#F2D27A]" />
          <span className="size-2.5 rounded-full bg-[#9FD3A8]" />
        </span>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-dw-sand/70 px-3.5 text-[13px] text-dw-ink/70">
          <span className="min-w-0 truncate font-dwmono text-[12px]">{address}</span>
          {badge && <span className="ml-auto shrink-0">{badge}</span>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** Bottom-centre toast: ink for good news, warm for problems. */
export function DwToast({ toast }: { toast?: { text: string; tone: "good" | "bad" } }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.text}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className={cn(
              "pointer-events-auto flex max-w-[40rem] items-center gap-2.5 rounded-full py-2.5 pr-5 pl-2.5 text-[14px] shadow-[0_18px_40px_-16px_rgba(20,20,19,0.45)]",
              toast.tone === "good" ? "bg-dw-ink text-white" : "bg-dw-warn-bg text-dw-warn",
            )}
          >
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full", toast.tone === "good" ? "bg-dw-live text-white" : "bg-dw-warn text-white")}>
              {toast.tone === "good" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            </span>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Tiny section label inside a card ("Who sees it"). Sentence case, not an eyebrow. */
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-2 text-[13px] font-medium text-dw-ink/60", className)}>{children}</div>;
}

/** Keeps a PageHead right slot from overflowing narrow screens: wraps controls instead. */
export const HEAD_CONTROLS = "flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-start gap-2 sm:max-w-[calc(100vw-3.5rem)] lg:justify-end";

/**
 * A card heading whose right side wraps under the title on narrow screens (CardTitle keeps both on
 * one line, which squeezes long titles on phones).
 */
export function CardHead({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <h2 className="min-w-0 text-[22px] leading-tight font-semibold tracking-[-0.02em]">{children}</h2>
      {right && <div className="flex flex-wrap items-center gap-2 text-[13px] text-dw-ink/70">{right}</div>}
    </div>
  );
}
