"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import type { Briefing, BriefingAction, BriefingItem } from "@/lib/briefing";
import type { GithubStatus } from "@/lib/github";
import type { WhopStatus } from "@/lib/whop";
import type { GithubStatusResponse } from "@/lib/contracts";
import type { BrandKey } from "../brand-logos";

export type { Briefing, BriefingAction, BriefingItem };

/** A fetch error that remembers the HTTP status (404 = route not deployed yet, 401 = needs the admin key). */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { accept: "application/json", ...init?.headers } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`.trim();
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* not json */
    }
    throw new HttpError(msg, res.status);
  }
  return (await res.json()) as T;
}

const OPTS = { revalidateOnFocus: true, keepPreviousData: true, shouldRetryOnError: false } as const;

/** GET /api/auth/session: is GitHub sign-in configured, and who is signed in (never tokens). */
export interface SessionInfo {
  providers: { github: boolean };
  github?: { login: string; name?: string; avatarUrl?: string };
}

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<SessionInfo>("/api/auth/session", getJson, OPTS);
  return { session: data, error: error as Error | undefined, loading: isLoading, mutate };
}

export function useWhop() {
  const { data, error, isLoading } = useSWR<WhopStatus>("/api/whop/status", getJson, { ...OPTS, refreshInterval: 30000 });
  return { whop: data, error: error as Error | undefined, loading: isLoading };
}

/** The rich shape /api/github/status really returns (the contract only promises configured + repo). */
export type GithubStatusFull = GithubStatusResponse & Partial<Omit<GithubStatus, "configured" | "repo">>;

/** This page's origin, for copy-paste snippets (a neutral placeholder during SSR). */
export function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "https://your-darwin.app",
  );
}
const noopSubscribe = () => () => {};

/* ------------------------------------------------------------------ Darwin's brain */

export interface Brain {
  /** Who does the thinking, in plain words. */
  name: string;
  /** The model id, when an LLM is on. */
  model?: string;
  glyph?: BrandKey;
  /** Secondary glyph (the model's own maker when routed through OpenRouter). */
  via?: BrandKey;
  llm: boolean;
  grok: boolean;
}

/** LoopState.designer ("llm:<model>" | "heuristic") → who powers Darwin's insights and fixes. */
export function brainOf(designer: string | undefined): Brain {
  const model = designer?.startsWith("llm:") ? designer.slice(4) : undefined;
  if (!model) return { name: "Built-in rules", llm: false, grok: false };
  const m = model.toLowerCase();
  if (m.includes("/")) {
    const maker: BrandKey | undefined = /grok|x-ai/.test(m)
      ? "grok"
      : /claude|anthropic/.test(m)
        ? "claude"
        : /deepseek/.test(m)
          ? "deepseek"
          : /gpt|openai/.test(m)
            ? "openai"
            : /gemini|google/.test(m)
              ? "gemini"
              : undefined;
    return { name: "OpenRouter", model, glyph: "openrouter", via: maker, llm: true, grok: maker === "grok" };
  }
  if (m.startsWith("grok")) return { name: "Grok, via xAI", model, glyph: "grok", llm: true, grok: true };
  if (m.startsWith("claude")) return { name: "Claude", model, glyph: "claude", llm: true, grok: false };
  if (/gpt|^o\d/.test(m)) return { name: "OpenAI", model, glyph: "openai", llm: true, grok: false };
  return { name: model, model, llm: true, grok: false };
}

/** The darwin.js tag for a connected site (same markup as lib/github's install PR writes). */
export function scriptTagFor(host: string, siteId: string): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const origin = (/^https?:\/\//i.test(host) ? host : `https://${host}`).replace(/\/+$/, "");
  return `<script src="${esc(`${origin}/darwin.js`)}" data-darwin-site="${esc(siteId)}" defer></script>`;
}
