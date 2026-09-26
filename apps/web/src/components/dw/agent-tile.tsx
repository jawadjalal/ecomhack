/**
 * Agent tiles: a glass squircle with a two-letter monogram (Pe, Ch, Cl, Ge, Gr). The design uses
 * monograms as placeholders for each company's official logo.
 */
import { User } from "lucide-react";
import { cn } from "@/components/ui/cn";
import type { MascotKind } from "./mascot";

export interface AgentBrand {
  key: "perplexity" | "chatgpt" | "claude" | "gemini" | "grok" | "copilot" | "people" | "other";
  name: string;
  mono: string;
  /** Tint behind the monogram. */
  tint: string;
  /** The crew member that stands in for this shopper. */
  mascot: MascotKind;
}

const BRANDS: AgentBrand[] = [
  { key: "perplexity", name: "Perplexity", mono: "Pe", tint: "#DDF3EE", mascot: "shipper" },
  { key: "chatgpt", name: "ChatGPT", mono: "Ch", tint: "#E6F4EC", mascot: "shipper" },
  { key: "claude", name: "Claude", mono: "Cl", tint: "#FBE6DA", mascot: "designer" },
  { key: "gemini", name: "Gemini", mono: "Ge", tint: "#E3EBFB", mascot: "observer" },
  { key: "grok", name: "Grok", mono: "Gr", tint: "#ECEAE4", mascot: "designer" },
  { key: "copilot", name: "Copilot", mono: "Co", tint: "#E3EEFB", mascot: "observer" },
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

/** Glass squircle monogram tile. */
export function AgentTile({ brand, size = 24, className }: { brand: AgentBrand; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center font-semibold text-dw-ink", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        fontSize: Math.max(9, Math.round(size * 0.42)),
        background: `linear-gradient(150deg, rgba(255,255,255,0.95), ${brand.tint})`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px rgba(20,20,19,0.08), 0 2px 6px rgba(20,20,19,0.08)",
      }}
      aria-label={brand.name}
      title={brand.name}
    >
      {brand.key === "people" ? <User style={{ width: size * 0.5, height: size * 0.5 }} /> : brand.mono}
    </span>
  );
}
