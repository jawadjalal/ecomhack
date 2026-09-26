/**
 * Everything Darwin's watch has to remember, in the shared KV. OWNED BY: team.
 *
 * Keys (all under .data/): team-watch-settings, team-watch-policies, team-watch-runs, team-watch-sent,
 * team-watch-tokens, team-watch-memory, team-watch-kpis, team-watch-lease.
 *
 * Nothing here talks to another area: it is state only. Rounding, scoring and wording live in their own
 * modules (notability.ts, persona.ts) so this stays boring and easy to reason about.
 */
import { createHash } from "node:crypto";
import type { AutonomyLevel, Policy, ProactiveAction, Signal, SignalSeverity, WatchAction, WatchRun, WatchSettings } from "@/lib/contracts/watch";
import { kvDelete, kvGet, kvSet, kvUpdate } from "@/lib/db/json-store";
import { id } from "@/lib/ids";

const SETTINGS_KEY = "team-watch-settings";
const POLICIES_KEY = "team-watch-policies";
const RUNS_KEY = "team-watch-runs";
const SENT_KEY = "team-watch-sent";
const TOKENS_KEY = "team-watch-tokens";
const MEMORY_KEY = "team-watch-memory";
const KPIS_KEY = "team-watch-kpis";
const LEASE_KEY = "team-watch-lease";

export const MAX_RUNS = 20;
export const MAX_SENT = 200;
export const MAX_TOKENS = 200;
export const MAX_MEMORY = 200;
export const MAX_KPI_POINTS = 96;
/** How long a one-tap action stays usable. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** A watch run holds the lease for this long, so two overlapping runs never both send. */
export const LEASE_MS = 90_000;

/* ------------------------------------------------------------------ settings */

export const DEFAULT_SETTINGS: WatchSettings = {
  autonomy: "suggest",
  timezone: "Europe/London",
  quietHours: { start: 22, end: 7 },
  digestHour: 9,
  enabled: true,
};

function envSettings(): Partial<WatchSettings> {
  const tz = process.env.DARWIN_TIMEZONE?.trim();
  const level = process.env.DARWIN_AUTONOMY?.trim() as AutonomyLevel | undefined;
  return {
    ...(tz ? { timezone: tz } : {}),
    ...(level && ["off", "suggest", "auto-safe", "autopilot"].includes(level) ? { autonomy: level } : {}),
  };
}

export function getWatchSettings(): WatchSettings {
  return { ...DEFAULT_SETTINGS, ...envSettings(), ...kvGet<Partial<WatchSettings>>(SETTINGS_KEY, () => ({})) };
}

export function setWatchSettings(patch: Partial<WatchSettings>): WatchSettings {
  const next = { ...getWatchSettings(), ...patch };
  kvSet(SETTINGS_KEY, next);
  return next;
}

/* ------------------------------------------------------------------ policies */

export function listPolicies(): Policy[] {
  return kvGet<Policy[]>(POLICIES_KEY, () => []);
}

export function savePolicy(policy: Policy): Policy {
  kvUpdate<Policy[]>(POLICIES_KEY, () => [], (all) => [policy, ...all.filter((p) => p.id !== policy.id)].slice(0, 50));
  return policy;
}

export function getPolicy(policyId: string): Policy | undefined {
  return listPolicies().find((p) => p.id === policyId);
}

export function markPolicyUsed(policyId: string, now = Date.now()) {
  const policy = getPolicy(policyId);
  if (!policy) return;
  savePolicy({ ...policy, uses: policy.uses + 1, lastUsedAt: new Date(now).toISOString() });
}

export function removePolicy(policyId: string): boolean {
  const before = listPolicies().length;
  kvUpdate<Policy[]>(POLICIES_KEY, () => [], (all) => all.filter((p) => p.id !== policyId));
  return listPolicies().length < before;
}

/** Count of policy-driven actions today (for a policy's maxPerDay). */
export function policyUsesToday(policyId: string, now: number): number {
  const day = new Date(now).toISOString().slice(0, 10);
  return listMemory().filter((m) => m.policyId === policyId && m.at.slice(0, 10) === day).length;
}

