"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "./cn";

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  className,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("[data-autofocus], input, button")?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          data-modal-open
        >
          <button aria-label="Close" className="absolute inset-0 bg-[#020305]/75 backdrop-blur-md" onClick={onClose} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className={cn(
              "relative flex max-h-[88vh] w-full max-w-[40rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e14] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]",
              className,
            )}
          >
            <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-6 py-4">
              <div className="flex items-center gap-2.5 text-[1.05rem] font-semibold text-white">
                {icon && <span className="text-brand [&>svg]:size-[1.1rem]">{icon}</span>}
                {title}
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close">
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <footer className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-6 py-4">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
