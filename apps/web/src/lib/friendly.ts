/**
 * Plain-English copy for the UI. Merchants never see endpoints, HTTP verbs, JSON shapes, env var names
 * or model/provider names: server logs and API responses keep the detail, the UI maps it here.
 */

/** Things a merchant should never read in an error: routes, verbs, JSON/schema talk, env vars, stack-ish noise. */
const TECHNICAL = [
  /\b(GET|POST|PUT|PATCH|DELETE) \/|\bHTTP \d{3}\b|\bJSON\b|\b[A-Z][A-Z0-9]*_(API_)?(KEY|SECRET|TOKEN)\b|\b(TypeError|SyntaxError|ECONN\w+|ENOTFOUND)\b/,
  /\/api\/|→\s*\d{3}|\bbody must\b|\?\w+=|\bexpected\b.*\breceived\b|\bundefined\b|unexpected token|\bzod|invalid_type|✖|fetch failed|\bllm:|deepseek|openrouter|\bgrok\b|\bxai\b|\banthropic\b/i,
];

/** Fallback copy by HTTP status (keeps the meaning of the code without showing it). */
export function friendlyStatus(status: number): string {
  if (status === 401 || status === 403) return "You're signed out. Sign in and try again.";
  if (status === 404) return "We couldn't find that. It may have been removed, or the page is out of date. Refresh and try again.";
  if (status === 409) return "That changed while you were working on it. Refresh and try again.";
  if (status === 413) return "That's too big to send. Try something shorter.";
  if (status === 429) return "That's a lot of requests at once. Wait a minute and try again.";
  if (status === 503) return "That isn't switched on for this store yet.";
  if (status >= 500) return "Something went wrong on our side. Please try again in a moment.";
  return "Something didn't work. Please try again.";
}

/**
 * Turn any error (or error message) into something a merchant can read. Friendly server messages pass through;
 * anything technical becomes `fallback` (or a status-based message when one is known).
 */
export function friendlyError(err: unknown, fallback = "Something didn't work. Please try again."): string {
  const raw = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  const status = typeof err === "object" && err && "status" in err && typeof (err as { status: unknown }).status === "number" ? (err as { status: number }).status : undefined;
  const msg = raw.trim();
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return "Couldn't reach Darwin. Check your connection and try again.";
  if (!msg || msg.length > 240 || TECHNICAL.some((re) => re.test(msg))) return status ? friendlyStatus(status) : fallback;
  return msg;
}

/**
 * Who wrote something, without naming models or providers. `author`/`source` values look like
 * "llm:<model>", "llm", "heuristic", "playbook" or "sample".
 */
export function writtenBy(author: string | undefined): { ai: boolean; label: string } {
  const a = (author ?? "").toLowerCase();
  if (a === "sample") return { ai: false, label: "Sample" };
  if (!a || a.includes("heuristic") || a === "playbook" || a === "rules") return { ai: false, label: "Built-in rules" };
  return { ai: true, label: "Written by Darwin AI" };
}

/**
 * Status notes from integrations (GitHub, Whop) can name server settings: "Dry run (DARWIN_GITHUB_DRY_RUN=1)",
 * "no GITHUB_TOKEN". Keep the meaning, drop the setting names.
 */
export function plainNote(note: string): string {
  return note
    .replace(/GitHub unavailable \([^)]*\)/g, "GitHub couldn't be reached")
    .replace(/\bDry run\b/g, "Preview")
    .replace(/\b[A-Z][A-Z0-9]*_(?:API_)?(?:TOKEN|KEY|SECRET) is not set\b/g, "GitHub isn't connected")
    .replace(/\s*\((?:no )?[A-Z][A-Z0-9_]*(?:=[^)\s]*)?\)/g, "")
    .replace(/\bPR\b/g, "pull request");
}
