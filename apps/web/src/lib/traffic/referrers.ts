/**
 * Friendly names for referring sites ("t.co" → "X (Twitter)"). Hand-written for the sites a
 * storefront actually sees; anything else shows its bare hostname. Source *classification*
 * (ai / search / social / …) stays in lib/web/segment.ts so the two never disagree.
 */

const NAMES: [RegExp, string][] = [
  // AI assistants
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, "Claude"],
  [/(^|\.)gemini\.google\.com$|(^|\.)bard\.google\.com$/, "Gemini"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
  [/(^|\.)grok\.com$/, "Grok"],
  [/(^|\.)meta\.ai$/, "Meta AI"],
  [/(^|\.)you\.com$/, "You.com"],
  [/(^|\.)phind\.com$/, "Phind"],
  // Search
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\.[a-z.]+$/, "Yahoo"],
  [/(^|\.)ecosia\.org$/, "Ecosia"],
  [/(^|\.)search\.brave\.com$/, "Brave Search"],
  [/(^|\.)baidu\.com$/, "Baidu"],
  [/(^|\.)yandex\.[a-z.]+$/, "Yandex"],
  // Social & video
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "X (Twitter)"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.com$|^fb\.me$/, "Facebook"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, "Pinterest"],
  [/(^|\.)threads\.net$/, "Threads"],
  [/(^|\.)snapchat\.com$/, "Snapchat"],
  [/(^|\.)strava\.com$/, "Strava"],
  // Email
  [/(^|\.)mail\.google\.com$/, "Gmail"],
  [/(^|\.)outlook\.(live|office)\.com$/, "Outlook"],
];

/** utm_source values people actually use → the same names as the referrer. */
const UTM_NAMES: Record<string, string> = {
  twitter: "X (Twitter)",
  x: "X (Twitter)",
  youtube: "YouTube",
  yt: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  ig: "Instagram",
  facebook: "Facebook",
  fb: "Facebook",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  google: "Google",
  bing: "Bing",
  newsletter: "Newsletter",
  klaviyo: "Klaviyo",
  mailchimp: "Mailchimp",
  "chatgpt.com": "ChatGPT",
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
};

export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** "l.instagram.com" → "Instagram"; unknown hosts come back as themselves. */
export function referrerName(host: string): string {
  const h = host.replace(/^(www|m|l|lm|out)\./, "");
  return NAMES.find(([re]) => re.test(h))?.[1] ?? h;
}

/** Name for a utm_source value (case-insensitive), or the value itself. */
export function utmSourceName(v: string): string {
  const k = v.trim().toLowerCase();
  return UTM_NAMES[k] ?? (k.includes(".") ? referrerName(k) : v.trim());
}
