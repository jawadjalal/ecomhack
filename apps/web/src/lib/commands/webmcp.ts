/**
 * WebMCP: the same commands as tools for an AI agent running in the merchant's browser, with no CLI and
 * no MCP server. Uses the proposed W3C API (webmachinelearning/webmcp) when the browser has it:
 *
 *   navigator.modelContext.registerTool({ name, description, inputSchema, execute })   // per tool, or
 *   navigator.modelContext.provideContext({ tools: [...] })                             // all at once
 *
 * Both shapes are feature-detected. `execute` returns { content: [{ type: "text", text }] }.
 * Confirm-risk tools still ask the human in the page (the caller's `exec` opens ⌘K with the prompt).
 */
import { COMMAND_NAMES, inputJsonSchema, specOf } from "./specs";
import type { CommandName, CommandResult } from "./types";

export interface WebMcpContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** The agent handle some implementations pass to execute() (optional in the proposal). */
interface WebMcpAgent {
  requestUserInteraction?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; title?: string };
  execute(input: Record<string, unknown>, agent?: WebMcpAgent): Promise<WebMcpContent>;
}

interface ModelContext {
  registerTool?(tool: WebMcpTool): { unregister?(): void } | void;
  unregisterTool?(name: string): void;
  provideContext?(ctx: { tools: WebMcpTool[] }): void;
  clearContext?(): void;
}

export type WebMcpExec = (name: CommandName, input: Record<string, unknown>, opts: { interact?: <T>(fn: () => Promise<T>) => Promise<T> }) => Promise<CommandResult>;

export function modelContext(): ModelContext | undefined {
  if (typeof navigator === "undefined") return undefined;
  const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  return mc && typeof mc === "object" ? mc : undefined;
}

export function hasWebMcp(): boolean {
  const mc = modelContext();
  return !!mc && (typeof mc.registerTool === "function" || typeof mc.provideContext === "function");
}

function toContent(r: CommandResult): WebMcpContent {
  const link = r.href ? `\n${r.linkLabel ?? "Link"}: ${r.href}` : "";
  const sim = r.synthetic ? "\n(Numbers include simulated traffic.)" : "";
  return { content: [{ type: "text", text: `${r.text}${sim}${link}` }], ...(r.ok ? {} : { isError: true }) };
}

/** Every command as a WebMCP tool. */
export function webMcpTools(exec: WebMcpExec): WebMcpTool[] {
  return COMMAND_NAMES.map((name) => {
    const s = specOf(name);
    const confirmNote = s.risk === "confirm" ? " The merchant is asked to confirm in the page before it runs." : "";
    return {
      name: `darwin_${name}`,
      description: `${s.description}${confirmNote}`,
      inputSchema: inputJsonSchema(name),
      annotations: { title: s.title, ...(s.readOnly ? { readOnlyHint: true } : {}) },
      async execute(input, agent) {
        const interact = typeof agent?.requestUserInteraction === "function" ? agent.requestUserInteraction.bind(agent) : undefined;
        try {
          return toContent(await exec(name, input ?? {}, { interact }));
        } catch (err) {
          return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
        }
      },
    };
  });
}

/**
 * Register the tools when the browser supports WebMCP. Returns a cleanup function, and whether anything
 * was registered. Safe to call where it isn't supported (no-op).
 */
export function registerWebMcp(exec: WebMcpExec): { registered: boolean; cleanup: () => void } {
  const mc = modelContext();
  if (!mc) return { registered: false, cleanup: () => {} };
  const tools = webMcpTools(exec);
  try {
    if (typeof mc.registerTool === "function") {
      const handles = tools.map((t) => mc.registerTool!(t));
      return {
        registered: true,
        cleanup: () =>
          handles.forEach((h, i) => {
            try {
              if (h && typeof h.unregister === "function") h.unregister();
              else mc.unregisterTool?.(tools[i].name);
            } catch {
              /* already gone */
            }
          }),
      };
    }
    if (typeof mc.provideContext === "function") {
      mc.provideContext({ tools });
      return {
        registered: true,
        cleanup: () => {
          try {
            if (typeof mc.clearContext === "function") mc.clearContext();
            else mc.provideContext!({ tools: [] });
          } catch {
            /* already gone */
          }
        },
      };
    }
  } catch (err) {
    console.warn("[darwin] WebMCP registration failed:", err);
  }
  return { registered: false, cleanup: () => {} };
}
