/**
 * Agent tiles: a glass squircle holding the AI assistant's official glyph (OpenAI, Claude, Gemini,
 * Perplexity, Grok, Copilot) — black on glass, or white on ink with `invert`. Unknown agents fall back
 * to a two-letter monogram.
 */
import { User } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { BrandGlyph, type BrandKey } from "./brand-logos";
import type { MascotKind } from "./mascot";

export interface AgentBrand {
  key: "perplexity" | "chatgpt" | "claude" | "gemini" | "grok" | "copilot" | "people" | "other";
  name: string;
  mono: string;
  /** Tint behind the monogram. */
  tint: string;
  /** The crew member that stands in for this shopper. */
  mascot: MascotKind;
  /** Official glyph, when we have it. */
  glyph?: BrandKey;
}

const BRANDS: AgentBrand[] = [
  { key: "perplexity", name: "Perplexity", mono: "Pe", tint: "#DDF3EE", mascot: "shipper", glyph: "perplexity" },
  { key: "chatgpt", name: "ChatGPT", mono: "Ch", tint: "#E6F4EC", mascot: "shipper", glyph: "openai" },
  { key: "claude", name: "Claude", mono: "Cl", tint: "#FBE6DA", mascot: "designer", glyph: "claude" },
  { key: "gemini", name: "Gemini", mono: "Ge", tint: "#E3EBFB", mascot: "observer", glyph: "gemini" },
  { key: "grok", name: "Grok", mono: "Gr", tint: "#ECEAE4", mascot: "designer", glyph: "grok" },
  { key: "copilot", name: "Copilot", mono: "Co", tint: "#E3EEFB", mascot: "observer", glyph: "copilot" },
];

/** "gemini-shopper", "Google-Extended", "GPTBot", "claude-web" … → brand. */
export function agentBrand(name: string | undefined, kind: "agent" | "human" = "agent"): AgentBrand {
  if (kind === "human") return { key: "people", name: "People", mono: "", tint: "#FFFFFF", mascot: "experimenter" };
  const n = (name ?? "").toLowerCase();
  if (/perplex/.test(n)) return BRANDS[0];
  if (/chatgpt|openai|gpt|oai-/.test(n)) return BRANDS[1];
  if (/claude|anthropic/.test(n)) return BRANDS[2];
  if (/gemini|google|bard/.test(n)) return BRANDS[3];
  if (/grok|xai/.test(n)) return BRANDS[4];
  if (/copilot|bing|microsoft/.test(n)) return BRANDS[5];
  const label = (name ?? "Agent").replace(/[^a-z0-9]/gi, "");
  return { key: "other", name: name ?? "Agent", mono: (label.slice(0, 1).toUpperCase() + label.slice(1, 2).toLowerCase()) || "Ag", tint: "#EFE9DD", mascot: "observer" };
}

/** Glass squircle with the assistant's glyph (black), or ink squircle with a white glyph (`invert`). */
export function AgentTile({ brand, size = 24, invert, className }: { brand: AgentBrand; size?: number; invert?: boolean; className?: string }) {
  const icon = Math.round(size * 0.56);
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center font-semibold", invert ? "text-white" : "text-dw-ink", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        fontSize: Math.max(9, Math.round(size * 0.42)),
        background: invert ? "linear-gradient(150deg, #2a2a28, #141413)" : `linear-gradient(150deg, rgba(255,255,255,0.95), ${brand.tint})`,
        boxShadow: invert
          ? "inset 0 1px 0 rgba(255,255,255,0.14), 0 2px 6px rgba(20,20,19,0.18)"
          : "inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px rgba(20,20,19,0.08), 0 2px 6px rgba(20,20,19,0.08)",
      }}
      role="img"
      aria-label={brand.name}
      title={brand.name}
    >
      {brand.key === "people" ? (
        <User style={{ width: size * 0.5, height: size * 0.5 }} />
      ) : brand.glyph ? (
        <BrandGlyph brand={brand.glyph} size={icon} />
      ) : (
        brand.mono
      )}
    </span>
  );
}
