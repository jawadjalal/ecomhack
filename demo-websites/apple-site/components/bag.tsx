"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getProduct, unitPrice } from "@/lib/catalog";
import { track } from "@/lib/track";

export interface BagLine {
  slug: string;
  colour: string;
  option?: string;
  qty: number;
}

interface BagApi {
  lines: BagLine[];
  ready: boolean;
  count: number;
  subtotal: number;
  add: (line: Omit<BagLine, "qty">, source: string) => void;
  setQty: (index: number, qty: number) => void;
  clear: () => void;
}

const KEY = "orchard_bag";
const Ctx = createContext<BagApi | null>(null);

function load(): BagLine[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((l) => getProduct(l?.slug) && l.qty > 0) : [];
  } catch {
    return [];
  }
}

export function lineTotal(l: BagLine): number {
  const p = getProduct(l.slug);
  return p ? unitPrice(p, l.option) * l.qty : 0;
}

export function BagProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<BagLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // localStorage is only readable after hydration.
    setLines(load());
    setReady(true);
    const onStorage = (e: StorageEvent) => e.key === KEY && setLines(load());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = useCallback((next: BagLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }, []);

  const api = useMemo<BagApi>(() => {
    const count = lines.reduce((n, l) => n + l.qty, 0);
    const subtotal = lines.reduce((n, l) => n + lineTotal(l), 0);
    return {
      lines,
      ready,
      count,
      subtotal,
      add(line, source) {
        const p = getProduct(line.slug);
        if (!p) return;
        const i = lines.findIndex((l) => l.slug === line.slug && l.colour === line.colour && l.option === line.option);
        const next = i >= 0 ? lines.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { ...line, qty: 1 }];
        save(next);
        track("product_added", {
          product_id: p.slug,
          name: p.name,
          price: unitPrice(p, line.option),
          quantity: 1,
          colour: line.colour,
          option: line.option,
          source,
        });
      },
      setQty(index, qty) {
        const next = lines.map((l, i) => (i === index ? { ...l, qty } : l)).filter((l) => l.qty > 0);
        const removed = lines[index];
        if (removed && qty <= 0) track("product_removed", { product_id: removed.slug, quantity: removed.qty });
        save(next);
      },
      clear() {
        save([]);
      },
    };
  }, [lines, ready, save]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useBag(): BagApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBag outside BagProvider");
  return v;
}
