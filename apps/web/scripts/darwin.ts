/**
 * darwin: drive Darwin from a terminal (or from a coding agent) with the same commands as ⌘K, WebMCP and the
 * control MCP server (/api/darwin/mcp). Every command runs headlessly against DARWIN_URL through Darwin's own API.
 *
 *   npx tsx scripts/darwin.ts commands                                   the command table
 *   npx tsx scripts/darwin.ts state                                      loop, KPIs, running tests
 *   npx tsx scripts/darwin.ts run simulate_traffic --humans 20 --agents 5
 *   npx tsx scripts/darwin.ts run rollback --generation 2 --yes          risky: --yes confirms
 *   npx tsx scripts/darwin.ts run build_dashboard --json '{"request":"coupon usage per hour"}'
 *   npx tsx scripts/darwin.ts do "send 200 shoppers then step the loop"
 *   npx tsx scripts/darwin.ts open experiments
 *   npx tsx scripts/darwin.ts pages
 *
 * Env: DARWIN_URL (default http://localhost:3000), DARWIN_TOKEN (the admin key, sent as a bearer token).
 * Add --json for machine-readable output. Or: npm run darwin -- <args>
 */
import { createInterface } from "node:readline/promises";
import { parseCliArgs } from "../src/lib/commands/cli-args";
import { confirmTextHeadless, darwinPages, darwinState, findPage, runCommandHeadless, type HeadlessOptions } from "../src/lib/commands/server-run";
import { COMMAND_NAMES, resolveCommand, specOf } from "../src/lib/commands/specs";
import type { CommandPlanResponse, CommandResult } from "../src/lib/commands/types";

const args = parseCliArgs(process.argv.slice(2));
const ORIGIN = (process.env.DARWIN_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.DARWIN_TOKEN?.trim();
const opts: HeadlessOptions = { origin: ORIGIN, headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} };

/* ------------------------------------------------------------------ output */

const color = !args.json && process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint("1"), dim: paint("2"), green: paint("32"), red: paint("31"), yellow: paint("33"), cyan: paint("36"), magenta: paint("35") };

const say = (s = "") => process.stdout.write(`${s}\n`);
const indent = (text: string, pad = "  ") => text.split("\n").join(`\n${pad}`);

function printResult(r: CommandResult, label?: string) {
  const mark = r.ok ? c.green("✓") : c.red("✗");
  say(`${mark} ${label ? `${c.bold(label)} ${c.dim("·")} ` : ""}${indent(r.text)}`);
  if (r.synthetic) say(`  ${c.yellow("◆ simulated traffic (labelled synthetic)")}`);
  if (r.href && !r.text.includes(r.href)) say(`  ${c.dim("→")} ${c.cyan(r.href)}`);
}

function emit(value: unknown) {
  say(JSON.stringify(value, null, 2));
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = await rl.question(`${c.yellow("?")} ${question} ${c.dim("[y/N]")} `);
    return /^y(es)?$/i.test(a.trim());
  } finally {
    rl.close();
  }
}

function fail(message: string, code = 1): never {
  if (args.json) emit({ ok: false, text: message });
  else say(`${c.red("✗")} ${message}`);
  process.exit(code);
}

/* ------------------------------------------------------------------ sub-commands */

function help() {
  say(`${c.bold("darwin")} ${c.dim("· drive Darwin from the terminal")}  ${c.dim(ORIGIN)}

  ${c.bold("commands")}                         every command, its risk and what it does
  ${c.bold("state")}                            the loop, KPIs and running tests
  ${c.bold("pages")}                            every page with its URL
  ${c.bold("open")} <page>                      print a page's URL (experiments, issues, store…)
  ${c.bold("run")} <command> [--key value…]     run one command; --json '{…}' for input, --yes confirms risky ones
  ${c.bold("do")} "<plain English>"              plan with Darwin, then run each step (asks before risky ones)

  ${c.dim("Env: DARWIN_URL (default http://localhost:3000), DARWIN_TOKEN (admin key). --json for machine output.")}`);
}

function commands() {
  const rows = COMMAND_NAMES.map((name) => {
    const s = specOf(name);
    return { name, title: s.title, risk: s.risk, readOnly: !!s.readOnly, aliases: s.aliases ?? [] };
  });
  if (args.json) return emit(rows);
  const w = Math.max(...rows.map((r) => r.name.length), 5);
  say(c.dim(`${"COMMAND".padEnd(w)}  ${"RISK".padEnd(7)}  WHAT IT DOES`));
  for (const r of rows) {
    const risk = r.risk === "confirm" ? c.yellow("confirm") : r.readOnly ? c.dim("read   ") : c.green("safe   ");
    say(`${c.bold(r.name.padEnd(w))}  ${risk}  ${r.title}${r.aliases.length ? c.dim(` (alias ${r.aliases.join(", ")})`) : ""}`);
  }
  say(c.dim(`\nRun one: darwin run <command> --key value · inputs: darwin run <command> --help`));
}

function commandHelp(name: string) {
  const cmd = resolveCommand(name);
  if (!cmd) fail(`Unknown command “${name}”. Try: darwin commands`);
  const s = specOf(cmd);
  const schema = s.input.shape as Record<string, { description?: string }>;
  say(`${c.bold(cmd)} ${c.dim("·")} ${s.title}${s.risk === "confirm" ? ` ${c.yellow("(confirm: needs --yes)")}` : ""}\n  ${s.description}\n`);
  for (const [k, v] of Object.entries(schema)) say(`  ${c.cyan(`--${k}`)}  ${v.description ?? ""}`);
  for (const e of s.examples) say(c.dim(`  e.g. “${e.text}” → darwin run ${cmd} --json '${JSON.stringify(e.input)}'`));
}

