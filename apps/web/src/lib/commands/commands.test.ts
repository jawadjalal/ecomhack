import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const llm = vi.hoisted(() => ({ on: false, generateJson: vi.fn() }));
vi.mock("@/lib/llm/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/client")>()),
  llmAvailable: () => llm.on,
  generateJson: (...args: unknown[]) => llm.generateJson(...args),
}));

import { GET, POST } from "@/app/api/command/route";
import { LEVERS } from "@/lib/store-agent/experiments";
import { ROADMAP, roadmapFor } from "@/lib/status/roadmap";
import { parseCommand, resolveSite } from "./parse";
import { planCommand } from "./plan";
import { AGENT_LEVERS, COMMAND_NAMES, COMMANDS, inputJsonSchema, manifest, resolveCommand, specOf, validateStep, viewStep } from "./specs";
import type { CommandManifestResponse, CommandPlanResponse, PlanStep } from "./types";
import { registerWebMcp, webMcpTools } from "./webmcp";

afterEach(() => {
  llm.on = false;
  llm.generateJson.mockReset();
  vi.unstubAllGlobals();
});

const post = (body: unknown) => POST(new Request("http://x/api/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/* ------------------------------------------------------------------ registry */

describe("command registry", () => {
  it("has a spec per name, unique aliases, and descriptions written for an LLM", () => {
    expect(COMMAND_NAMES.length).toBeGreaterThanOrEqual(15);
    const aliases = COMMAND_NAMES.flatMap((n) => specOf(n).aliases ?? []);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const a of aliases) expect(COMMAND_NAMES as string[]).not.toContain(a);
    for (const n of COMMAND_NAMES) {
      const s = specOf(n);
      expect(s.name).toBe(n);
      expect(s.description.length).toBeGreaterThan(60);
      expect(s.examples.length).toBeGreaterThan(0);
    }
  });

  it("every schema round-trips through JSON Schema (examples pass, wrong types fail, both sides agree)", () => {
    for (const name of COMMAND_NAMES) {
      const spec = specOf(name);
      const json = inputJsonSchema(name);
      expect(json.type, name).toBe("object");
      expect(JSON.parse(JSON.stringify(json)), name).toEqual(json);
      const back = z.fromJSONSchema(json);
      for (const ex of spec.examples) {
        expect(spec.input.safeParse(ex.input).success, `${name} zod: ${ex.text}`).toBe(true);
        expect(back.safeParse(ex.input).success, `${name} json: ${ex.text}`).toBe(true);
        // A wrong type on any property is rejected by both.
        for (const prop of Object.keys((json.properties as object) ?? {})) {
          const bad = { ...(ex.input as object), [prop]: { not: "valid" } };
          expect(spec.input.safeParse(bad).success, `${name}.${prop} zod`).toBe(false);
          expect(back.safeParse(bad).success, `${name}.${prop} json`).toBe(false);
        }
      }
      const required = (json.required as string[] | undefined) ?? [];
      if (required.length) {
        expect(spec.input.safeParse({}).success, `${name} {} zod`).toBe(false);
        expect(back.safeParse({}).success, `${name} {} json`).toBe(false);
      }
    }
  });

  it("flags destructive commands as confirm, and the risk always comes from the registry", () => {
    const confirm = COMMAND_NAMES.filter((n) => specOf(n).risk === "confirm").sort();
    expect(confirm).toEqual(["act_on_briefing", "rollback"]);
    expect(viewStep({ command: "rollback", input: { generation: 2 } }).risk).toBe("confirm");
    expect(viewStep({ command: "rollback", input: { generation: 2 } }).label).toBe("Roll back to Gen 2");
    expect(viewStep({ command: "navigate", input: { page: "issues" } }).risk).toBe("safe");
    expect(manifest().find((m) => m.name === "act_on_briefing")?.risk).toBe("confirm");
  });

  it("resolves aliases shared with the lib/assistant tools (PR #36)", () => {
    expect(resolveCommand("add_chart")).toBe("build_dashboard");
    expect(resolveCommand("run_simulation")).toBe("simulate_traffic");
    expect(resolveCommand("send_test_shopper")).toBe("send_shopper");
    expect(resolveCommand("step_loop")).toBe("step_loop");
    expect(resolveCommand("launch_rockets")).toBeUndefined();
    expect(validateStep("run_simulation", { humans: 10 })).toEqual({ ok: true, step: { command: "simulate_traffic", input: { humans: 10, agents: 20 } } });
  });

  it("keeps the store-agent levers in sync with lib/store-agent", () => {
    expect(Object.keys(AGENT_LEVERS).sort()).toEqual(Object.keys(LEVERS).sort());
    for (const [k, label] of Object.entries(AGENT_LEVERS)) expect(label).toBe(LEVERS[k as keyof typeof LEVERS].label);
  });
});

/* ------------------------------------------------------------------ heuristic parser */

const SITES = { tracking: ["trail-shop-co-uk"], web: ["north-trail"] };

describe("heuristic parser", () => {
  const cases: [string, PlanStep[], string?][] = [
    ["build a dashboard of coupon usage per hour for trail-shop", [{ command: "build_dashboard", input: { request: "coupon usage per hour", site: "trail-shop-co-uk" } }]],
    ["send 200 shoppers", [{ command: "simulate_traffic", input: { humans: 200, agents: 0 } }]],
    ["simulate 500 people and 50 agents", [{ command: "simulate_traffic", input: { humans: 500, agents: 50 } }]],
    ["send 1k visitors", [{ command: "simulate_traffic", input: { humans: 1000, agents: 0 } }]],
    ["simulate traffic", [{ command: "simulate_traffic", input: { humans: 200, agents: 20 } }]],
    ["roll back to gen 3", [{ command: "rollback", input: { generation: 3 } }]],
    ["revert to generation 2", [{ command: "rollback", input: { generation: 2 } }]],
    ["why are agents leaving?", [{ command: "ask_darwin", input: { question: "why are agents leaving?" } }]],
    ["turn on autopilot", [{ command: "set_autopilot", input: { on: true } }]],
    ["pause darwin", [{ command: "set_autopilot", input: { on: false } }]],
    ["step the loop 3 times", [{ command: "step_loop", input: { times: 3 } }]],
    ["open issue 2", [{ command: "open_issue", input: { rank: 2 } }]],
    ["show me the top issue", [{ command: "open_issue", input: { rank: 1 } }]],
    ["go to experiments", [{ command: "navigate", input: { page: "experiments" } }]],
    ["dashboards", [{ command: "navigate", input: { page: "dashboards" } }]],
    ["send an AI shopper to find trail shoes under £140 via a2a", [{ command: "send_shopper", input: { brief: "find trail shoes under £140", via: "a2a" } }]],
    ["test one best pick on the store agent with 100 buyers", [{ command: "start_agent_test", input: { lever: "one-pick", buyers: 100 } }]],
    ["turn on the store agent autopilot", [{ command: "set_agent_autopilot", input: { on: true } }]],
    [
      "personalize north-trail: show a free delivery banner to visitors from ads",
      [{ command: "draft_personalization", input: { site: "north-trail", prompt: "show a free delivery banner to visitors from ads" } }],
    ],
    ["brief me", [{ command: "briefing", input: {} }]],
    ["yes, ship it", [{ command: "act_on_briefing", input: { action: "ship" } }]],
    ["stop the test", [{ command: "act_on_briefing", input: { action: "stop" } }]],
    ["what's left on this page?", [{ command: "whats_left", input: { area: "dashboards" } }], "/console/dashboards?site=trail-shop-co-uk"],
    ["what's left to do on the store agent", [{ command: "whats_left", input: { area: "agents" } }]],
    ["hey darwin, can you please chart mobile vs desktop", [{ command: "build_dashboard", input: { request: "mobile vs desktop", site: "trail-shop-co-uk" } }], "/console/dashboards?site=trail-shop-co-uk"],
    [
      "send 200 shoppers then step the loop and show me the issues",
      [
        { command: "simulate_traffic", input: { humans: 200, agents: 0 } },
        { command: "step_loop", input: { times: 1 } },
        { command: "navigate", input: { page: "issues" } },
      ],
    ],
    [
      "turn on autopilot and send 100 people and 10 agents",
      [
        { command: "set_autopilot", input: { on: true } },
        { command: "simulate_traffic", input: { humans: 100, agents: 10 } },
      ],
    ],
  ];

  it.each(cases)("%s", (text, steps, page) => {
    const plan = parseCommand(text, { page, sites: SITES });
    expect(plan.steps).toEqual(steps);
    expect(plan.source).toBe("heuristic");
    expect(plan.say.length).toBeGreaterThan(3);
  });

  it("maps well over 12 phrasings, each to a valid step", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const [text] of cases) for (const s of parseCommand(text, { sites: SITES }).steps) expect(validateStep(s.command, s.input).ok).toBe(true);
  });

  it("never invents numbers: unknown text becomes a question for Darwin", () => {
    expect(parseCommand("hmm, tell me something about my store").steps).toEqual([{ command: "ask_darwin", input: { question: "hmm, tell me something about my store" } }]);
  });

  it("resolves loose site names", () => {
    expect(resolveSite("trail-shop", SITES.tracking)).toBe("trail-shop-co-uk");
    expect(resolveSite("https://www.Trail-Shop.co.uk/", SITES.tracking)).toBe("trail-shop-co-uk");
    expect(resolveSite("unknown-shop", SITES.tracking)).toBe("unknown-shop");
  });
});

