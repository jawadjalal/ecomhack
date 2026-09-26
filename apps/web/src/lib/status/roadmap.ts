/**
 * The product roadmap as data: every area of Darwin with its status, what's left, its limitations and
 * next-run ideas. Mirrors docs/STATUS.md (the source of truth humans edit) so the app can answer
 * "what's left on this page?" (the `whats_left` command in lib/commands, ⌘K, WebMCP).
 *
 * Keep it in sync with docs/STATUS.md when that file changes. Pure data + lookups: safe on server and client.
 */

export type RoadmapStatus = "done" | "in-progress" | "not-started";

export interface RoadmapArea {
  /** Stable key, also the `area` input of the whats_left command. */
  key: string;
  name: string;
  /** Main route, e.g. "/console/issues". */
  route: string;
  /** Extra path prefixes that belong to this area (matched after `route`). */
  alsoAt?: string[];
  status: RoadmapStatus;
  /** Work happening right now, e.g. "above-the-fold pass". */
  inProgress?: string;
  /** What already works, one line. */
  done: string;
  leftToDo: string[];
  limitations: string[];
  nextIdeas: string[];
}

/** When docs/STATUS.md was last updated (copied from its header). */
export const ROADMAP_UPDATED = "2026-09-26 13:40 UTC";

export const ROADMAP: RoadmapArea[] = [
  {
    key: "landing",
    name: "Landing",
    route: "/",
    status: "done",
    done: "One screen, “Your store, improving itself.”, a live mini dashboard driven by the in-browser demo engine, real AI-assistant logos.",
    leftToDo: ["Official Whop logo in public/brand/whop.svg", "OG image and meta tags for link previews", "A/B test the landing headline with Darwin itself"],
    limitations: ["The mini dashboard is simulated by design: there's no real store behind the landing."],
    nextIdeas: ["“Watch Darwin fix a store in 30 s” autoplay mode", "A readiness score input right on the landing"],
  },
  {
    key: "onboarding",
    name: "Onboarding",
    route: "/onboarding",
    status: "done",
    done: "Connect GitHub or Whop, Darwin asks what to track, repo dropdown, script-tag path without GitHub, plan → install → live dashboards; progress survives a reload.",
    leftToDo: [
      "Set GITHUB_OAUTH_CLIENT_ID / SECRET on Vercel (the repo dropdown needs sign-in)",
      "Detect the first real event after install and celebrate it",
      "Branch picker for the install pull request",
      "Shopify connect",
    ],
    limitations: ["Plans live in server memory.", "The install PR is a preview while the server's GITHUB_TOKEN is rejected."],
    nextIdeas: ["Whop OAuth sign-in", "Auto-detect the store's platform from its URL"],
  },
  {
    key: "overview",
    name: "Overview",
    route: "/console",
    status: "in-progress",
    inProgress: "above-the-fold pass",
    done: "Impact strip (before Darwin vs now), conversion, A vs B, which agents buy, live shoppers joined to their journey, the Ask Darwin chat.",
    leftToDo: ["Both card rows above the fold at 1440×900", "Make the chat the lead agent on every screen, able to navigate and run any action"],
    limitations: ["People rows need store traffic on (the events route has no store-only filter).", "With ?mock=1 the chat still answers from the server."],
    nextIdeas: ["A daily “what changed” digest card", "Pin a shopper journey to an issue"],
  },
  {
    key: "issues",
    name: "Issues",
    route: "/console/issues",
    status: "in-progress",
    inProgress: "above-the-fold pass",
    done: "Issues ranked by buyers lost per 1,000 visits, who and where, real sessions that hit each one, the fix, deep links.",
    leftToDo: ["Shorter summary cards so the detail sits above the fold", "Humanise raw CSS selectors in rage-click issue titles"],
    limitations: [],
    nextIdeas: ["A “Fix this now” button that drafts a fix for the selected issue"],
  },
  {
    key: "fixes",
    name: "Fixes",
    route: "/console/fixes",
    status: "in-progress",
    inProgress: "above-the-fold pass",
    done: "Every fix with its status, the A→B settings in plain words, an honest “written by” chip, results.",
    leftToDo: ["Above-the-fold pass", "Edit a drafted fix before it's tested"],
    limitations: ["The 97.5% ship bar is mirrored in the browser, not read from the optimizer."],
    nextIdeas: [],
  },
  {
    key: "experiments",
    name: "Experiments",
    route: "/console/experiments",
    status: "in-progress",
    inProgress: "result strip above the fold",
    done: "A vs B storefronts rendered from the spec, the chance-B-wins curve, who buys, what B changes, every test so far.",
    leftToDo: ["Verdict strip above the fold", "An API to stop or ship early (POST /api/loop/decide) so “Stop test” and “Ship B now” can be real buttons"],
    limitations: [],
    nextIdeas: [],
  },
  {
    key: "changes",
    name: "Changes",
    route: "/console/changes",
    alsoAt: ["/console/pulls"],
    status: "done",
    done: "Every shipped change, overall uplift, proof, “Live on your store” (plus the PR when GitHub is involved), and Roll back.",
    leftToDo: ["Decide whether a rollback returns to idle or observe (today: watch the restored store first)", "Test the revert PR against a real repo"],
    limitations: ["Every PR is a dry-run preview until a valid GITHUB_TOKEN is set."],
    nextIdeas: [],
  },
  {
    key: "settings",
    name: "Settings",
    route: "/console/settings",
    status: "done",
    done: "Autopilot, simulated shoppers, connections, Darwin's brain (model), who Darwin tests for, the Grok teammate briefing with ship / stop, start over, demo mode.",
    leftToDo: ["Real notification channels (email, Slack) instead of the Grok bot only", "“Who to test for” is read-only"],
    limitations: [],
    nextIdeas: [],
  },
  {
    key: "agents",
    name: "Store agent",
    route: "/console/agents",
    status: "in-progress",
    inProgress: "chat above the fold",
    done: "The Whop store's own AI agent: buyer agents buy over chat (A2A), tools (MCP) and checkout sessions (ACP) in one funnel, with A/B tests on the agent's pitch and autopilot.",
    leftToDo: [
      "Chat and sales above the fold",
      "Run one real purchase on Vercel with WHOP_API_KEY, WHOP_COMPANY_ID and the webhook",
      "ACP terms and policy links once Whop's terms URL is confirmed",
    ],
    limitations: ["ACP sessions don't join the pitch A/B tests.", "Lever copy and the 97% bar are mirrored in the browser."],
    nextIdeas: [],
  },
  {
    key: "dashboards",
    name: "Dashboards",
    route: "/console/dashboards",
    status: "in-progress",
    inProgress: "above-the-fold pass",
    done: "Dashboards built from the tracking plan, “Ask for a chart” in plain English, ink-only charts.",
    leftToDo: ["KPIs and the funnel directly under the header"],
    limitations: ["The plan and events live in server memory."],
    nextIdeas: [],
  },
  {
    key: "personalize",
    name: "Personalize",
    route: "/console/personalize",
    status: "in-progress",
    inProgress: "live tests above the fold",
    done: "Per-source and per-search page changes on any store with darwin.js, A/B tested, heatmap, autopilot. Never publishes invented claims: ideas that need a merchant fact become [Your …] drafts.",
    leftToDo: ["Live-tests strip above the fold", "A clear “fill in the blanks” flow for [Your …] placeholders"],
    limitations: ["Rules a merchant started by hand aren't auto-retracted."],
    nextIdeas: [],
  },
  {
    key: "traffic",
    name: "Traffic",
    route: "/console/traffic",
    status: "done",
    done: "Where visitors come from (humans and AI agents), with insights.",
    leftToDo: ["Above-the-fold pass", "The page polls every 4 s but /api/traffic can take ~5 s: add an in-flight guard"],
    limitations: [],
    nextIdeas: [],
  },
  {
    key: "store",
    name: "Demo storefront",
    route: "/store",
    status: "done",
    done: "Editorial Whop-catalog store with working search, account page, newsletter sign-up, the WELCOME10 code, mobile.",
    leftToDo: [
      "“Already have an account? Sign in” is still a dead span",
      "The PACE demo components hard-code “4.8/5 from 12,400+ runners”: use real per-product ratings",
    ],
    limitations: [],
    nextIdeas: [],
  },
  {
    key: "briefing",
    name: "Grok teammate (briefing)",
    route: "/api/briefing",
    status: "done",
    done: "GET /api/briefing, POST /api/briefing/act, docs/GROK_BOT.md, xAI → OpenRouter fallback.",
    leftToDo: ["Set XAI_API_KEY on Vercel and run the real bot", "A running loop test can't be shipped from chat (needs POST /api/loop/decide)"],
    limitations: [],
    nextIdeas: [],
  },
  {
    key: "lead-agent",
    name: "Lead agent: ⌘K, chat, WebMCP",
    route: "/console",
    status: "in-progress",
    inProgress: "one command layer for ⌘K, the chat and WebMCP",
    done: "One typed command layer (lib/commands) used by ⌘K and WebMCP (navigator.modelContext); window.darwin.run(name, input) for automation.",
    leftToDo: ["Every new user-facing action must be added as a command"],
    limitations: ["WebMCP is a proposal: tools register only in browsers that expose navigator.modelContext."],
    nextIdeas: [],
  },
  {
    key: "readiness",
    name: "Agent readiness",
    route: "/readiness",
    status: "not-started",
    inProgress: "restyle",
    done: "Audit any store URL for AI shoppers.",
    leftToDo: ["Still the old dark design: restyle it to cream"],
    limitations: [],
    nextIdeas: [],
  },
  {
    key: "classic",
    name: "Classic mission control",
    route: "/console/classic",
    status: "done",
    done: "Kept as the original loop view and the offline fallback (?mock=1).",
    leftToDo: [],
    limitations: [],
    nextIdeas: [],
  },
];

