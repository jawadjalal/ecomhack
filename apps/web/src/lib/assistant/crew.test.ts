/**
 * The crew (agent-to-agent): ask_agent for every specialist on the heuristic path (no LLM key), the store agent
 * really answering over A2A, the simulated shopper talking to it, the thread shape the UI renders, navigate,
 * and talking to one crew member directly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThread } from "@/lib/contracts";

const LLM_KEYS = [
  "LLM_PROVIDER",
  "XAI_API_KEY",
  "APINEX_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
];
const env = { ...process.env };

const { runTool, TOOLS } = await import("./tools");
const { runAssistant } = await import("./agent");
const { askAgent, buyerBrief, MAX_THREAD_TURNS } = await import("./crew");
const { CREW, crewMember, resolveSpecialist, SIMULATED_SHOPPER } =
  await import("@/lib/crew");
const { resetLoop } = await import("@/lib/optimizer");
const { agentFunnel } = await import("@/lib/store-agent");
const { eventStore } = await import("@/lib/analytics/store");

const ORIGIN = "http://localhost:3000";

beforeEach(async () => {
  for (const k of LLM_KEYS) delete process.env[k];
  await resetLoop();
});
afterEach(() => {
  process.env = { ...env };
});

function expectThread(t: AgentThread | undefined, agents: string[]) {
  expect(t).toBeDefined();
  expect(t!.id).toMatch(/^thr_/);
  expect(t!.agents).toEqual(agents);
  expect(t!.messages.length).toBeGreaterThanOrEqual(2);
  expect(t!.messages.length).toBeLessThanOrEqual(MAX_THREAD_TURNS * 2);
  for (const m of t!.messages) {
    expect(typeof m.from).toBe("string");
    expect(typeof m.to).toBe("string");
    expect(m.text.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(m.at))).toBe(false);
  }
}

describe("crew registry", () => {
  it("names every crew member with a role, and resolves old role names", () => {
    expect(CREW.map((c) => [c.id, c.name, c.role])).toEqual([
      ["darwin", "Darwin", "Lead"],
      ["iris", "Iris", "Watcher"],
      ["theo", "Theo", "Designer"],
      ["ada", "Ada", "Tester"],
      ["max", "Max", "Shipper"],
      ["mika", "Mika", "Store agent"],
      ["grok", "Grok", "Teammate"],
    ]);
    for (const c of CREW)
      expect(Boolean(c.mascot) !== Boolean(c.brand)).toBe(true);
    expect(crewMember("Mika")?.brand).toBe("store");
    expect(resolveSpecialist("analyst")).toBe("iris");
    expect(resolveSpecialist("designer")).toBe("theo");
    expect(resolveSpecialist("store_agent")).toBe("mika");
    expect(resolveSpecialist("shopper")).toBe("shopper");
    expect(resolveSpecialist("darwin")).toBeUndefined();
    expect(SIMULATED_SHOPPER.label).toBe("simulated shopper");
  });
});

describe("ask_agent (no LLM key: every specialist answers from its own data)", () => {
  it.each([
    ["analyst", "Iris"],
    ["iris", "Iris"],
    ["designer", "Theo"],
    ["ada", "Ada"],
    ["max", "Max"],
    ["grok", "Grok"],
  ])("%s answers with a Darwin → %s thread", async (agent, name) => {
    const out = await runTool(
      "ask_agent",
      { agent, question: "What should I know right now?" },
      { origin: ORIGIN },
    );
    expect(out.ok).toBe(true);
    expect(out.summary.startsWith(`${name}`)).toBe(true);
    expectThread(out.thread, ["Darwin", name]);
    expect(out.thread!.messages[0]).toMatchObject({
      from: "Darwin",
      to: name,
      text: "What should I know right now?",
    });
    expect(out.thread!.messages[1]).toMatchObject({ from: name, to: "Darwin" });
    expect((out.data as { source: string }).source).toBe("rules");
  });

  it("store_agent sends a real A2A message to the store agent and returns its reply", async () => {
    const before = agentFunnel(eventStore().all()).conversations;
    const out = await runTool(
      "ask_agent",
      {
        agent: "store_agent",
        question:
          "What would you say to a buyer who wants a membership under £30?",
      },
      { origin: ORIGIN },
    );
    expect(out.ok).toBe(true);
    expectThread(out.thread, ["Darwin", "Mika"]);
    const reply = out.thread!.messages[1];
    expect(reply.from).toBe("Mika");
    expect(reply.text).not.toMatch(/didn't answer/);
    // The store agent recorded the conversation, labelled simulated (it wasn't a real buyer).
    const f = agentFunnel(eventStore().all());
    expect(f.conversations).toBe(before + 1);
    expect(f.simulated).toBeGreaterThanOrEqual(1);
    expect(out.thread!.synthetic).toBe(true);
  });

  it("shopper: a simulated buyer agent talks to the store agent for a few turns", async () => {
    const out = await askAgent({
      agent: "shopper",
      question: "Ask a shopper who wants the cheapest plan to buy it",
      origin: ORIGIN,
    });
    expect(out.synthetic).toBe(true);
    expect(out.answer).toMatch(/^Simulated shopper:/);
    expectThread(out.thread, ["Darwin", "Shopper", "Mika"]);
    expect(out.thread.synthetic).toBe(true);
    const talk = out.thread.messages.slice(1);
    expect(talk[0]).toMatchObject({ from: "Shopper", to: "Mika" });
    expect(talk[1]).toMatchObject({ from: "Mika", to: "Shopper" });
    expect(talk.length).toBeGreaterThanOrEqual(2);
  });

  it("derives the buyer's brief from the merchant's question", () => {
    expect(
      buyerBrief(
        "What would the store agent say to a buyer who wants trail shoes under £140?",
      ),
    ).toBe(
      "Hi, I'm shopping for trail shoes under £140. What do you recommend, and how much is it?",
    );
    expect(buyerBrief("ask a shopper to buy the pro plan")).toBe(
      "buy the pro plan",
    );
  });

  it("rejects an unknown agent", async () => {
    const out = await runTool("ask_agent", {
      agent: "hal9000",
      question: "hi",
    });
    expect(out.ok).toBe(false);
  });
});

describe("the lead consults specialists (heuristic router)", () => {
  it("routes 'ask the store agent …' to Mika and returns the thread on the response", async () => {
    const res = await runAssistant({
      messages: [
        {
          role: "user",
          content:
            "Ask the store agent what it would say to a buyer who wants a course",
        },
      ],
      origin: ORIGIN,
    });
    expect(res.actions.map((a) => a.tool)).toEqual(["ask_agent"]);
    expect(res.threads).toHaveLength(1);
    expectThread(res.threads![0], ["Darwin", "Mika"]);
    expect(res.source).toBe("rules");
  });

  it("navigate returns a link and the navigate flag the UI acts on", async () => {
    const direct = await runTool("navigate", { to: "experiments" });
    expect(direct).toMatchObject({
      ok: true,
      navigate: true,
      link: { label: "Experiments", href: "/console/experiments" },
    });
    const res = await runAssistant({
      messages: [{ role: "user", content: "open the store agent page" }],
    });
    expect(res.actions[0]).toMatchObject({
      tool: "navigate",
      ok: true,
      navigate: true,
      link: { href: "/console/agents" },
    });
    expect(TOOLS.navigate.args.safeParse({ to: "admin" }).success).toBe(false);
  });
});

describe("talking to one crew member directly", () => {
  it("answers as Ada (not Darwin), with a You → Ada thread", async () => {
    const res = await runAssistant({
      agent: "ada",
      messages: [{ role: "user", content: "How are the tests going?" }],
    });
    expect(res.agent).toBe("ada");
    expectThread(res.threads![0], ["You", "Ada"]);
    expect(res.reply).toMatch(/No A\/B tests yet|test/);
  });

  it("sends a direct message to Mika over A2A", async () => {
    const res = await runAssistant({
      agent: "mika",
      messages: [{ role: "user", content: "What do you sell?" }],
      origin: ORIGIN,
    });
    expect(res.agent).toBe("mika");
    expectThread(res.threads![0], ["You", "Mika"]);
    expect(res.reply.length).toBeGreaterThan(0);
  });
});
