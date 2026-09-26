/**
 * Market & competitor research (Tavily web search + LLM summary). OWNED BY: research.
 * Every claim carries the URLs it came from; `demo` reports are canned samples, never real research.
 */

export type ResearchKind = "competitors" | "question";

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

/** A sentence plus the source URLs that back it. */
export interface ResearchClaim {
  text: string;
  sources: string[];
}

export interface ResearchCompetitor {
  name: string;
  url: string;
  /** e.g. "£95–£160". Undefined when no prices were found. */
  priceRange?: string;
  positioning?: string;
  shipping?: string;
  returns?: string;
  strengths: string[];
  weaknesses: string[];
  tactics: string[];
  /** Agent-readiness hints: llms.txt found, structured data, etc. */
  agentReadiness: { llmsTxt: boolean | null; notes: string[] };
  sources: string[];
}

export interface ResearchSuggestion {
  title: string;
  why: string;
  /** A plain-English A/B test brief, ready for /api/web/draft. */
  testIdea: string;
  audience: "humans" | "agents" | "both";
  sources: string[];
}

export interface ResearchStep {
  id: "search" | "read" | "summarise";
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  detail?: string;
}

export interface ResearchFollowUp {
  question: string;
  answer: string;
  sources: string[];
  at: string;
}

export interface ResearchReport {
  id: string;
  kind: ResearchKind;
  query: string;
  /** The merchant's store (description or URL) the research is about. */
  store: string;
  createdAt: string;
  /** "tavily" = real web research; "demo" = the labelled sample shown without TAVILY_API_KEY. */
  mode: "tavily" | "demo";
  demo: boolean;
  /** llmLabel() of the summariser, or "heuristic". */
  summarizer: string;
  /** Short headline answer (question mode) or overview (competitor mode). */
  summary: ResearchClaim;
  competitors: ResearchCompetitor[];
  trends: ResearchClaim[];
  suggestions: ResearchSuggestion[];
  sources: ResearchSource[];
  steps: ResearchStep[];
  followUps: ResearchFollowUp[];
  /** Shown above the report, e.g. "Add TAVILY_API_KEY to run real research". */
  notice?: string;
}

export interface ResearchListItem {
  id: string;
  kind: ResearchKind;
  query: string;
  createdAt: string;
  demo: boolean;
  competitors: number;
}

export interface ResearchStatus {
  tavily: boolean;
  llm: string;
}

/** Streamed lines from POST /api/research with `Accept: application/x-ndjson`. */
export type ResearchStreamEvent =
  | { type: "step"; step: ResearchStep }
  | { type: "report"; report: ResearchReport }
  | { type: "error"; error: string };
