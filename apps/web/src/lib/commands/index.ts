/**
 * Merchant actions the lead agent can run (bottom chat, ⌘K, WebMCP). OWNED BY: team for the watch commands;
 * the registry itself is the shared list AGENTS.md asks every new action to join.
 *
 * `risk: "confirm"` means the caller shows the returned text and only then calls the command again with
 * `{ confirm: true }`. Nothing here sends mail or touches payments.
 */
import { updateAutonomy, runWatch, inboxView } from "@/lib/team";

export type CommandRisk = "safe" | "confirm";

export interface CommandResult {
  ok: boolean;
  text: string;
  href?: string;
  /** Present when a policy was compiled and still needs a yes. */
  confirm?: { command: string; input: Record<string, unknown> };
}

export interface Command {
  name: string;
  title: string;
  risk: CommandRisk;
  run: (input: Record<string, unknown>) => Promise<CommandResult>;
}

export const COMMANDS: Command[] = [
  {
    name: "watch.run",
    title: "Check the store now",
    risk: "safe",
    async run() {
      const res = await runWatch({ reason: "manual" });
      return { ok: res.ok, text: res.text, href: "/console/inbox" };
    },
  },
  {
    name: "watch.inbox",
    title: "Open Darwin's inbox",
    risk: "safe",
    async run() {
      const inbox = inboxView({ limit: 5 });
      const last = inbox.messages.at(-1);
      return { ok: true, text: last ? last.text : "Darwin hasn't written anything yet.", href: "/console/inbox" };
    },
  },
  {
    name: "autonomy.set",
    title: "Set how much Darwin may do alone",
    risk: "confirm",
    async run(input) {
      const level = input.level;
      if (level !== "off" && level !== "suggest" && level !== "auto-safe" && level !== "autopilot") {
        return { ok: false, text: "Say which level: off, suggest, auto-safe or autopilot." };
      }
      if (input.confirm !== true) {
        return { ok: true, text: `Set Darwin to “${level}”?`, confirm: { command: "autonomy.set", input: { level, confirm: true } } };
      }
      const res = await updateAutonomy({ level });
      return { ok: true, text: res.text, href: "/console/settings" };
    },
  },
  {
    name: "policy.add",
    title: "Add a standing policy",
    risk: "confirm",
    async run(input) {
      const text = typeof input.text === "string" ? input.text : "";
      if (text.trim().length < 8) return { ok: false, text: "Write the policy in a sentence." };
      const res = await updateAutonomy({ policy: text });
      return {
        ok: true,
        text: res.text,
        confirm: res.compiled ? { command: "policy.confirm", input: { policyId: res.compiled.id } } : undefined,
      };
    },
  },
  {
    name: "policy.confirm",
    title: "Confirm a standing policy",
    risk: "confirm",
    async run(input) {
      const policyId = typeof input.policyId === "string" ? input.policyId : "";
      if (!policyId) return { ok: false, text: "Which policy? Add one first." };
      if (input.confirm !== true) return { ok: true, text: "Confirm this policy?", confirm: { command: "policy.confirm", input: { policyId, confirm: true } } };
      const res = await updateAutonomy({ confirmPolicy: policyId });
      return { ok: true, text: res.text, href: "/console/settings" };
    },
  },
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

export function listCommands(): { name: string; title: string; risk: CommandRisk }[] {
  return COMMANDS.map(({ name, title, risk }) => ({ name, title, risk }));
}

export async function runCommand(name: string, input: Record<string, unknown> = {}): Promise<CommandResult> {
  const command = BY_NAME.get(name);
  if (!command) return { ok: false, text: `Unknown command “${name}”.` };
  return command.run(input);
}
