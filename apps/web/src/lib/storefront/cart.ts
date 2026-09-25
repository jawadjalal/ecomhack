"use client";
/**
 * Client cart persisted in localStorage, shared across tabs and components.
 *
 *   const { lines, add, setQuantity, remove, clear } = useCart();
 */
import { useCallback, useSyncExternalStore } from "react";
import { lineKey, type CartLine } from "./pricing";

const KEY = "pace_cart_v1";
const EMPTY: CartLine[] = [];
const listeners = new Set<() => void>();

let cacheRaw: string | null | undefined;
let cacheLines: CartLine[] = EMPTY;

function isLine(v: unknown): v is CartLine {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return typeof l.productId === "string" && typeof l.size === "string" && typeof l.color === "string" && typeof l.quantity === "number";
}

function readLines(): CartLine[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cacheLines;
  }
  if (raw === cacheRaw) return cacheLines;
  cacheRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cacheLines = Array.isArray(parsed) ? parsed.filter(isLine) : EMPTY;
  } catch {
    cacheLines = EMPTY;
  }
  return cacheLines;
}

function writeLines(lines: CartLine[]) {
  const raw = JSON.stringify(lines);
  cacheRaw = raw;
  cacheLines = lines;
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    /* storage blocked: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function getCartLines(): CartLine[] {
  return typeof window === "undefined" ? EMPTY : readLines();
}

export function addToCart(line: CartLine) {
  const lines = readLines();
  const k = lineKey(line);
  const existing = lines.find((l) => lineKey(l) === k);
  writeLines(
    existing
      ? lines.map((l) => (lineKey(l) === k ? { ...l, quantity: Math.min(10, l.quantity + line.quantity) } : l))
      : [...lines, line],
  );
}

export function setCartQuantity(key: string, quantity: number) {
  const lines = readLines();
  writeLines(quantity <= 0 ? lines.filter((l) => lineKey(l) !== key) : lines.map((l) => (lineKey(l) === key ? { ...l, quantity: Math.min(10, quantity) } : l)));
}

export function clearCart() {
  writeLines([]);
}

export function useCart() {
  const lines = useSyncExternalStore(subscribe, readLines, () => EMPTY);
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  return {
    lines,
    hydrated,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    add: useCallback((line: CartLine) => addToCart(line), []),
    setQuantity: useCallback((key: string, q: number) => setCartQuantity(key, q), []),
    remove: useCallback((key: string) => setCartQuantity(key, 0), []),
    clear: useCallback(() => clearCart(), []),
  };
}

const noopSubscribe = () => () => {};

/* ------------------------------------------------------------------ orders */

export interface StoredOrder {
  id: string;
  createdAt: string;
  email: string;
  firstName: string;
  lines: CartLine[];
  subtotal: number;
  shipping: number;
  total: number;
  deliveryDate?: string;
  express?: boolean;
}

const ORDERS_KEY = "pace_orders_v1";
const TRACKED_KEY = "pace_orders_tracked_v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function saveOrder(order: StoredOrder) {
  const orders = readJson<Record<string, StoredOrder>>(ORDERS_KEY, {});
  // Keep the last 20 orders only.
  const entries = Object.entries({ ...orders, [order.id]: order }).slice(-20);
  writeJson(ORDERS_KEY, Object.fromEntries(entries));
}

export function getOrder(id: string): StoredOrder | null {
  return readJson<Record<string, StoredOrder>>(ORDERS_KEY, {})[id] ?? null;
}

/** Returns true exactly once per order id (per browser) — used to fire order_completed once. */
export function markOrderTracked(id: string): boolean {
  const tracked = readJson<string[]>(TRACKED_KEY, []);
  if (tracked.includes(id)) return false;
  writeJson(TRACKED_KEY, [...tracked.slice(-49), id]);
  return true;
}

/* ------------------------------------------------------------------ "added to bag" toast */

export interface AddedEvent {
  line: CartLine;
  at: number;
}

let lastAdded: AddedEvent | null = null;
const addedListeners = new Set<() => void>();

/** Show the "Added to bag" confirmation (called by add-to-cart buttons). */
export function announceAdded(line: CartLine) {
  lastAdded = { line, at: Date.now() };
  addedListeners.forEach((l) => l());
}

export function dismissAdded() {
  lastAdded = null;
  addedListeners.forEach((l) => l());
}

function subscribeAdded(cb: () => void) {
  addedListeners.add(cb);
  return () => {
    addedListeners.delete(cb);
  };
}

export function useLastAdded(): AddedEvent | null {
  return useSyncExternalStore(
    subscribeAdded,
    () => lastAdded,
    () => null,
  );
}
