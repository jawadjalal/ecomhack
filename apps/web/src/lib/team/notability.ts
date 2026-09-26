/**
 * Should Darwin speak? OWNED BY: team.
 *
 * A signal earns a message on severity × novelty × actionability, and then has to get past the things that
 * make a teammate bearable: don't say the same thing twice in a day (unless it got worse), don't re-propose
 * something the merchant already said no to for 30 days (unless the data moved a lot), at most one message
 * an hour and six a day, nothing but "urgent" inside the merchant's quiet hours. Everything Darwin swallows
 * goes into the daily digest instead, so nothing is silently lost.
 *
 * All of this is pure: the time and the stored history come in as arguments, which is why the tests can
 * move the clock without touching the process clock.
 */
import type { Signal, SignalSeverity, SignalVerdict, WatchSettings } from "@/lib/contracts/watch";
import type { MemoryEntry, SentRecord } from "./watch-store";

/** severity × novelty × actionability has to clear this before Darwin opens his mouth. */
export const SPEAK_THRESHOLD = 0.45;
/** Same signal, same day: stay quiet unless the number moved this much against the merchant. */
export const WORSE_BY = 0.1;
/** A rejected idea is off the table for 30 days, unless the data changed by this much. */
export const REJECT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const REJECT_OVERRIDE_BY = 0.2;
export const DEDUPE_MS = 24 * 60 * 60 * 1000;
export const MAX_PER_HOUR = 1;
export const MAX_PER_DAY = 6;

const SEVERITY_WEIGHT: Record<SignalSeverity, number> = { low: 0.3, normal: 0.6, high: 0.85, urgent: 1 };

export interface GateContext {
  now: number;
  settings: WatchSettings;
  /** Everything Darwin has sent, newest first. */
  sent: SentRecord[];
  /** What the merchant said yes and no to. */
  memory: MemoryEntry[];
}

export interface GateResult {
  /** The one signal Darwin speaks about this run (at most one: he isn't a notification feed). */
  speak?: Signal;
  /** Everything worth remembering but not worth interrupting for. */
  digest: Signal[];
  verdicts: SignalVerdict[];
}

/** The local hour in the merchant's timezone (falls back to UTC for a timezone we can't read). */
export function localHour(now: number, timezone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hour12: false }).format(new Date(now))) % 24;
  } catch {
    return new Date(now).getUTCHours();
  }
}

/** The local calendar day, for "once a day" limits. */
export function localDay(now: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

/** Quiet hours wrap midnight: { start: 22, end: 7 } is 22:00 to 07:00. */
export function isQuietHour(now: number, settings: WatchSettings): boolean {
  const { start, end } = settings.quietHours;
  if (start === end) return false;
  const hour = localHour(now, settings.timezone);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** severity × novelty × actionability, 0-1. */
export function notability(signal: Signal, ctx: GateContext): number {
  const severity = SEVERITY_WEIGHT[signal.severity];
  const actionability = signal.suggestedAction ? 1 : 0.6;
  return severity * novelty(signal, ctx) * actionability;
}

/** 1 for something new, less for something Darwin already said (and 0 when it hasn't moved at all). */
export function novelty(signal: Signal, ctx: GateContext): number {
  const previous = ctx.sent.find((s) => s.fingerprint === signal.fingerprint && ctx.now - Date.parse(s.at) < DEDUPE_MS);
  if (!previous) return 1;
  const worse = (signal.score ?? 0) - previous.score;
  return worse >= WORSE_BY ? 0.8 : 0;
}

/** The merchant said no to this idea recently, and nothing has changed enough to ask again. */
export function inRejectCooldown(signal: Signal, ctx: GateContext): boolean {
  const no = ctx.memory.find((m) => m.kind === "rejected" && m.fingerprint === signal.fingerprint && ctx.now - Date.parse(m.at) < REJECT_COOLDOWN_MS);
  if (!no) return false;
  const before = typeof no.baseline === "number" ? no.baseline : undefined;
  if (before === undefined || signal.score === undefined) return true;
  return signal.score - before < REJECT_OVERRIDE_BY;
}

function sentSince(ctx: GateContext, ms: number): number {
  return ctx.sent.filter((s) => !s.digest && ctx.now - Date.parse(s.at) < ms).length;
}

/**
 * Decide what (if anything) Darwin says this run. At most one message; everything else is remembered for the
 * digest, with the reason it stayed quiet.
 */
export function gate(signals: Signal[], ctx: GateContext): GateResult {
  const verdicts: SignalVerdict[] = [];
  const digest: Signal[] = [];
  const off = !ctx.settings.enabled || ctx.settings.autonomy === "off";

  const ranked = signals
    .map((signal) => ({ signal, score: notability(signal, ctx) }))
    .sort((a, b) => b.score - a.score || (b.signal.score ?? 0) - (a.signal.score ?? 0));

  const quiet = isQuietHour(ctx.now, ctx.settings);
  const perHour = sentSince(ctx, 60 * 60 * 1000);
  const perDay = sentSince(ctx, 24 * 60 * 60 * 1000);
  let spoke: Signal | undefined;

  for (const { signal, score } of ranked) {
    const urgent = signal.severity === "urgent";
    const push = (reason: SignalVerdict["reason"], digested = true) => {
      verdicts.push({ signalId: signal.id, score, spoke: false, reason, ...(digested ? { digested: true } : {}) });
      if (digested) digest.push(signal);
    };
    if (off) {
      push("autonomy-off", false);
      continue;
    }
    if (inRejectCooldown(signal, ctx)) {
      push("cooldown", false);
      continue;
    }
    if (novelty(signal, ctx) === 0) {
      push("duplicate", false);
      continue;
    }
    if (spoke || score < SPEAK_THRESHOLD) {
      push("nothing-notable");
      continue;
    }
    if (quiet && !urgent) {
      push("quiet-hours");
      continue;
    }
    if (!urgent && (perHour >= MAX_PER_HOUR || perDay >= MAX_PER_DAY)) {
      push("rate-limited");
      continue;
    }
    spoke = signal;
    verdicts.push({ signalId: signal.id, score, spoke: true });
  }

  return { ...(spoke ? { speak: spoke } : {}), digest, verdicts };
}

/** Is the daily digest due? Once a day, from the merchant's digest hour, and only if there's something in it. */
export function digestDue(ctx: GateContext, hasContent: boolean): boolean {
  if (!hasContent || !ctx.settings.enabled || ctx.settings.autonomy === "off") return false;
  if (localHour(ctx.now, ctx.settings.timezone) < ctx.settings.digestHour) return false;
  const today = localDay(ctx.now, ctx.settings.timezone);
  if (ctx.sent.some((s) => s.digest && localDay(Date.parse(s.at), ctx.settings.timezone) === today)) return false;
  // The digest is a message too: it waits out the same one-an-hour cap as everything else.
  const hourAgo = ctx.now - 60 * 60 * 1000;
  return !ctx.sent.some((s) => !s.digest && Date.parse(s.at) > hourAgo);
}