/* ------------------------------------------------------------------ runs */

export function listRuns(): WatchRun[] {
  return kvGet<WatchRun[]>(RUNS_KEY, () => []);
}

export function saveRun(run: WatchRun): WatchRun {
  kvUpdate<WatchRun[]>(RUNS_KEY, () => [], (all) => [run, ...all.filter((r) => r.id !== run.id)].slice(0, MAX_RUNS));
  return run;
}

export function lastRun(): WatchRun | undefined {
  return listRuns()[0];
}

/* ------------------------------------------------------------------ what Darwin has already said */

export interface SentRecord {
  messageId: string;
  fingerprint: string;
  signalId: string;
  severity: SignalSeverity;
  /** The signal's score when it was sent, so "it got worse" can beat the 24h dedupe. */
  score: number;
  at: string;
  digest?: boolean;
}

export function listSent(): SentRecord[] {
  return kvGet<SentRecord[]>(SENT_KEY, () => []);
}

export function recordSent(record: SentRecord): SentRecord {
  kvUpdate<SentRecord[]>(SENT_KEY, () => [], (all) => [record, ...all].slice(0, MAX_SENT));
  return record;
}

/* ------------------------------------------------------------------ one-tap action tokens */

export interface StoredToken {
  token: string;
  label: string;
  risk: ProactiveAction["risk"];
  action: WatchAction;
  /** sha256 of the canonical action + args: a token can only ever do the thing it was minted for. */
  argsHash: string;
  signalId?: string;
  /** So a "no" remembers the idea, not just the button. */
  fingerprint?: string;
  messageId?: string;
  chatId: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  /** Set when the merchant (or a policy) already answered it. */
  outcome?: "ran" | "dismissed" | "failed";
}

/** Stable hash of an action, so a token can't be pointed at different arguments later. */
export function hashAction(action: WatchAction): string {
  return createHash("sha256").update(canonical(action)).digest("hex").slice(0, 32);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function listTokens(): StoredToken[] {
  return kvGet<StoredToken[]>(TOKENS_KEY, () => []);
}

export function mintToken(input: Omit<StoredToken, "token" | "argsHash" | "createdAt" | "expiresAt"> & { now?: number; ttlMs?: number }): StoredToken {
  const now = input.now ?? Date.now();
  const stored: StoredToken = {
    label: input.label,
    risk: input.risk,
    action: input.action,
    chatId: input.chatId,
    signalId: input.signalId,
    fingerprint: input.fingerprint,
    messageId: input.messageId,
    token: id("act"),
    argsHash: hashAction(input.action),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? TOKEN_TTL_MS)).toISOString(),
  };
  kvUpdate<StoredToken[]>(TOKENS_KEY, () => [], (all) => [stored, ...all].slice(0, MAX_TOKENS));
  return stored;
}

export function getToken(token: string): StoredToken | undefined {
  return listTokens().find((t) => t.token === token);
}

/** Mark a token used (single use). Returns false when it was already spent. */
export function consumeToken(token: string, outcome: StoredToken["outcome"], now = Date.now()): boolean {
  let claimed = false;
  kvUpdate<StoredToken[]>(TOKENS_KEY, () => [], (all) =>
    all.map((t) => {
      if (t.token !== token || t.usedAt) return t;
      claimed = true;
      return { ...t, usedAt: new Date(now).toISOString(), outcome };
    }),
  );
  return claimed;
}

/** Tokens a merchant could still tap: not used, not expired. */
export function openTokens(now = Date.now()): StoredToken[] {
  return listTokens().filter((t) => !t.usedAt && Date.parse(t.expiresAt) > now);
}

export function expireTokens(now = Date.now()) {
  kvUpdate<StoredToken[]>(TOKENS_KEY, () => [], (all) => all.filter((t) => Date.parse(t.expiresAt) > now - TOKEN_TTL_MS));
}

/* ------------------------------------------------------------------ memory: what the merchant said, what shipped */

