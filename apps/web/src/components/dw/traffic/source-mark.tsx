/**
 * A small squircle mark for a traffic source ("ChatGPT", "Google", "klaviyo / email", "AI assistants" …).
 * AI assistants get their official glyph (AgentTile); the "AI assistants" channel gets a cluster of
 * them; agents calling the store API get an ink tile; everything else a neutral icon.
 */
import type { ReactNode } from "react";
import { Bot, Globe, Link2, Mail, Megaphone, MousePointerClick, Search, Users, Video } from "lucide-react";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { BrandGlyph, type BrandKey } from "@/components/dw/brand-logos";

/** AI assistants by name. Deliberately not "google" or "bing": those are search engines here. */
const AI = /chatgpt|openai|perplexity|claude|anthropic|gemini|grok|copilot/i;

export const isAiAssistant = (label: string) => AI.test(label);

function Squircle({ size, ink, children, label }: { size: number; ink?: boolean; children: ReactNode; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={ink ? "inline-grid shrink-0 place-items-center text-white" : "inline-grid shrink-0 place-items-center text-dw-ink/75"}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: ink ? "linear-gradient(150deg, #2a2a28, #141413)" : "linear-gradient(150deg, rgba(255,255,255,0.92), rgba(255,255,255,0.55))",
        boxShadow: ink
          ? "inset 0 1px 0 rgba(255,255,255,0.14), 0 2px 6px rgba(20,20,19,0.18)"
          : "inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px rgba(20,20,19,0.07), 0 2px 5px rgba(20,20,19,0.06)",
      }}
    >
      {children}
    </span>
  );
}

const CLUSTER: BrandKey[] = ["openai", "claude", "perplexity", "gemini"];

export function SourceMark({ label, agents, size = 24 }: { label: string; agents?: boolean; size?: number }) {
  const l = label.toLowerCase();
  const icon = { width: Math.round(size * 0.5), height: Math.round(size * 0.5) };
  if (/^ai assistants/.test(l)) {
    const g = Math.max(7, Math.round(size * 0.34));
    return (
      <Squircle size={size} label="AI assistants: ChatGPT, Claude, Perplexity, Gemini">
        <span className="grid grid-cols-2 gap-[1px] text-dw-ink">
          {CLUSTER.map((b) => (
            <BrandGlyph key={b} brand={b} size={g} />
          ))}
        </span>
      </Squircle>
    );
  }
  if (AI.test(l)) return <AgentTile brand={agentBrand(label)} size={size} />;
  if (agents || /agent api|mcp|a2a/.test(l))
    return (
      <Squircle size={size} ink label="AI agents over the store API">
        <Bot style={icon} aria-hidden />
      </Squircle>
    );
  const Icon = /paid|\bad\b|cpc|\bads\b/.test(l)
    ? Megaphone
    : /search|google|bing|duckduckgo|ecosia|yahoo/.test(l)
      ? Search
      : /youtube|video/.test(l)
        ? Video
        : /social|instagram|tiktok|twitter|\bx\b|reddit|pinterest|facebook|threads|linkedin/.test(l)
          ? Users
          : /mail|klaviyo|newsletter|mailchimp/.test(l)
            ? Mail
            : /direct/.test(l)
              ? MousePointerClick
              : /other websites|referral|\.[a-z]{2,}/.test(l)
                ? Link2
                : Globe;
  return (
    <Squircle size={size} label={label}>
      <Icon style={icon} aria-hidden />
    </Squircle>
  );
}
