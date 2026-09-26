"use client";

/**
 * On phones the four cards become a horizontal, scroll-snapping carousel (one card per screen width) with
 * page dots; from 640px up the children lay out as the usual card rows. Rows pass `DECK_ROW` so their
 * grid dissolves into the carousel on phones, and each card wrapper passes `DECK_ITEM`.
 */
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export const DECK_ROW = "max-sm:contents";
export const DECK_ITEM = "max-sm:w-full max-sm:shrink-0 max-sm:snap-center max-sm:snap-always";

const GAP = 12;

export function CardDeck({ count, labels, children }: { count: number; labels: string[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const stride = () => {
    const el = ref.current;
    if (!el) return 1;
    const first = el.querySelector<HTMLElement>("[data-deck-item]");
    return (first?.offsetWidth ?? el.clientWidth) + GAP;
  };
  const go = (i: number) => ref.current?.scrollTo({ left: i * stride(), behavior: "smooth" });

  return (
    <div className="flex flex-col gap-3.5 lg:gap-3">
      <div
        ref={ref}
        onScroll={(e) => {
          const next = Math.round(e.currentTarget.scrollLeft / stride());
          if (next !== idx) setIdx(Math.max(0, Math.min(count - 1, next)));
        }}
        className="flex flex-col gap-3.5 lg:gap-3 max-sm:-mx-4 max-sm:flex-row max-sm:gap-3 max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:scroll-px-4 max-sm:px-4 max-sm:pb-1 max-sm:snap-x max-sm:snap-mandatory max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      <div className="flex items-center justify-center gap-1.5 sm:hidden" role="tablist" aria-label="Cards">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === idx}
            aria-label={labels[i] ?? `Card ${i + 1}`}
            onClick={() => go(i)}
            className="grid h-6 place-items-center px-0.5"
          >
            <span className={cn("block h-2 rounded-full transition-all duration-300", i === idx ? "w-6 bg-dw-ink" : "w-2 bg-dw-ink/20")} />
          </button>
        ))}
      </div>
    </div>
  );
}
