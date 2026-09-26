/**
 * Group-chat tabs for the Ask Darwin bar. Client-safe: names come from the crew registry, history
 * is a JSON blob per tab, and a stalled reply is aborted and retried so "thinking" cannot sit forever.
 */
import type { CrewId } from "@/lib/contracts";
import { CREW, crewMember, resolveSpecialist, type SpecialistId } from "@/lib/crew";

export interface GroupChat {
  id: string;
  /** Short job name, e.g. "Headline fix". */
  job: string;
  /** "Headline fix - Darwin + Pixel + Fizz". */
  title: string;
  /** Darwin first, then the specialists, crew ids. */
  members: CrewId[];
  createdAt: string;
}

export interface TabStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const GROUP_INDEX_KEY = "darwin.assistant.groups";
export const ACTIVE_TAB_KEY = "darwin.assistant.active";

/** How long one attempt waits before it is treated as stalled. */
export const REPLY_TIMEOUT_MS = 28_000;
/** Extra attempts after the first stall. */
export const REPLY_RETRIES = 1;

const CREW_WORD =
  "iris|theo|ada|max|mika|grok|pixel|fizz|dash|darwin|analyst|designer|tester|experimenter|shipper|watcher";

export function threadKey(tab: string): string {
  return tab === "darwin" ? "darwin.assistant.thread" : `darwin.assistant.thread.${tab}`;
}

export function newGroupId(now = Date.now()): string {
  return `g_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A crew id from a display name, id or old role ("Pixel" → "theo", "Fizz" → "ada"). */
export function crewIdFrom(name: string): CrewId | undefined {
  const key = name.trim().toLowerCase();
  if (key === "darwin") return "darwin";
  const member = crewMember(key);
  if (member) return member.id;
  const specialist: SpecialistId | undefined = resolveSpecialist(key);
  if (!specialist || specialist === "shopper") return undefined;
  return specialist;
}

/** Every crew member named in a sentence, in order, Darwin included when named. */
export function mentionedCrew(text: string): CrewId[] {
  const re = new RegExp(`\\b(${CREW_WORD})\\b`, "gi");
  const out: CrewId[] = [];
  for (const m of text.matchAll(re)) {
    const id = crewIdFrom(m[1]);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function titleCaseJob(raw: string): string {
  const cleaned = raw.replace(/\b(this|that|it|them|us|please)\b/gi, "").replace(/[?.!]+$/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 3) return "Group chat";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** A short job name from "on the headline" / "about checkout". */
export function jobFrom(text: string): string {
  const m = text.match(/\b(?:about|for|on)\s+(?:the\s+)?([a-z][\w'-]{2,}(?:\s+[a-z][\w'-]{2,}){0,3})/i);
  if (!m) return "Group chat";
  return titleCaseJob(m[1]);
}

export function groupTitle(job: string, members: readonly CrewId[]): string {
  const names = members.map((id) => CREW.find((c) => c.id === id)?.name ?? id);
  return `${job} - ${names.join(" + ")}`;
}

export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((id, i) => id === y[i]);
}

/**
 * The merchant asked to bring specialists into the conversation ("get Pixel and Fizz on this",
 * "loop in Iris and Dash"). One name with a plain "ask Iris" stays a direct consult, not a new tab.
 */
export function parseGroupInvite(text: string): { members: CrewId[]; job: string; title: string } | null {
  const named = mentionedCrew(text).filter((id) => id !== "darwin");
  if (named.length < 2 && !/\b(?:loop|bring|invite|pull)\b/i.test(text)) return null;
  if (!named.length) return null;
  const invite =
    named.length >= 2 ||
    /\b(?:get|bring|loop|pull|add|invite|include)\b/i.test(text) ||
    /\bon this\b/i.test(text);
  if (!invite) return null;
  const members: CrewId[] = ["darwin", ...named];
  const job = jobFrom(text);
  return { members, job, title: groupTitle(job, members) };
}

/**
 * A new group tab for this message. Staying inside a group does not swallow a request to bring
 * a different set of people in. The same members stay in the tab that's already open.
 */
export function nextGroupTab(
  current: readonly CrewId[] | undefined,
  text: string,
): { members: CrewId[]; job: string; title: string } | null {
  const invite = parseGroupInvite(text);
  if (!invite) return null;
  if (current && sameMembers(current, invite.members)) return null;
  return invite;
}

/** "@Pixel …" inside a group tab. */
export function mentionTarget(text: string, members?: readonly CrewId[]): CrewId | undefined {
  const m = text.match(/^\s*@([A-Za-z]+)\b/);
  if (!m) return undefined;
  const id = crewIdFrom(m[1]);
  if (!id || id === "darwin") return undefined;
  if (members && !members.includes(id)) return undefined;
  return id;
}

export function readGroups(store: TabStore): GroupChat[] {
  try {
    const raw = store.getItem(GROUP_INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as GroupChat[]) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g) => g && typeof g.id === "string" && Array.isArray(g.members) && g.members.length > 1).slice(0, 12);
  } catch {
    return [];
  }
}

export function writeGroups(store: TabStore, groups: readonly GroupChat[]): void {
  store.setItem(GROUP_INDEX_KEY, JSON.stringify(groups.slice(0, 12)));
}

export function readThread<T>(store: TabStore, tab: string): T[] {
  try {
    const raw = store.getItem(threadKey(tab));
    const parsed = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch {
    return [];
  }
}

export function writeThread(store: TabStore, tab: string, items: unknown[]): void {
  store.setItem(threadKey(tab), JSON.stringify(items.slice(-40)));
}

export function removeThread(store: TabStore, tab: string): void {
  store.removeItem(threadKey(tab));
}

export class ReplyTimeoutError extends Error {
  constructor() {
    super("The reply timed out");
    this.name = "ReplyTimeoutError";
  }
}

/**
 * Fetch a chat reply. A hung request is aborted after `timeoutMs` and tried again `retries` times.
 * The last failure rejects, so the caller can clear "thinking" instead of leaving it up.
 */
export async function fetchReply(
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? REPLY_TIMEOUT_MS;
  const retries = opts.retries ?? REPLY_RETRIES;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ac.signal, cache: "no-store" });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new ReplyTimeoutError();
}
