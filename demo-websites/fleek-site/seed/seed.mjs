#!/usr/bin/env node
/**
 * Seed Darwin with simulated traffic for the Rackd store, so Issues / Fixes / Experiments / Traffic /
 * Personalize have data the moment you open the console.
 *
 *   node seed/seed.mjs --darwin http://localhost:3000 [--token $DARWIN_ADMIN_TOKEN] [--reset]
 *
 * Everything here goes through Darwin's own simulate APIs, so every event is stored with
 * properties.synthetic = true and labelled "simulated" in the console. (Darwin's public ingest,
 * /api/collect, deliberately forces synthetic = false because browsers can't be trusted to set it,
 * so it is only used by the real darwin.js tag on the site, never by this script.)
 *
 *   1. POST /api/loop/baseline  → this repo's storefront.config.json becomes Darwin's Gen 0, so Darwin
 *                                 diagnoses (and later PRs) exactly the knobs this store has.
 *   2. POST /api/simulate       → human shoppers + AI shopping agents over the last few days, reacting
 *                                 to that config: they bounce off the weak hero, miss the add-to-cart
 *                                 button under the description, quit at the surprise freight fee and the
 *                                 forced account; agents give up when stock / ETA / returns / landed
 *                                 price are missing.
 *   3. POST /api/web/simulate   → visitors per traffic source (AI assistants, search, social, ads, email)
 *                                 for this site id, for Traffic, Personalize and the heatmap.
 *   4. POST /api/loop/step ×N   → observe → diagnose → propose → experiment, so Issues, Fixes and a
 *                                 running A/B test are on screen.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) out[k] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const opt = args(process.argv.slice(2));
if (opt.help || opt.h) {
  console.log(`Usage: node seed/seed.mjs [options]

  --darwin URL      Darwin origin (default $DARWIN_URL or http://localhost:3000)
  --token TOKEN     Darwin admin key, if DARWIN_ADMIN_TOKEN is set on that Darwin (default $DARWIN_ADMIN_TOKEN)
  --site ID         darwin.js site id (default $DARWIN_SITE or "rackd")
  --config PATH     PageSpec to import as Gen 0 (default ./storefront.config.json)
  --reset           Wipe Darwin's events, experiments and history first (needed if the loop already ran)
  --no-baseline     Don't import the config (keep Darwin's current live spec)
  --humans N        Simulated human shoppers (default 6000)
  --agents N        Simulated AI shopping agents (default 600)
  --web N           Simulated visitors on the site, spread across traffic sources (default 1500)
  --days N          Spread the backfill over the last N days (default 3)
  --steps N         Loop steps to run afterwards (default 4: observe, diagnose, propose, experiment)
`);
  process.exit(0);
}

const DARWIN = String(opt.darwin ?? process.env.DARWIN_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = opt.token ?? process.env.DARWIN_ADMIN_TOKEN ?? "";
const SITE = String(opt.site ?? process.env.DARWIN_SITE ?? "rackd");
const CONFIG = resolve(root, String(opt.config ?? "storefront.config.json"));
const int = (v, d) => (v === undefined || v === true ? d : Math.max(0, Math.floor(Number(v)) || 0));
const HUMANS = int(opt.humans, 6000);
const AGENTS = int(opt.agents, 600);
const WEB = int(opt.web, 1500);
const DAYS = int(opt.days, 3);
const STEPS = int(opt.steps, 4);

async function call(method, path, body) {
  const res = await fetch(`${DARWIN}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((err) => {
    throw new Error(`Can't reach Darwin at ${DARWIN} (${err.cause?.code ?? err.message}). Is it running? Pass --darwin <url>.`);
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (res.status === 401 || res.status === 503) throw new Error(`Darwin refused ${path} (${res.status}): ${data.error ?? ""}\nPass the admin key: --token <DARWIN_ADMIN_TOKEN>.`);
  return { status: res.status, data };
}

const n = (x) => Number(x ?? 0).toLocaleString("en-GB");
const pct = (x) => `${(Number(x ?? 0) * 100).toFixed(1)}%`;
const log = (...a) => console.log(...a);

async function main() {
  log(`Seeding Darwin at ${DARWIN} for site "${SITE}" (all traffic simulated, synthetic = true)\n`);

  const loop = await call("GET", "/api/loop");
  if (loop.status !== 200) throw new Error(`GET /api/loop returned ${loop.status}. Is ${DARWIN} a Darwin server?`);
  log(`· Darwin is up. Loop phase: ${loop.data.phase}, generation ${loop.data.generation}.`);

  if (!opt["no-baseline"]) {
    const spec = JSON.parse(readFileSync(CONFIG, "utf8"));
    const r = await call("POST", "/api/loop/baseline", { spec, reset: Boolean(opt.reset) });
    if (r.status === 200) log(`· Imported ${CONFIG.replace(root + "/", "")} as Darwin's baseline (v${r.data.spec.version} "${r.data.spec.label}").`);
    else if (r.status === 409) log(`! ${r.data.error}\n  Continuing with Darwin's current live spec. Re-run with --reset to start from this store's config.`);
    else if (r.status === 404) log("! This Darwin has no /api/loop/baseline (older build). Continuing with its own baseline config.");
    else throw new Error(`POST /api/loop/baseline → ${r.status}: ${r.data.error ?? JSON.stringify(r.data)}`);
  } else if (opt.reset) {
    await call("POST", "/api/loop/reset");
    log("· Reset Darwin: events, experiments and history cleared.");
  }

  // 2. Humans + AI agents on the live config, backfilled over the last few days.
  let humansLeft = HUMANS;
  let agentsLeft = AGENTS;
  let batch = 0;
  const totals = { humans: 0, agents: 0, orders: 0, events: 0 };
  while (humansLeft > 0 || agentsLeft > 0) {
    const humans = Math.min(5000, humansLeft);
    const agents = Math.min(1000, agentsLeft);
    const r = await call("POST", "/api/simulate", { humans, agents, seed: 7331 + batch++, spreadMinutes: DAYS * 24 * 60 });
    if (r.status !== 200) throw new Error(`POST /api/simulate → ${r.status}: ${r.data.error ?? ""}`);
    const d = r.data;
    totals.humans += d.humans ?? humans;
    totals.agents += d.agents ?? agents;
    totals.orders += d.orders ?? 0;
    totals.events += d.events ?? 0;
    humansLeft -= humans;
    agentsLeft -= agents;
  }
  if (HUMANS || AGENTS) log(`· Simulated ${n(totals.humans)} shoppers and ${n(totals.agents)} AI agents over ${DAYS} day(s): ${n(totals.events)} events, ${n(totals.orders)} orders.`);

  // 3. Per-source visitors for this site id (Traffic, Personalize, heatmap).
  let webLeft = WEB;
  let webVisitors = 0;
  let webOrders = 0;
  while (webLeft > 0) {
    const visitors = Math.min(2000, webLeft);
    const r = await call("POST", "/api/web/simulate", { site: SITE, visitors });
    if (r.status !== 200) throw new Error(`POST /api/web/simulate → ${r.status}: ${r.data.error ?? ""}`);
    webVisitors += r.data.visitors ?? visitors;
    webOrders += r.data.orders ?? 0;
    webLeft -= visitors;
  }
  if (WEB) log(`· Simulated ${n(webVisitors)} visitors on site "${SITE}" by traffic source (${n(webOrders)} orders).`);

  // 4. Step the loop so the console has issues, a proposed fix and a running test.
  let state = null;
  for (let i = 0; i < STEPS; i++) {
    const r = await call("POST", "/api/loop/step");
    if (r.status !== 200) throw new Error(`POST /api/loop/step → ${r.status}: ${r.data.error ?? ""}`);
    state = r.data;
    const last = state.log?.[state.log.length - 1];
    log(`· Loop step ${i + 1}: ${state.phase}${last?.message ? `: ${last.message}` : ""}`);
  }

  const summary = await call("GET", "/api/analytics/summary");
  if (summary.status === 200 && summary.data.overall) {
    const s = summary.data;
    log(`\nDarwin now sees ${n(s.overall.visitors)} visitors, ${pct(s.overall.conversionRate)} convert` + (s.byKind ? ` (humans ${pct(s.byKind.human?.conversionRate)}, agents ${pct(s.byKind.agent?.conversionRate)}).` : "."));
  }
  if (state?.insights?.length) {
    log("\nTop issues Darwin found:");
    for (const ins of state.insights.slice(0, 6)) log(`  - ${ins.title}`);
  }
  if (state?.proposal) log(`\nFix being tested: ${state.proposal.title}`);
  log(`\nOpen ${DARWIN}/console/issues, /console/fixes and /console/experiments. Everything above is simulated and labelled as such.`);
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
