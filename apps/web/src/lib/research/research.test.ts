import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({
  available: false,
  json: vi.fn(),
  loop: vi.fn(),
}));
vi.mock("@/lib/llm/client", () => ({
  llmAvailable: () => llm.available,
  llmLabel: () => (llm.available ? "llm:test-model" : "heuristic"),
  generateJson: llm.json,
  runToolLoop: llm.loop,
  toolFromZod: (name: string, description: string) => ({
    name,
    description,
    parameters: { type: "object" },
  }),
  extractJson: (t: string) => JSON.parse(t),
}));

import {
  askResearch,
  getReport,
  listReports,
  researchCompetitors,
} from "./index";
import {
  brandName,
  pickCompetitors,
  priceRange,
  returnsOffer,
  shippingOffer,
} from "./heuristics";

const SEARCH = {
  results: [
    {
      title: "Stride Running | Road shoes",
      url: "https://stride.example/shoes",
      content:
        "Stride sells road shoes from £90 to £150. Free delivery over £50.",
    },
    {
      title: "Reddit thread",
      url: "https://www.reddit.com/r/running/1",
      content: "Where to buy running shoes?",
    },
    {
      title: "Cadence - Racing shoes",
      url: "https://cadence.example/",
      content: "Carbon racers. 30-day returns on all orders.",
    },
  ],
};
const TRENDS = {
  results: [
    {
      title: "Delivery trends",
      url: "https://news.example/delivery",
      content:
        "Shoppers now expect a delivery date before checkout. More detail follows.",
    },
  ],
};
const EXTRACT = {
  results: [
    {
      url: "https://stride.example/shoes",
      raw_content:
        "Stride. Rated 4.8 stars by 2,000 reviews. Klarna available. £120",
    },
    {
      url: "https://stride.example/llms.txt",
      raw_content:
        "# Stride\n> Running shoes. Products: /shoes. Delivery: 2 days.",
    },
    {
      url: "https://cadence.example/",
      raw_content: "Cadence racing shoes £180",
    },
  ],
};

function mockFetch() {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      query?: string;
      include_answer?: boolean;
    };
    if (url.endsWith("/extract")) return Response.json(EXTRACT);
    if (body.include_answer)
      return Response.json({
        answer: "Most shoppers expect delivery in 2-3 days.",
        results: TRENDS.results,
      });
    if (body.query?.includes("trends")) return Response.json(TRENDS);
    return Response.json(SEARCH);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  llm.available = false;
  llm.json.mockReset();
  llm.loop.mockReset();
  vi.stubEnv("TAVILY_API_KEY", "tvly-test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("heuristics", () => {
  it("extracts prices, offers and names", () => {
    expect(priceRange("from £90 to £150, sale £75")).toBe("£75–£150");
    expect(priceRange("no prices")).toBeUndefined();
    expect(shippingOffer("Free delivery over £50. Other text")).toMatch(
      /Free delivery over £50/,
    );
    expect(returnsOffer("We offer 30-day returns on all orders.")).toMatch(
      /30-day returns/,
    );
    expect(
      brandName("Stride Running | Road shoes", "https://stride.example"),
    ).toBe("Stride Running");
  });

  it("skips forums and the merchant's own domain", () => {
    const picked = pickCompetitors(
      SEARCH.results.map((r) => ({ ...r })),
      { exclude: "https://cadence.example" },
    );
    expect(picked.map((p) => p.url)).toEqual(["https://stride.example/shoes"]);
  });
});

