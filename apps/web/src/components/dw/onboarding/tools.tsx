"use client";

/**
 * Onboarding, "Your tools": how the merchant likes to work. No-code merchants are told no code is needed;
 * merchants with a coding agent get the one-step setup to let it run Darwin through the owner MCP server
 * (/api/darwin/mcp): Claude Code, Cursor (with a deeplink), Codex, or any MCP client. Never blocks the flow.
 */
import { useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Copy, ExternalLink, Plus } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Card, PillButton } from "@/components/dw/ui";
import { CheckPop, EASE } from "./bits";

export const TOOL_OPTIONS = [
  { id: "nocode", label: "I don't code" },
  { id: "admin", label: "I use Shopify / Webflow / WordPress admin" },
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "codex", label: "Codex" },
  { id: "other", label: "Other AI agent" },
] as const;

export type ToolId = (typeof TOOL_OPTIONS)[number]["id"];

const AGENT_TOOLS: readonly string[] = ["claude", "cursor", "codex", "other"];
export const DEFAULT_TOOLS: ToolId[] = ["nocode"];

const noop = () => () => {};

/** Picking a coding tool drops "I don't code", and the other way round; the admin chip goes with either. */
function flipTool(list: string[], id: string): string[] {
  if (list.includes(id)) return list.filter((x) => x !== id);
  if (id === "nocode") return [...list.filter((x) => !AGENT_TOOLS.includes(x)), id];
  if (AGENT_TOOLS.includes(id)) return [...list.filter((x) => x !== "nocode"), id];
  return [...list, id];
}

export function YourTools({ value, onChange, className }: { value: string[]; onChange: (tools: string[]) => void; className?: string }) {
  const origin = useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );
  const mcp = `${origin}/api/darwin/mcp`;
  const agents = value.filter((id) => AGENT_TOOLS.includes(id));

  return (
    <Card tone="white" hover={false} className={cn("p-5 max-sm:border-0 max-sm:bg-transparent! max-sm:px-0 sm:p-6", className)} aria-label="Your tools">
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">How do you like to work?</h2>
      <p className="mt-1 text-[13.5px] text-dw-ink/60">Pick any. Darwin fits in around it.</p>
      <div className="mt-3.5 flex flex-wrap gap-2" role="group" aria-label="How you like to work">
        {TOOL_OPTIONS.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(flipTool(value, o.id))}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-left text-[14px] font-medium transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none active:scale-[0.97]",
                on ? "bg-dw-ink text-white" : "border border-dw-hairline bg-white text-dw-ink/80 hover:border-dw-ink/25 hover:text-dw-ink max-sm:border-dw-ink/15",
              )}
            >
              {on ? (
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden className="shrink-0">
                  <path d="M3.6 8.4l2.9 2.9 5.9-6.4" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <Plus className="size-3.5 shrink-0 text-dw-ink/50" aria-hidden />
              )}
              {o.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {agents.length ? (
          <motion.div
            key="agents"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-5 rounded-[22px] bg-dw-blue/60 p-4 sm:p-5"
          >
            <h3 className="text-[17px] font-semibold tracking-[-0.01em]">Let your agent run Darwin</h3>
            <p className="mt-0.5 text-[13.5px] leading-snug text-dw-ink/65">
              One step: add Darwin&apos;s MCP server, then ask your agent things like &ldquo;what should I test next?&rdquo;
            </p>
            <div className="mt-3.5 flex flex-col gap-3">
              {agents.includes("claude") && <SetupBlock title="Claude Code" hint="Run in your terminal" code={`claude mcp add --transport http darwin ${mcp}`} />}
              {agents.includes("cursor") && (
                <SetupBlock
                  title="Cursor"
                  hint="Add to .cursor/mcp.json"
                  code={JSON.stringify({ mcpServers: { darwin: { url: mcp } } }, null, 2)}
                  extra={
                    origin ? (
                      <a
                        href={`cursor://anysphere.cursor-deeplink/mcp/install?name=darwin&config=${encodeURIComponent(btoa(JSON.stringify({ url: mcp })))}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-dw-ink px-3.5 text-[13px] font-medium text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:ring-offset-1 focus-visible:outline-none"
                      >
                        <ExternalLink className="size-3.5" /> Add to Cursor
                      </a>
                    ) : null
                  }
                />
              )}
              {agents.includes("codex") && <SetupBlock title="Codex" hint="Add to ~/.codex/config.toml" code={`[mcp_servers.darwin]\nurl = "${mcp}"`} />}
              {agents.includes("other") && <SetupBlock title="Any MCP client" hint="Add this MCP server (Streamable HTTP)" code={mcp} />}
            </div>
            <p className="mt-3 text-[12.5px] leading-snug text-dw-ink/55">If this Darwin has an admin key, your agent sends it as a Bearer token.</p>
          </motion.div>
        ) : (
          <motion.p
            key="nocode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-4 flex items-center gap-2 text-[14px] text-dw-ink/70"
          >
            <CheckPop size={18} tone="live" /> No code needed: paste one line, or connect Whop.
          </motion.p>
        )}
      </AnimatePresence>
    </Card>
  );
}

function SetupBlock({ title, hint, code, extra }: { title: string; hint: string; code: string; extra?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[14.5px] font-semibold">{title}</span>
        <span className="text-[12.5px] text-dw-ink/60">{hint}</span>
      </div>
      <div className="overflow-hidden rounded-[16px] bg-dw-ink">
        <pre className="px-3.5 py-3 font-dwmono text-[12.5px] leading-relaxed break-all whitespace-pre-wrap text-[#9EE6B8]">{code}</pre>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {extra}
        <PillButton
          tone="white"
          size="sm"
          aria-label={`Copy the ${title} setup`}
          onClick={() => {
            navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? <CheckPop size={16} tone="live" /> : <Copy />} {copied ? "Copied" : "Copy"}
        </PillButton>
      </div>
    </div>
  );
}