async function run() {
  const name = args.positional[0];
  if (!name) fail("Which command? e.g. darwin run simulate_traffic --humans 20. See: darwin commands");
  if (args.help) return commandHelp(name);
  const input = { ...args.input, ...(args.yes ? { confirm: true } : {}) };
  let r = await runCommandHeadless(name, input, opts);
  const needs = (r.data as { needsConfirmation?: boolean } | undefined)?.needsConfirmation;
  if (needs && !args.json && (await ask(r.text))) r = await runCommandHeadless(name, { ...input, confirm: true }, opts);
  else if (needs && !args.json) r = { ...r, text: `${r.text}\n${c.dim("Not run. Add --yes to confirm.")}` };
  if (args.json) emit(r);
  else printResult(r, resolveCommand(name));
  process.exitCode = r.ok ? 0 : 1;
}

async function plan(text: string): Promise<CommandPlanResponse> {
  const res = await fetch(`${ORIGIN}/api/command`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ text }),
  });
  const j = (await res.json().catch(() => ({}))) as CommandPlanResponse & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `POST /api/command answered ${res.status}`);
  return j;
}

async function doText() {
  const text = args.positional.join(" ").trim();
  if (!text) fail('Say what to do, e.g. darwin do "send 200 shoppers then step the loop"');
  const p = await plan(text).catch((e: Error) => fail(`Couldn't plan it: ${e.message}`));
  const results: { step: number; command: string; skipped?: boolean; result?: CommandResult }[] = [];
  if (!args.json) {
    say(`${c.magenta("◇")} ${p.say || "Darwin has no step for that."} ${c.dim(`(${p.source})`)}`);
    p.steps.forEach((s, i) => say(`  ${c.dim(`${i + 1}.`)} ${s.label}${s.risk === "confirm" ? ` ${c.yellow("· confirm")}` : ""}`));
    for (const r of p.rejected ?? []) say(`  ${c.red("✗")} ${c.dim(`skipped ${r.command}: ${r.reason}`)}`);
  }
  if (!p.steps.length) {
    if (args.json) emit({ plan: p, results });
    process.exitCode = 1;
    return;
  }
  let failed = false;
  for (const [i, s] of p.steps.entries()) {
    if (s.risk === "confirm" && !args.yes) {
      const q = await confirmTextHeadless(s.command, s.input, opts);
      if (args.json || !(await ask(q))) {
        results.push({ step: i + 1, command: s.command, skipped: true });
        if (!args.json) say(`${c.red("✗")} ${c.bold(s.title)} ${c.dim("· skipped (not confirmed; add --yes)")}`);
        continue;
      }
    }
    const r = await runCommandHeadless(s.command, { ...s.input, ...(s.risk === "confirm" ? { confirm: true } : {}) }, opts);
    results.push({ step: i + 1, command: s.command, result: r });
    if (!args.json) printResult(r, s.title);
    if (!r.ok) {
      failed = true;
      break;
    }
  }
  if (args.json) emit({ plan: p, results });
  // 1: a step failed, 2: a risky step was skipped (not confirmed).
  process.exitCode = failed ? 1 : results.some((r) => r.skipped) ? 2 : 0;
}

async function state() {
  const r = await darwinState(opts);
  if (args.json) emit(r);
  else printResult(r, "Darwin");
  process.exitCode = r.ok ? 0 : 1;
}

function pages() {
  const list = darwinPages(ORIGIN);
  if (args.json) return emit(list);
  const w = Math.max(...list.map((p) => p.key.length));
  for (const p of list) say(`${c.bold(p.key.padEnd(w))}  ${c.cyan(p.url)}  ${c.dim(p.purpose)}`);
}

function open() {
  const q = args.positional.join(" ");
  if (!q) fail("Which page? e.g. darwin open experiments. See: darwin pages");
  const p = findPage(ORIGIN, q);
  if (!p) fail(`No page “${q}”. Pages: ${darwinPages(ORIGIN).map((x) => x.key).join(", ")}`);
  if (args.json) return emit(p);
  say(`${c.green("✓")} ${c.bold(p.label)} ${c.dim("·")} ${p.purpose}`);
  say(`  ${c.dim("→")} ${c.cyan(p.url)}`);
}

async function main() {
  if (args.error) fail(args.error);
  switch (args.cmd) {
    case "commands":
    case "ls":
      return commands();
    case "run":
      return run();
    case "do":
      return doText();
    case "state":
    case "status":
      return state();
    case "pages":
      return pages();
    case "open":
      return open();
    case "":
    case "help":
      return help();
    default: {
      // `darwin simulate_traffic --humans 20` works too.
      if (resolveCommand(args.cmd)) {
        args.positional.unshift(args.cmd);
        return run();
      }
      fail(`Unknown sub-command “${args.cmd}”. Try: darwin help`);
    }
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  fail(/fetch failed|ECONNREFUSED/.test(msg) ? `Can't reach Darwin at ${ORIGIN} (set DARWIN_URL): ${msg}` : msg);
});
