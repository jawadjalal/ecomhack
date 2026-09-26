/**
 * Darwin's watch: signal detection, the notability gate, action tokens, autonomy and policies,
 * and the Grok bot channel against the route handlers. The clock and the LLM are injected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "@/lib/contracts/watch";

const llm = vi.hoisted(() => ({ on: false }));
const briefing = vi.hoisted(() => ({
  throw: false,
  acted: [] as string[],
  items: [] as Record<string, unknown>[],
}));
const extras = vi.hoisted(() => ({
  cert: undefined as { url: string; origin: string; score: number; level: string; grade: string; issuedAt: string } | undefined,
  reports: [] as { id: string; createdAt: string }[],
  full: {} as Record<string, { id: string; query?: string; demo?: boolean; summary?: { text?: string }; suggestions?: { title?: string }[]; competitors?: unknown[]; sources?: unknown[] }>,
}));

vi.mock("@/lib/llm/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/llm/client")>();
  return {
    ...real,
    llmAvailable: () => llm.on,
    generateText: async () => {
      throw new Error("tests do not call a model");
    },
    generateJson: async () => {
      throw new Error("tests do not call a model");
    },
  };
});

vi.mock("@/lib/briefing", () => ({
  getBriefing: async () => {
    if (briefing.throw) throw new Error("briefing down");
    return { generatedAt: new Date().toISOString(), headline: "", text: "", items: briefing.items };
  },
  actOnBriefing: async (id: string, action: string) => {
    briefing.acted.push(`${action}:${id}`);
    return { ok: true, text: `Shipped “${id}”.` };
  },
}));

vi.mock("@/lib/readiness", () => ({
  recentCertificate: () => extras.cert,
  CERT_VALID_DAYS: 90,
}));

vi.mock("@/lib/research", () => ({
  listReports: () => extras.reports,
  getReport: (id: string) => extras.full[id],
}));

const { resetTeam, runWatch, gate, digestDue, isQuietHour, canRunUnattended, compileGuardHeuristic, describeGuard, compilePolicy, actionRisk } = await import("./index");
const { testsCheck, kpiCheck, agentFunnelCheck, pullRequestCheck, readinessCheck, researchCheck, loopCheck, shipFollowUpCheck, kpiWindows } = await import("./signals");
const { heuristicMessage } = await import("./persona");
const { mintToken, getToken, hashAction, recordSent, recordKpiPoint, remember, setWatchSettings, getWatchSettings, savePolicy, listMemory, resetWatchStore } = await import("./watch-store");
const { performActionToken } = await import("./actions");
const { kvGet, kvSet, kvUpdate } = await import("@/lib/db/json-store");
const { resetLoop } = await import("@/lib/optimizer");
const { eventStore } = await import("@/lib/analytics/store");
const { ensureInboxChat } = await import("./store");
const { POST: postWatch, GET: getWatch } = await import("@/app/api/team/watch/route");
const { GET: getInbox } = await import("@/app/api/team/inbox/route");
const { POST: postChat } = await import("@/app/api/team/chat/route");
const { POST: postReply } = await import("@/app/api/team/channels/reply/route");

const NOW = Date.parse("2026-09-26T11:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function item(over: Record<string, unknown> = {}) {
  return {
    id: "web:north-trail:wr_test",
    kind: "web",
    title: "Bigger size guide",
    status: "winning",
    probabilityToBeat: 0.91,
    lift: 0.12,
    sample: 1240,
    traffic: "simulated",
    say: "On north-trail, 8% of visitors bought with “Bigger size guide” vs 5% without: 91% chance it's better after 1,240 visitors (simulated traffic).",
    actions: ["ship", "stop"],
    url: "http://localhost:3000/console/personalize",
    ...over,
  };
}

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "sig_test",
    kind: "experiment_decided",
    agent: "fizz",
    severity: "high",
    title: "A test is ready",
    facts: ["91% chance it's better, 1,240 real visitors."],
    sources: ["briefing"],
    synthetic: false,
    fingerprint: "test:exp_1:ready",
    score: 0.9,
    suggestedAction: { type: "briefing", id: "loop:exp_1", action: "ship", title: "A test" },
    at: new Date(NOW).toISOString(),
    ...over,
  };
}

const ctxFor = (call: (tool: string, args?: Record<string, unknown>) => Promise<{ tool: string; ok: boolean; summary: string; data?: unknown; synthetic?: boolean }>) => ({
  now: NOW,
  origin: "http://localhost:3000",
  previous: [],
  exhausted: () => false,
  call,
});

beforeEach(async () => {
  llm.on = false;
  briefing.throw = false;
  briefing.acted = [];
  briefing.items = [];
  extras.cert = undefined;
  extras.reports = [];
  extras.full = {};
  resetTeam();
  resetWatchStore();
  eventStore().clear();
  await resetLoop();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("signals", () => {
  it("flags a test that reached a decision, and labels simulated traffic", async () => {
    briefing.items = [item(), item({ id: "loop:exp_real", title: "Faster checkout", traffic: "real", status: "losing", say: "Faster checkout is at 12% after 800 real visitors.", actions: ["stop"], probabilityToBeat: 0.12 })];
    const found = await testsCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "" })));
    expect(found.map((s) => s.fingerprint).sort()).toEqual(["test:loop:exp_real:losing", "test:web:north-trail:wr_test:winning"]);
    const sim = found.find((s) => s.synthetic);
    const real = found.find((s) => !s.synthetic);
    expect(sim?.facts[0]).toMatch(/simulated/);
    expect(sim?.suggestedAction).toMatchObject({ type: "briefing", action: "ship" });
    expect(real?.suggestedAction).toMatchObject({ action: "stop" });
    expect(sim?.sources).toEqual(["briefing"]);
  });

  it("flags a real-traffic KPI outside its band, and ignores thin or synthetic-only samples", async () => {
    expect(kpiWindows([{ at: "", visitors: 0, orders: 0, revenuePence: 0 }, { at: "", visitors: 50, orders: 1, revenuePence: 0 }])).toEqual([]);
    let visitors = 0;
    let orders = 0;
    recordKpiPoint({ at: new Date(NOW - 8 * HOUR).toISOString(), visitors, orders, revenuePence: 0 });
    for (const rate of [0.04, 0.06, 0.05, 0.07, 0.045, 0.055]) {
      visitors += 400;
      orders += Math.round(400 * rate);
      recordKpiPoint({ at: new Date(NOW).toISOString(), visitors, orders, revenuePence: 0 });
    }
    const dropped = await kpiCheck.run(
      ctxFor(async (tool) => ({
        tool,
        ok: true,
        summary: "real",
        data: { overall: { visitors: visitors + 400, orders: orders + 4, revenuePence: 0, conversionRate: 0.01 } },
      })),
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0].synthetic).toBe(false);
    expect(dropped[0].facts[0]).toMatch(/Real visitors converted at/);
    expect(dropped[0].sources).toEqual(["get_kpis"]);

    resetWatchStore();
    const thin = await kpiCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "", data: { overall: { visitors: 10, orders: 1, revenuePence: 0 } } })));
    expect(thin).toEqual([]);
  });

  it("flags an AI-shopper funnel drop and says when the buyers were simulated", async () => {
    const found = await agentFunnelCheck.run(
      ctxFor(async (tool) => ({
        tool,
        ok: true,
        summary: "40 agent conversations → 30 saw offers → 4 checkout links → 0 paid.",
        synthetic: true,
        data: { conversations: 40, offersShown: 30, checkouts: 4, paid: 0, simulated: 40, conversion: 0 },
      })),
    );
    expect(found[0].kind).toBe("agent_funnel_drop");
    expect(found[0].synthetic).toBe(true);
    expect(found[0].facts.join(" ")).toMatch(/0 of 4/);
    const healthy = await agentFunnelCheck.run(
      ctxFor(async (tool) => ({ tool, ok: true, summary: "", data: { conversations: 40, offersShown: 36, checkouts: 30, paid: 20, simulated: 0 } })),
    );
    expect(healthy).toEqual([]);
  });

  it("flags a pull request whose checks failed, and a merged one", async () => {
    const failed = await pullRequestCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "failing", data: { state: "open", number: 42, title: "Ship Gen 3", checks: { state: "failure" } } })));
    expect(failed[0]).toMatchObject({ kind: "pr_state", severity: "high", synthetic: false });
    expect(failed[0].facts[0]).toMatch(/PR #42/);
    const merged = await pullRequestCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "", data: { state: "merged", number: 7, title: "Gen 2" } })));
    expect(merged[0].fingerprint).toBe("pr:7:merged");
    const none = await pullRequestCheck.run(ctxFor(async (tool) => ({ tool, ok: false, summary: "no repo" })));
    expect(none).toEqual([]);
  });

  it("flags a readiness score change and a new research finding", async () => {
    vi.stubEnv("DARWIN_STORE_URL", "https://shop.example");
    extras.cert = { url: "https://shop.example", origin: "https://shop.example", score: 82, level: "gold", grade: "A", issuedAt: new Date(NOW).toISOString() };
    const first = await readinessCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "" })));
    expect(first[0].facts[0]).toMatch(/82\/100/);
    const same = await readinessCheck.run({ ...ctxFor(async (tool) => ({ tool, ok: true, summary: "" })), previous: [{ ...first[0], data: { score: 82 } }] });
    expect(same).toEqual([]);
    extras.cert = { ...extras.cert, score: 60 };
    const dropped = await readinessCheck.run({ ...ctxFor(async (tool) => ({ tool, ok: true, summary: "" })), previous: [{ ...first[0], data: { score: 82 } }] });
    expect(dropped[0].facts[0]).toMatch(/82\/100 to 60\/100/);

    extras.reports = [{ id: "rep_1", createdAt: new Date(NOW).toISOString() }];
    extras.full.rep_1 = { id: "rep_1", query: "trail shoes", demo: true, summary: { text: "Competitors undercut on delivery." }, suggestions: [{ title: "Free delivery bar" }], competitors: [{}], sources: [{}] };
    const research = await researchCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "" })));
    expect(research[0].synthetic).toBe(true);
    expect(research[0].facts[0]).toMatch(/Competitors undercut/);
  });

  it("flags a loop that has stopped moving, and a week-later follow-up", async () => {
    const persisted = kvGet<{ state: { phase: string; updatedAt: string } }>("loop", () => {
      throw new Error("loop missing");
    });
    persisted.state.phase = "decide";
    persisted.state.updatedAt = new Date(NOW - 2 * HOUR).toISOString();
    kvSet("loop", persisted);
    const stuck = await loopCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "phase decide" })));
    expect(stuck[0].kind).toBe("loop_stuck");
    expect(stuck[0].facts[0]).toMatch(/decide/);

    remember({ kind: "shipped", at: new Date(NOW - 8 * 24 * HOUR).toISOString(), label: "Bigger size guide", baseline: 0.05, fingerprint: "test:1" });
    const follow = await shipFollowUpCheck.run(
      ctxFor(async (tool) => ({ tool, ok: true, summary: "8% conversion, 2,000 visitors.", synthetic: true, data: { overall: { conversionRate: 0.08, visitors: 2000 } } })),
    );
    expect(follow[0].facts[0]).toMatch(/5\.0% to 8\.0%/);
    expect(follow[0].synthetic).toBe(true);
    const again = await shipFollowUpCheck.run(ctxFor(async (tool) => ({ tool, ok: true, summary: "", data: { overall: { conversionRate: 0.08, visitors: 2000 } } })));
    expect(again).toEqual([]);
  });
});

describe("notability gate", () => {
  const settings = () => getWatchSettings();

  it("dedupes for 24h unless the signal got worse", () => {
    const base = { now: NOW, settings: settings(), sent: [], memory: [] };
    const first = gate([signal()], base);
    expect(first.speak?.id).toBe("sig_test");
    const sent = [{ messageId: "m", fingerprint: "test:exp_1:ready", signalId: "sig_test", severity: "high" as const, score: 0.9, at: new Date(NOW - HOUR).toISOString() }];
    expect(gate([signal()], { ...base, sent }).speak).toBeUndefined();
    expect(gate([signal({ score: 1.2 })], { ...base, sent }).speak?.score).toBe(1.2);
  });

  it("rate-limits to one an hour and six a day, but lets urgent through", () => {
    const sent = [{ messageId: "m", fingerprint: "other", signalId: "s", severity: "normal" as const, score: 0.5, at: new Date(NOW - 10 * 60 * 1000).toISOString() }];
    const base = { now: NOW, settings: settings(), sent, memory: [] };
    const held = gate([signal({ fingerprint: "new" })], base);
    expect(held.speak).toBeUndefined();
    expect(held.verdicts[0].reason).toBe("rate-limited");
    const urgent = gate([signal({ fingerprint: "new", severity: "urgent" })], base);
    expect(urgent.speak?.severity).toBe("urgent");
  });

  it("stays quiet in the merchant's quiet hours and bundles the rest into the digest", () => {
    const quietNow = Date.parse("2026-09-26T22:30:00.000Z");
    expect(isQuietHour(quietNow, settings())).toBe(true);
    const decided = gate([signal()], { now: quietNow, settings: settings(), sent: [], memory: [] });
    expect(decided.speak).toBeUndefined();
    expect(decided.digest).toHaveLength(1);
    expect(decided.verdicts[0].reason).toBe("quiet-hours");
    const morning = Date.parse("2026-09-26T08:00:00.000Z");
    expect(digestDue({ now: morning, settings: settings(), sent: [], memory: [] }, true)).toBe(true);
    expect(digestDue({ now: morning, settings: settings(), sent: [{ messageId: "d", fingerprint: "digest", signalId: "d", severity: "low", score: 0, at: new Date(morning).toISOString(), digest: true }], memory: [] }, true)).toBe(false);
  });

  it("does not re-propose something the merchant refused for 30 days", () => {
    const memory = [{ id: "mem_1", at: new Date(NOW - 2 * 24 * HOUR).toISOString(), kind: "rejected" as const, fingerprint: "test:exp_1:ready", label: "A test", baseline: 0.9 }];
    const decided = gate([signal()], { now: NOW, settings: settings(), sent: [], memory });
    expect(decided.verdicts[0].reason).toBe("cooldown");
    const moved = gate([signal({ score: 1.3 })], { now: NOW, settings: settings(), sent: [], memory });
    expect(moved.speak).toBeDefined();
  });
});

describe("action tokens", () => {
  it("is single-use, bound to its arguments, expires, and rejects a replay", async () => {
    ensureInboxChat();
    const minted = mintToken({
      label: "Ship it",
      risk: "drastic",
      action: { type: "briefing", id: "web:north-trail:wr_test", action: "ship", title: "Bigger size guide" },
      chatId: "chat_inbox",
      fingerprint: "test:1",
      now: NOW,
    });
    const host = { emit: () => {}, originChatId: "chat_inbox", toolCtx: {}, now: NOW };
    await performActionToken({ id: minted.token, approved: true }, host);
    expect(briefing.acted).toEqual(["ship:web:north-trail:wr_test"]);
    const events: { text: string }[] = [];
    await performActionToken({ id: minted.token, approved: true }, { ...host, emit: (e) => { if (e.type === "message") events.push({ text: e.message.text }); } });
    expect(events.at(-1)?.text).toMatch(/Already done/);

    const second = mintToken({ label: "Ship it", risk: "drastic", action: { type: "briefing", id: "web:north-trail:wr_test", action: "ship", title: "x" }, chatId: "chat_inbox", now: NOW, ttlMs: 1000 });
    const expired: { text: string }[] = [];
    await performActionToken({ id: second.token, approved: true }, { ...host, now: NOW + 5000, emit: (e) => { if (e.type === "message") expired.push({ text: e.message.text }); } });
    expect(expired.at(-1)?.text).toMatch(/expired/);
    expect(getToken(second.token)?.usedAt).toBeUndefined();

    const third = mintToken({ label: "Ship it", risk: "drastic", action: { type: "briefing", id: "web:s:r", action: "ship", title: "x" }, chatId: "chat_inbox", now: NOW });
    kvUpdate<typeof third[]>("team-watch-tokens", () => [], (all) => all.map((t) => (t.token === third.token ? { ...t, action: { ...t.action, id: "web:s:other" } } : t)));
    expect(hashAction(getToken(third.token)!.action)).not.toBe(third.argsHash);
    briefing.acted = [];
    const tampered: { text: string }[] = [];
    await performActionToken({ id: third.token, approved: true }, { ...host, emit: (e) => { if (e.type === "message") tampered.push({ text: e.message.text }); } });
    expect(tampered.at(-1)?.text).toMatch(/no longer matches/);
    expect(briefing.acted).toEqual([]);
  });

  it("remembers a no and does not run the action", async () => {
    ensureInboxChat();
    const minted = mintToken({
      label: "Keep testing",
      risk: "safe",
      action: { type: "dismiss" },
      chatId: "chat_inbox",
      fingerprint: "test:exp_1:ready",
      signalId: "sig_1",
      now: NOW,
    });
    await performActionToken({ id: minted.token, approved: true }, { emit: () => {}, originChatId: "chat_inbox", toolCtx: {}, now: NOW });
    expect(listMemory().some((m) => m.kind === "rejected" && m.fingerprint === "test:exp_1:ready")).toBe(true);
    expect(briefing.acted).toEqual([]);
  });
});

describe("autonomy and policies", () => {
  const ship = { type: "briefing" as const, id: "loop:exp_1", action: "ship" as const, title: "Bigger size guide" };

  it("blocks a drastic action on autopilot without a policy, and allows it when one matches", async () => {
    setWatchSettings({ autonomy: "autopilot" });
    const facts = { probability: 0.98, realPerArm: 800, label: "Bigger size guide" };
    expect(canRunUnattended(ship, facts).allowed).toBe(false);
    expect(actionRisk(ship, facts.label)).toBe("drastic");

    const compiled = await compilePolicy("ship winners above 95% with at least 500 real visitors per arm", { now: NOW });
    savePolicy({ ...compiled, confirmedAt: new Date(NOW).toISOString() });
    const allowed = canRunUnattended(ship, facts, { now: NOW });
    expect(allowed.allowed).toBe(true);
    expect(allowed.policy?.id).toBe(compiled.id);
    expect(canRunUnattended(ship, { ...facts, realPerArm: 100 }, { now: NOW }).allowed).toBe(false);
  });

  it("lets auto-safe pause a loser and still refuses a ship", () => {
    setWatchSettings({ autonomy: "auto-safe" });
    expect(canRunUnattended({ type: "briefing", id: "web:s:r", action: "stop", title: "Banner" }, { label: "Banner", probability: 0.05 }).allowed).toBe(true);
    expect(canRunUnattended(ship, { label: "Bigger size guide", probability: 0.99, realPerArm: 900 }).allowed).toBe(false);
  });

  it("round-trips a policy through plain English", async () => {
    const guard = compileGuardHeuristic("ship winners above 95% with at least 500 real visitors per arm");
    expect(compileGuardHeuristic(describeGuard(guard))).toEqual(guard);
    const deny = compileGuardHeuristic("never touch checkout on Fridays");
    expect(compileGuardHeuristic(describeGuard(deny))).toEqual(deny);
    const friday = Date.parse("2026-09-25T12:00:00.000Z");
    const policy = { ...(await compilePolicy("never touch checkout on Fridays", { now: NOW })), confirmedAt: new Date(NOW).toISOString() };
    savePolicy(policy);
    setWatchSettings({ autonomy: "autopilot" });
    const blocked = canRunUnattended(ship, { label: "Checkout tweak", probability: 0.99, realPerArm: 900 }, { now: friday });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockedBy?.id).toBe(policy.id);
  });
});

describe("heuristic voice", () => {
  it("uses the facts it was given and says when they are simulated", () => {
    const text = heuristicMessage(signal({ synthetic: true, facts: ["91% chance it's better, 1,240 visitors."], suggestedAction: { type: "briefing", id: "loop:exp_1", action: "ship", title: "x" } }));
    expect(text).toMatch(/91%/);
    expect(text).toMatch(/1,240/);
    expect(text).toMatch(/simulated/);
    expect(text).toMatch(/Want me to ship it\?/);
    expect(text).not.toMatch(/100%/);
  });
});

describe("Grok bot channel", () => {
  it("reads the inbox, spends the action token, and a second watch stays quiet", async () => {
    briefing.items = [item()];
    const first = await postWatch(new Request("http://localhost:3000/api/team/watch", { method: "POST", body: "{}" }));
    const run = (await first.json()) as { ran: boolean; text: string; run: { signals: { synthetic: boolean }[]; messageIds: string[]; checks: { ok: boolean; label: string; error?: string }[] } };
    expect(run.ran).toBe(true);
    expect(run.run.signals.some((s) => s.synthetic)).toBe(true);
    expect(run.run.messageIds).toHaveLength(1);
    expect(run.text).toMatch(/1 message/);

    const inboxRes = await getInbox(new Request("http://localhost:3000/api/team/inbox"));
    const inbox = (await inboxRes.json()) as { messages: { text: string; synthetic: boolean; actions: { token: string; label: string }[] }[] };
    const message = inbox.messages.at(-1)!;
    expect(message.synthetic).toBe(true);
    expect(message.text).toMatch(/simulated/);
    expect(message.text).toMatch(/91%/);
    const ship = message.actions.find((a) => a.label === "Ship it")!;

    const chat = await postChat(new Request("http://localhost:3000/api/team/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: { id: ship.token, approved: true }, text: "" }) }));
    const body = await chat.text();
    expect(body).toMatch(/Shipped/);
    expect(briefing.acted).toEqual(["ship:web:north-trail:wr_test"]);

    const reply = await postReply(new Request("http://localhost:3000/api/team/channels/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ship.token, text: "ship it" }) }));
    expect((await reply.json()).text).toMatch(/Already done/);

    const second = await postWatch(new Request("http://localhost:3000/api/team/watch", { method: "POST", body: "{}" }));
    const again = (await second.json()) as { ran: boolean; run: { messageIds: string[]; quiet?: string } };
    expect(again.ran).toBe(true);
    expect(again.run.messageIds).toEqual([]);
    expect(again.run.quiet).toBe("duplicate");

    const state = await getWatch(new Request("http://localhost:3000/api/team/watch"));
    const watch = (await state.json()) as { messagesToday: number; signalsToday: number };
    expect(watch.messagesToday).toBe(1);
    expect(watch.signalsToday).toBeGreaterThanOrEqual(1);
  });

  it("names a check it could not run", async () => {
    briefing.throw = true;
    const res = await runWatch({ now: NOW, origin: "http://localhost:3000" });
    expect(res.run?.checks.find((c) => c.id === "tests")?.ok).toBe(false);
    expect(res.text).toMatch(/Couldn't check tests that reached a decision/);
  });
});

describe("sent bookkeeping", () => {
  it("a recorded send is what the gate dedupes on", () => {
    recordSent({ messageId: "m1", fingerprint: "test:exp_1:ready", signalId: "sig_test", severity: "high", score: 0.9, at: new Date(NOW).toISOString() });
    const decided = gate([signal()], { now: NOW + 1000, settings: getWatchSettings(), sent: [{ messageId: "m1", fingerprint: "test:exp_1:ready", signalId: "sig_test", severity: "high", score: 0.9, at: new Date(NOW).toISOString() }], memory: [] });
    expect(decided.speak).toBeUndefined();
  });
});