/* ------------------------------------------------------------------ roadmap */

describe("roadmap (whats_left)", () => {
  it("maps routes to areas, and every area key is a valid whats_left input", () => {
    expect(roadmapFor("/console")?.key).toBe("overview");
    expect(roadmapFor("/console/issues?id=ins_1")?.key).toBe("issues");
    expect(roadmapFor("/console/pulls")?.key).toBe("changes");
    expect(roadmapFor("/readiness")?.key).toBe("readiness");
    for (const a of ROADMAP) expect(validateStep("whats_left", { area: a.key }).ok).toBe(true);
    expect(validateStep("whats_left", { area: "nope" }).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ /api/command */

describe("/api/command", () => {
  it("GET returns the manifest with JSON Schemas", async () => {
    const body = (await (await GET()).json()) as CommandManifestResponse;
    expect(body.commands.map((c) => c.name).sort()).toEqual([...COMMAND_NAMES].sort());
    expect(body.commands.every((c) => (c.inputSchema as { type?: string }).type === "object")).toBe(true);
    expect(body.context.sites).toHaveProperty("tracking");
  });

  it("plans text with the heuristic parser when no LLM is configured", async () => {
    const res = await post({ text: "send 200 shoppers then roll back to gen 1", page: "/console" });
    expect(res.status).toBe(200);
    const plan = (await res.json()) as CommandPlanResponse;
    expect(plan.source).toBe("heuristic");
    expect(plan.steps.map((s) => [s.command, s.risk])).toEqual([
      ["simulate_traffic", "safe"],
      ["rollback", "confirm"],
    ]);
  });

  it("rejects unknown commands and bad inputs in a steps body", async () => {
    const unknown = await post({ steps: [{ command: "launch_rockets", input: {} }] });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { rejected: { command: string }[] }).rejected[0].command).toBe("launch_rockets");
    const bad = await post({ steps: [{ command: "rollback", input: { generation: "three" } }] });
    expect(bad.status).toBe(400);
    const ok = await post({ steps: [{ command: "add_chart", input: { request: "coupon codes per minute" } }] });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as CommandPlanResponse).steps[0].command).toBe("build_dashboard");
    expect((await post({ nonsense: true })).status).toBe(400);
  });

  it("validates an LLM plan: unknown commands are rejected, risk comes from the registry", async () => {
    llm.on = true;
    llm.generateJson.mockResolvedValue({
      say: "Rolling back and launching.",
      steps: [
        { command: "launch_rockets", input: {} },
        { command: "rollback", input: { generation: 2, risk: "safe" } },
        { command: "simulate_traffic", input: { humans: 99999 } },
      ],
    });
    const plan = await planCommand("roll back to gen 2 and launch rockets");
    expect(plan.source).toBe("llm");
    expect(plan.steps.map((s) => s.command)).toEqual(["rollback"]);
    expect(plan.steps[0].risk).toBe("confirm");
    expect(plan.rejected?.map((r) => r.command)).toEqual(["launch_rockets", "simulate_traffic"]);
  });

  it("falls back to the heuristic parser when the LLM fails or plans nothing valid", async () => {
    llm.on = true;
    llm.generateJson.mockRejectedValueOnce(new Error("boom"));
    expect((await planCommand("open issue 2")).steps[0]).toMatchObject({ command: "open_issue", input: { rank: 2 } });
    llm.generateJson.mockResolvedValueOnce({ say: "", steps: [{ command: "nope", input: {} }] });
    const p = await planCommand("go to settings");
    expect(p.source).toBe("heuristic");
    expect(p.steps[0]).toMatchObject({ command: "navigate", input: { page: "settings" } });
  });
});

/* ------------------------------------------------------------------ WebMCP */

describe("WebMCP", () => {
  it("exposes every command as a tool with a JSON Schema, and confirm tools say so", async () => {
    const exec = vi.fn(async () => ({ ok: true, text: "Opened Issues.", href: "/console/issues" }));
    const tools = webMcpTools(exec);
    expect(tools.map((t) => t.name)).toEqual(COMMAND_NAMES.map((n) => `darwin_${n}`));
    expect(tools.find((t) => t.name === "darwin_rollback")?.description).toMatch(/confirm/i);
    expect(tools.find((t) => t.name === "darwin_briefing")?.annotations?.readOnlyHint).toBe(true);
    const out = await tools.find((t) => t.name === "darwin_navigate")!.execute({ page: "issues" });
    expect(exec).toHaveBeenCalledWith("navigate", { page: "issues" }, { interact: undefined });
    expect(out.content[0]).toEqual({ type: "text", text: "Opened Issues.\nLink: /console/issues" });
  });

  it("registers with registerTool, or provideContext, and cleans up", () => {
    const registered: string[] = [];
    const unregister = vi.fn();
    vi.stubGlobal("navigator", { modelContext: { registerTool: (t: { name: string }) => (registered.push(t.name), { unregister }) } });
    const a = registerWebMcp(async () => ({ ok: true, text: "" }));
    expect(a.registered).toBe(true);
    expect(registered).toHaveLength(COMMAND_NAMES.length);
    a.cleanup();
    expect(unregister).toHaveBeenCalledTimes(COMMAND_NAMES.length);

    const provideContext = vi.fn();
    vi.stubGlobal("navigator", { modelContext: { provideContext } });
    const b = registerWebMcp(async () => ({ ok: true, text: "" }));
    expect(b.registered).toBe(true);
    expect(provideContext.mock.calls[0][0].tools).toHaveLength(COMMAND_NAMES.length);
    b.cleanup();
    expect(provideContext).toHaveBeenLastCalledWith({ tools: [] });

    vi.stubGlobal("navigator", {});
    expect(registerWebMcp(async () => ({ ok: true, text: "" })).registered).toBe(false);
  });

  it("is typed against the same registry (COMMANDS keys = names)", () => {
    expect(Object.keys(COMMANDS)).toEqual(COMMAND_NAMES);
  });
});
