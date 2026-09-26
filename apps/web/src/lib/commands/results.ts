/**
 * Plain-words results for the setup commands (check_install, detect_platform, research_competitors, which_store),
 * shared by the browser runners (./run.ts) and the headless ones (./server-run.ts). Pure: no I/O, no invented
 * numbers: every sentence is built from what the API answered.
 */
import type { CommandSites } from "./types";

const plural = (v: number, one: string, many = `${one}s`) => `${v.toLocaleString("en-GB")} ${v === 1 ? one : many}`;

export interface VerifyLite {
  verified: boolean;
  via?: "events" | "tag";
  host: string;
  checkedAt: string;
  detail: string;
}
export interface InspectLite {
  host: string;
  reachable: boolean;
  platform: string;
  signals: string[];
  title?: string;
}
export interface ResearchLite {
  id: string;
  demo: boolean;
  notice?: string;
  summary: { text: string };
  competitors: { name: string; priceRange?: string }[];
  suggestions: unknown[];
  sources: unknown[];
}

/** waiting: nothing seen yet. installed: the tag is on the homepage. verified: real events arrived from the store. */
export type InstallState = "waiting" | "installed" | "verified";

export function installState(v: VerifyLite): InstallState {
  if (!v.verified) return "waiting";
  return v.via === "events" ? "verified" : "installed";
}

export function installText(state: InstallState, v: VerifyLite): string {
  const lead =
    state === "verified"
      ? `Verified: Darwin is receiving real events from ${v.host}.`
      : state === "installed"
        ? `Installed: the darwin.js tag is on ${v.host}'s homepage.`
        : `Waiting: Darwin hasn't seen darwin.js on ${v.host} yet.`;
  const detail = v.detail?.trim();
  return detail ? `${lead} ${detail}` : lead;
}

const PLATFORM_NAMES: Record<string, string> = {
  shopify: "Shopify",
  webflow: "Webflow",
  wordpress: "WordPress",
  squarespace: "Squarespace",
  wix: "Wix",
  bigcommerce: "BigCommerce",
};

export function platformText(r: InspectLite): string {
  if (!r.reachable) return `Darwin couldn't reach ${r.host}, so it can't tell what it runs on. Check the address and try again.`;
  const why = r.signals.length ? ` (seen: ${r.signals.slice(0, 4).join(", ")})` : "";
  const name = PLATFORM_NAMES[r.platform];
  if (name) return `${r.host} runs on ${name}${why}.`;
  if (r.platform === "custom") return `${r.host} looks custom-built: no known store platform${why}. darwin.js goes in the page's <head>.`;
  return `Darwin couldn't tell what ${r.host} runs on${why}.`;
}

export function researchText(r: ResearchLite): string {
  const names = r.competitors.map((c) => `${c.name}${c.priceRange ? ` (${c.priceRange})` : ""}`);
  const who = names.length ? ` Competitors: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}.` : " No competitors found.";
  const sample = r.demo ? ` This is a labelled sample, not live research${r.notice ? `: ${r.notice}` : ""}.` : ` ${plural(r.sources.length, "source")}.`;
  return `${r.summary.text}${who}${sample}`;
}

export interface WhichStore {
  demo: boolean;
  repo?: string;
  sites: string[];
  email?: string;
  text: string;
}

/** Demo store vs the merchant's own: a connected GitHub repo, darwin.js sites with a tracking plan, a saved account. */
export function describeStore(gh: { repo?: string; connection?: { repo?: string } } | undefined, account: { email?: string; sites?: string[] } | undefined, known: CommandSites): WhichStore {
  const repo = gh?.connection?.repo;
  const sites = [...new Set([...(known.tracking ?? []), ...(account?.sites ?? [])])];
  const email = account?.email;
  const saved = email ? ` Your setup is saved under ${email}.` : "";
  if (!repo && !sites.length) {
    return {
      demo: true,
      sites,
      email,
      text: `You're looking at the demo store (/store, PACE running shoes): its shoppers are simulated and labelled. No repo or darwin.js site is connected yet.${saved}`,
    };
  }
  const parts = [repo ? `the GitHub repo ${repo}` : "", sites.length ? `${sites.length === 1 ? "the site" : "the sites"} ${sites.join(", ")}` : ""].filter(Boolean);
  return { demo: false, repo, sites, email, text: `Darwin is connected to ${parts.join(" and ")}. The Overview's loop still runs on the demo store (/store); dashboards and personalization use your site.${saved}` };
}
