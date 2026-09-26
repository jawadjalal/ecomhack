"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** A copy-paste code block (ink on cream-white) with a copy button that ticks when done. */
export function Snippet({ code, label, className, dark }: { code: string; label: string; className?: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };

  return (
    <div className={cn("group relative rounded-2xl", dark ? "bg-dw-ink text-[#EDE6D6]" : "bg-white/70 text-dw-ink ring-1 ring-dw-ink/[0.06]", className)}>
      <pre
        aria-label={label}
        tabIndex={0}
        className="overflow-x-auto px-4 py-3.5 pr-14 font-dwmono text-[12.5px] leading-[1.65] whitespace-pre focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none"
      >
        {code}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : `Copy ${label}`}
        className={cn(
          "absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full transition-[background-color,transform] active:scale-90",
          "focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none",
          dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={copied ? "y" : "n"}
            initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="grid place-items-center"
          >
            {copied ? <Check className="size-4" strokeWidth={2.4} /> : <Copy className="size-[15px]" />}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