export interface MemoryEntry {
  id: string;
  at: string;
  kind: "approved" | "rejected" | "shipped" | "followed-up" | "auto";
  /** The signal fingerprint the decision was about (so a rejected idea isn't re-proposed). */
  fingerprint?: string;
  signalId?: string;
  /** What it was about, in the merchant's words where possible. */
  label: string;
  /** Free-form detail: the action, the result, the numbers at the time. */
  detail?: string;
  /** Set when a standing policy (not a tap) allowed it. */
  policyId?: string;
  /** For ship follow-ups: the conversion rate when it shipped (as the owning area reported it). */
  baseline?: number;
  /** Set once the 7-day follow-up has been sent. */
  followedUpAt?: string;
}

export function listMemory(): MemoryEntry[] {
  return kvGet<MemoryEntry[]>(MEMORY_KEY, () => []);
}

export function remember(entry: Omit<MemoryEntry, "id" | "at"> & { at?: string }): MemoryEntry {
  const full: MemoryEntry = { ...entry, id: id("mem"), at: entry.at ?? new Date().toISOString() };
  kvUpdate<MemoryEntry[]>(MEMORY_KEY, () => [], (all) => [full, ...all].slice(0, MAX_MEMORY));
  return full;
}

export function updateMemory(memoryId: string, patch: Partial<MemoryEntry>) {
  kvUpdate<MemoryEntry[]>(MEMORY_KEY, () => [], (all) => all.map((m) => (m.id === memoryId ? { ...m, ...patch } : m)));
}

/* ------------------------------------------------------------------ KPI band history (real traffic only) */


/** A reading of the store's real (non-simulated) totals, so a window can be derived from two of them. */
export interface KpiPoint {
  at: string;
  visitors: number;
  orders: number;
  revenuePence: number;
}

export function listKpiPoints(): KpiPoint[] {
  return kvGet<KpiPoint[]>(KPIS_KEY, () => []);
}

export function recordKpiPoint(point: KpiPoint): KpiPoint[] {
  return kvUpdate<KpiPoint[]>(KPIS_KEY, () => [], (all) => [...all, point].slice(-MAX_KPI_POINTS));
}

/* ------------------------------------------------------------------ lease (idempotency) */

interface Lease {
  holder: string;
  until: number;
}

/** Take the watch lease, or return undefined when another run holds it. */
export function acquireLease(now = Date.now(), ms = LEASE_MS): string | undefined {
  const current = kvGet<Lease | null>(LEASE_KEY, () => null);
  if (current && current.until > now) return undefined;
  const holder = id("wlease");
  kvSet<Lease>(LEASE_KEY, { holder, until: now + ms });
  return holder;
}

export function releaseLease(holder: string) {
  const current = kvGet<Lease | null>(LEASE_KEY, () => null);
  if (current?.holder === holder) kvSet<Lease | null>(LEASE_KEY, null);
}

export function leaseHeldUntil(): number | undefined {
  const current = kvGet<Lease | null>(LEASE_KEY, () => null);
  return current?.until;
}

/* ------------------------------------------------------------------ signals kept with their run */

/** Point a signal at the group chat the team opened for it. */
export function attachSignalChat(signalId: string, chatId: string) {
  kvUpdate<WatchRun[]>(RUNS_KEY, () => [], (all) =>
    all.map((run) => ({
      ...run,
      signals: run.signals.map((s) => (s.id === signalId ? { ...s, chatId } : s)),
    })),
  );
}

/** Find a signal (and the run it came from) by id, newest run first. */
export function findSignal(signalId: string): { signal: Signal; run: WatchRun } | undefined {
  for (const run of listRuns()) {
    const signal = run.signals.find((s) => s.id === signalId);
    if (signal) return { signal, run };
  }
  return undefined;
}

/** Wipe everything the watch remembers (tests, and the console's reset). */
export function resetWatchStore() {
  for (const key of [SETTINGS_KEY, POLICIES_KEY, RUNS_KEY, SENT_KEY, TOKENS_KEY, MEMORY_KEY, KPIS_KEY, LEASE_KEY]) kvDelete(key);
}