/** Fix before real merchants (docs/STATUS.md → Platform limitations). */
export const PLATFORM_LIMITATIONS: string[] = [
  "State lives in memory and .data/: on Vercel each instance has its own state, so demo from one process or move to Supabase.",
  "The admin gate is open by default: set DARWIN_ADMIN_TOKEN on any public deploy.",
  "The GitHub token in the environment is rejected (401): set a valid GITHUB_TOKEN or configure OAuth.",
  "The Whop logo is a placeholder.",
  "No outbound network in the build sandbox: Whop, xAI and GitHub calls are tested with mocks only.",
];

export const ROADMAP_KEYS = ROADMAP.map((a) => a.key) as [string, ...string[]];

export function roadmapArea(key: string): RoadmapArea | undefined {
  return ROADMAP.find((a) => a.key === key);
}

/** The area a path belongs to: the longest matching route wins ("/console/issues?id=…" → Issues). */
export function roadmapFor(pathname: string): RoadmapArea | undefined {
  const path = (pathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  let best: { area: RoadmapArea; len: number } | undefined;
  for (const area of ROADMAP) {
    if (area.key === "lead-agent") continue; // shares /console with Overview; ask for it by key.
    for (const r of [area.route, ...(area.alsoAt ?? [])]) {
      const hit = r === "/" ? path === "/" : path === r || path.startsWith(`${r}/`);
      if (hit && (!best || r.length > best.len)) best = { area, len: r.length };
    }
  }
  return best?.area;
}

/** Find an area from loose words: "dashboards", "the store agent", "personalisation". */
export function roadmapSearch(words: string): RoadmapArea | undefined {
  const w = words.toLowerCase().replace(/personalis/g, "personaliz");
  const exact = ROADMAP.find((a) => w.includes(a.key) || w.includes(a.name.toLowerCase()));
  if (exact) return exact;
  const aliases: [RegExp, string][] = [
    [/\bchat|⌘k|cmd.?k|command bar|webmcp|lead agent\b/, "lead-agent"],
    [/\bpull requests?|prs?\b|roll ?back/, "changes"],
    [/\bstore agent|a2a|agent commerce\b/, "agents"],
    [/\bshop|storefront\b/, "store"],
    [/\bgrok|brief/, "briefing"],
    [/\bhome|front page\b/, "overview"],
    [/\btests?\b|a\/b/, "experiments"],
  ];
  const hit = aliases.find(([re]) => re.test(w));
  return hit ? roadmapArea(hit[1]) : undefined;
}

const STATUS_WORDS: Record<RoadmapStatus, string> = { done: "done", "in-progress": "in progress", "not-started": "not started" };

/** "Left on Dashboards (in progress: above-the-fold pass): KPIs and the funnel directly under the header." */
export function whatsLeftText(area: RoadmapArea): string {
  const state = area.inProgress ? `${STATUS_WORDS[area.status]}: ${area.inProgress}` : STATUS_WORDS[area.status];
  const left = area.leftToDo.length ? area.leftToDo.join("; ") : "nothing on the list";
  const limits = area.limitations.length ? ` Limitations: ${area.limitations.join(" ")}` : "";
  return `Left on ${area.name} (${state}): ${left}.${limits}`;
}
