"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PageSpec } from "@/lib/spec";
import type { CartLine } from "@/lib/commerce";

const SpecContext = createContext<PageSpec | null>(null);

export function useSpec(): PageSpec {
  const spec = useContext(SpecContext);
  if (!spec) throw new Error("useSpec outside <Providers>");
  return spec;
}

interface CartApi {
  lines: CartLine[];
  count: number;
  ready: boolean;
  add: (id: string, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Last "added" toast. */
  toast: string | null;
  showToast: (msg: string) => void;
}

const CartContext = createContext<CartApi | null>(null);

export function useCart(): CartApi {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart outside <Providers>");
  return cart;
}

const KEY = "rackd_cart";

export function Providers({ spec, children }: { spec: PageSpec; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Set during render (not in an effect): child effects such as <TrackView> run before a parent's
  // effects, and their first event must already say which config the shopper saw.
  if (typeof window !== "undefined") window.__rackdSpec = { version: spec.version, label: spec.label };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const api = useMemo<CartApi>(
    () => ({
      lines,
      ready,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (id, qty = 1) => {
        const existing = lines.find((l) => l.id === id);
        persist(existing ? lines.map((l) => (l.id === id ? { ...l, qty: l.qty + qty } : l)) : [...lines, { id, qty }]);
      },
      setQty: (id, qty) => persist(qty <= 0 ? lines.filter((l) => l.id !== id) : lines.map((l) => (l.id === id ? { ...l, qty } : l))),
      remove: (id) => persist(lines.filter((l) => l.id !== id)),
      clear: () => persist([]),
      toast,
      showToast,
    }),
    [lines, ready, persist, toast, showToast],
  );

  return (
    <SpecContext.Provider value={spec}>
      <CartContext.Provider value={api}>{children}</CartContext.Provider>
    </SpecContext.Provider>
  );
}
