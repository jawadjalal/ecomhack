/**
 * Argument parsing for the Darwin CLI (scripts/darwin.ts). Pure, so it's unit-tested.
 *
 *   darwin run simulate_traffic --humans 20 --agents 5
 *   darwin run rollback --generation 2 --yes
 *   darwin run build_dashboard --json '{"request":"coupon usage per hour","site":"trail-shop-co-uk"}'
 *   darwin state --json            (a bare --json means machine-readable output)
 */

export interface CliArgs {
  /** Sub-command: commands | run | do | state | pages | open | help. */
  cmd: string;
  /** Positional words after the sub-command (the command name, the plain-English request, the page). */
  positional: string[];
  /** Command input from --key value pairs and --json '{…}' (the --key pairs win). */
  input: Record<string, unknown>;
  /** --yes / -y: confirm risky commands without asking. */
  yes: boolean;
  /** Bare --json: print machine-readable JSON. */
  json: boolean;
  help: boolean;
  /** Set when the arguments can't be parsed (e.g. --json '{bad'). */
  error?: string;
}

/** "20" → 20, "true" → true, "false" → false, anything else stays a string. */
export function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value) && value.length < 16) return Number(value);
  return value;
}

const key = (k: string) => k.replace(/-/g, "_");

export function parseCliArgs(argv: string[]): CliArgs {
  const out: CliArgs = { cmd: "", positional: [], input: {}, yes: false, json: false, help: false };
  const pairs: Record<string, unknown> = {};
  let jsonInput: Record<string, unknown> | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      out.positional.push(...argv.slice(i + 1));
      break;
    }
    if (a === "-y" || a === "--yes") {
      out.yes = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a === "--json") {
      const next = argv[i + 1];
      if (next !== undefined && next.trim().startsWith("{")) {
        try {
          const v = JSON.parse(next) as unknown;
          if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
          jsonInput = v as Record<string, unknown>;
        } catch {
          out.error = `--json expects a JSON object, got ${next}`;
        }
        i++;
      } else out.json = true;
      continue;
    }
    if (a.startsWith("--") && a.length > 2) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq > 0) {
        pairs[key(body.slice(0, eq))] = coerce(body.slice(eq + 1));
        continue;
      }
      if (body.startsWith("no-")) {
        pairs[key(body.slice(3))] = false;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("--") && next.length > 2)) pairs[key(body)] = true;
      else {
        pairs[key(body)] = coerce(next);
        i++;
      }
      continue;
    }
    if (!out.cmd) out.cmd = a;
    else out.positional.push(a);
  }

  out.input = { ...(jsonInput ?? {}), ...pairs };
  if (!out.cmd) out.cmd = out.help ? "help" : "";
  return out;
}