describe("researchCompetitors", () => {
  it("returns a labelled sample report without TAVILY_API_KEY and never calls the network", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const f = mockFetch();
    const r = await researchCompetitors({ query: "Who are my competitors?" });
    expect(r.demo).toBe(true);
    expect(r.mode).toBe("demo");
    expect(r.notice).toMatch(/TAVILY_API_KEY/);
    expect(
      r.competitors.every((c) => c.url.startsWith("https://example.com/")),
    ).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("builds a heuristic report with sources when there's no LLM", async () => {
    const f = mockFetch();
    const steps: string[] = [];
    const r = await researchCompetitors({
      store: "PACE running shoes",
      query: "Who are my competitors?",
      onStep: (s) => steps.push(`${s.id}:${s.status}`),
    });
    expect(f.mock.calls[0][0]).toBe("https://api.tavily.com/search");
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      authorization: "Bearer tvly-test",
    });
    expect(r.demo).toBe(false);
    expect(r.summarizer).toBe("heuristic");
    expect(r.competitors.map((c) => c.name)).toEqual([
      "Stride Running",
      "Cadence",
    ]);
    const stride = r.competitors[0];
    expect(stride.priceRange).toBe("£90–£150");
    expect(stride.agentReadiness.llmsTxt).toBe(true);
    expect(r.competitors[1].agentReadiness.llmsTxt).toBe(false);
    expect(stride.tactics).toContain("Buy now, pay later");
    for (const c of [...r.competitors, ...r.trends, ...r.suggestions])
      expect(c.sources.length).toBeGreaterThan(0);
    expect(r.suggestions.some((s) => s.audience === "agents")).toBe(true);
    expect(steps).toContain("summarise:done");
    expect(getReport(r.id)?.id).toBe(r.id);
    expect(listReports()[0].id).toBe(r.id);
  });

  it("uses the LLM but drops sources it didn't fetch and keeps llms.txt from our own check", async () => {
    mockFetch();
    llm.available = true;
    llm.json.mockResolvedValueOnce({
      summary: {
        text: "Two rivals.",
        sources: ["https://stride.example/shoes", "https://made-up.example/"],
      },
      competitors: [
        {
          name: "Stride",
          url: "https://stride.example/shoes",
          priceRange: "£90–£150",
          strengths: ["Fast delivery"],
          weaknesses: [],
          tactics: [],
          agentNotes: ["Has llms.txt? no"],
          sources: ["https://stride.example/shoes"],
        },
        {
          name: "Ghost",
          url: "https://ghost.example/",
          strengths: [],
          weaknesses: [],
          tactics: [],
          agentNotes: [],
          sources: ["https://ghost.example/"],
        },
      ],
      trends: [
        {
          text: "Delivery dates matter.",
          sources: ["https://news.example/delivery"],
        },
        { text: "Unsourced claim.", sources: [] },
      ],
      suggestions: [
        {
          title: "Show ETA",
          why: "Rivals do",
          testIdea: "Show delivery date above add to cart",
          audience: "both",
          sources: ["https://stride.example/shoes"],
        },
      ],
    });
    const r = await researchCompetitors({ store: "PACE" });
    expect(r.summarizer).toBe("llm:test-model");
    expect(r.summary.sources).toEqual(["https://stride.example/shoes"]);
    expect(r.competitors.map((c) => c.name)).toEqual(["Stride"]);
    expect(r.competitors[0].agentReadiness.llmsTxt).toBe(true);
    expect(r.trends).toHaveLength(1);
    expect(r.suggestions[0].title).toBe("Show ETA");
  });

  it("falls back to heuristics when the LLM throws", async () => {
    mockFetch();
    llm.available = true;
    llm.json.mockRejectedValueOnce(new Error("boom"));
    const r = await researchCompetitors({ store: "PACE" });
    expect(r.summarizer).toBe("heuristic");
    expect(r.competitors).toHaveLength(2);
  });
});

describe("askResearch", () => {
  it("answers with cited sources and appends follow-ups to a parent report", async () => {
    mockFetch();
    const q = await askResearch({
      question: "What do shoppers expect from delivery?",
    });
    expect(q.kind).toBe("question");
    expect(q.summary.text).toMatch(/2-3 days/);
    expect(q.summary.sources).toEqual(["https://news.example/delivery"]);

    const parent = await researchCompetitors({ store: "PACE" });
    const updated = await askResearch({
      question: "Who has the best returns?",
      parentId: parent.id,
    });
    expect(updated.id).toBe(parent.id);
    expect(updated.followUps).toHaveLength(1);
    expect(updated.followUps[0].sources.length).toBeGreaterThan(0);
  });

  it("lets the model dig deeper with bounded searches and reads, citing only fetched URLs", async () => {
    const fetchFn = mockFetch();
    llm.available = true;
    llm.loop.mockImplementation(
      async (req: {
        tools: { name: string }[];
        execute: (c: {
          id: string;
          name: string;
          args: Record<string, unknown>;
        }) => Promise<{ content: string }>;
      }) => {
        expect(req.tools.map((t) => t.name)).toEqual([
          "web_search",
          "read_pages",
        ]);
        const found = await req.execute({
          id: "1",
          name: "web_search",
          args: { query: "running shoe returns" },
        });
        expect(found.content).toContain("https://cadence.example/");
        await req.execute({
          id: "2",
          name: "web_search",
          args: { query: "again" },
        });
        expect(
          (
            await req.execute({
              id: "3",
              name: "web_search",
              args: { query: "third" },
            })
          ).content,
        ).toMatch(/limit/);
        expect(
          (
            await req.execute({
              id: "4",
              name: "read_pages",
              args: { urls: ["http://169.254.169.254/latest"] },
            })
          ).content,
        ).toMatch(/only URLs/);
        const read = await req.execute({
          id: "5",
          name: "read_pages",
          args: { urls: ["https://cadence.example/"] },
        });
        expect(read.content).toContain("Cadence racing shoes");
        return {
          text: JSON.stringify({
            answer: "Cadence offers 30-day returns.",
            sources: ["https://cadence.example/", "https://made-up.example/"],
          }),
          mode: "native",
          steps: 3,
          calls: [],
          stopped: false,
        };
      },
    );
    const q = await askResearch({ question: "Who has the best returns?" });
    expect(q.summary).toEqual({
      text: "Cadence offers 30-day returns.",
      sources: ["https://cadence.example/"],
    });
    expect(q.summarizer).toBe("llm:test-model");
    expect(q.sources.map((s) => s.url)).toContain("https://cadence.example/");
    const searches = fetchFn.mock.calls.filter(([u]) =>
      String(u).endsWith("/search"),
    );
    expect(searches).toHaveLength(3); // the first search + 2 model searches (third refused)
  });

  it("rejects unknown parents and labels demo answers", async () => {
    mockFetch();
    await expect(
      askResearch({ question: "x?", parentId: "rsr_missing000" }),
    ).rejects.toThrow(/not found/);
    vi.stubEnv("TAVILY_API_KEY", "");
    const d = await askResearch({ question: "Anything?" });
    expect(d.demo).toBe(true);
    expect(d.summary.text).toMatch(/TAVILY_API_KEY/);
  });
});
