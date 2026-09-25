/**
 * Human vs AI-agent classification.
 * TODO(analytics): extend with PostHog's bot list (posthog-js `blocked-uas`) and headless heuristics.
 */
import type { VisitorKind } from "@/lib/contracts";

const AGENT_UA = /(gptbot|chatgpt|oai-searchbot|claudebot|claude-user|anthropic|perplexity|grok|xai|bingbot|googlebot|google-extended|bytespider|ccbot|applebot|amazonbot|meta-externalagent|headlesschrome|playwright|puppeteer|python-requests|axios|node-fetch|curl|agent)/i;

export interface ClassifyInput {
  userAgent?: string | null;
  /** Value of an `x-agent-name` / `x-darwin-agent` header if present. */
  declaredAgent?: string | null;
}

export function classifyVisitor({ userAgent, declaredAgent }: ClassifyInput): { kind: VisitorKind; agentName?: string } {
  if (declaredAgent) return { kind: "agent", agentName: declaredAgent };
  if (userAgent && AGENT_UA.test(userAgent)) {
    const match = userAgent.match(AGENT_UA);
    return { kind: "agent", agentName: match?.[1] ?? "unknown-agent" };
  }
  return { kind: "human" };
}
