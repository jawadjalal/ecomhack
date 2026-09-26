"use client";

import { Ruler, X } from "lucide-react";
import { useEffect, useRef } from "react";

const ROWS = [
  { uk: "6", eu: "39", us: "7", cm: "24.5" },
  { uk: "7", eu: "40.5", us: "8", cm: "25.4" },
  { uk: "8", eu: "42", us: "9", cm: "26.2" },
  { uk: "9", eu: "43", us: "10", cm: "27.1" },
  { uk: "10", eu: "44.5", us: "11", cm: "27.9" },
  { uk: "11", eu: "46", us: "12", cm: "28.8" },
  { uk: "12", eu: "47", us: "13", cm: "29.6" },
];

export function SizeGuide({ open, onClose, fitNote }: { open: boolean; onClose: () => void; fitNote?: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-stretch sm:justify-end" role="dialog" aria-modal="true" aria-labelledby="size-guide-title">
      <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-label="Close size guide" onClick={onClose} tabIndex={-1} />
      <div className="pace-rise relative max-h-[88%] w-full overflow-y-auto rounded-t-[20px] bg-white p-6 shadow-2xl sm:max-h-none sm:max-w-md sm:rounded-none sm:p-8">
        <div className="flex items-center justify-between">
          <h2 id="size-guide-title" className="flex items-center gap-2 text-lg font-semibold">
            <Ruler className="size-5" aria-hidden /> Size guide
          </h2>
          <button ref={closeRef} type="button" onClick={onClose} className="pace-focus rounded-full p-1.5 hover:bg-(--surface)" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-(--muted)">
          Measure your foot from heel to longest toe, standing, at the end of the day. If you&apos;re between sizes, go up half a size for
          long runs.
        </p>
        {fitNote && (
          <p className="pace-card mt-4 bg-(--accent-soft) px-4 py-3 text-sm">
            <span className="font-semibold">Fit tip:</span> {fitNote}
          </p>
        )}
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-(--line) text-left text-(--muted)">
              <th className="py-2 font-medium">UK</th>
              <th className="py-2 font-medium">EU</th>
              <th className="py-2 font-medium">US</th>
              <th className="py-2 font-medium">Foot (cm)</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.uk} className="border-b border-(--line) last:border-0">
                <td className="py-2.5 font-semibold">{r.uk}</td>
                <td className="py-2.5">{r.eu}</td>
                <td className="py-2.5">{r.us}</td>
                <td className="py-2.5">{r.cm}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-xs text-(--muted)">Still unsure? Order two sizes — returns are free for 60 days on all shoes.</p>
      </div>
    </div>
  );
}
