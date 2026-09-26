/**
 * Minimal robots.txt evaluation (RFC 9309): groups by user-agent, longest matching rule wins,
 * Allow wins ties, `*` and `$` wildcards. Enough to answer "may this AI agent fetch this path?".
 */

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export function parseRobots(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      // An empty Disallow means "allow everything".
      if (key === "disallow" && !value) continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** The group that applies to `agent` (a product token like "GPTBot"): its own group, else `*`. */
function groupFor(groups: Group[], agent: string): Group[] {
  const token = agent.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  if (own.length) return own;
  return groups.filter((g) => g.agents.includes("*"));
}

export function isAllowed(robots: ReturnType<typeof parseRobots>, agent: string, path: string): boolean {
  const rules = groupFor(robots.groups, agent).flatMap((g) => g.rules);
  let best: Rule | undefined;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(path)) continue;
    const len = rule.pattern.replace(/\$$/, "").length;
    const bestLen = best ? best.pattern.replace(/\$$/, "").length : -1;
    if (len > bestLen || (len === bestLen && rule.allow && !best!.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** Agents that fetch pages live, on behalf of a shopper (search, browse, buy). Blocking them hides the store. */
export const ASSISTANT_AGENTS = [
  { token: "OAI-SearchBot", name: "ChatGPT search" },
  { token: "ChatGPT-User", name: "ChatGPT (browsing for a user)" },
  { token: "Claude-SearchBot", name: "Claude search" },
  { token: "Claude-User", name: "Claude (browsing for a user)" },
  { token: "PerplexityBot", name: "Perplexity" },
  { token: "Perplexity-User", name: "Perplexity (browsing for a user)" },
  { token: "Googlebot", name: "Google (incl. AI Overviews and Gemini shopping)" },
  { token: "Applebot", name: "Apple (Siri, Spotlight)" },
] as const;

/** Model-training crawlers: blocking these is a legitimate business choice, so it isn't scored. */
export const TRAINING_AGENTS = ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "meta-externalagent", "Bytespider"] as const;
