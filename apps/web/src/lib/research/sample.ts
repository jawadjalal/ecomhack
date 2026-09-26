/**
 * The labelled sample report shown when TAVILY_API_KEY is missing. Fictional brands on example.com
 * so it can never be mistaken for real research about a real company.
 */
import type { ResearchReport, ResearchStep } from "@/lib/contracts";
import { id } from "@/lib/ids";

export const NO_KEY_NOTICE =
  "Sample report. Add TAVILY_API_KEY to .env.local to research your real competitors. The brands and numbers below are made up.";

const S = (path: string) => `https://example.com/sample/${path}`;

export function sampleSteps(): ResearchStep[] {
  return [
    {
      id: "search",
      label: "Searching the web",
      status: "skipped",
      detail: "No TAVILY_API_KEY",
    },
    {
      id: "read",
      label: "Reading competitor sites",
      status: "skipped",
      detail: "Sample data",
    },
    {
      id: "summarise",
      label: "Summarising",
      status: "done",
      detail: "Sample data",
    },
  ];
}

export function sampleReport(store: string, query: string): ResearchReport {
  return {
    id: id("rsr"),
    kind: "competitors",
    query,
    store,
    createdAt: new Date().toISOString(),
    mode: "demo",
    demo: true,
    summarizer: "sample",
    notice: NO_KEY_NOTICE,
    summary: {
      text: "Sample: three fictional running-shoe stores compete on delivery promises and fit advice. None of them serve AI shopping agents well, which is an opening.",
      sources: [S("overview")],
    },
    competitors: [
      {
        name: "Stridewell (sample)",
        url: S("stridewell"),
        priceRange: "£85–£165",
        positioning: "Premium road shoes with free gait analysis in store.",
        shipping: "Free next-day delivery over £50",
        returns: "60-day free returns, even if worn",
        strengths: ["Delivery date shown on product page", "Generous returns"],
        weaknesses: ["No agent-readable stock or delivery data"],
        tactics: ["Free-shipping threshold", "Fit / size guidance"],
        agentReadiness: { llmsTxt: false, notes: ["No /llms.txt found"] },
        sources: [S("stridewell")],
      },
      {
        name: "Trailhead Direct (sample)",
        url: S("trailhead"),
        priceRange: "£60–£140",
        positioning: "Discount trail and road shoes, big seasonal sales.",
        shipping: "£4.95 standard, free over £75",
        returns: "30-day returns",
        strengths: ["Lowest prices in the set", "Frequent promo codes"],
        weaknesses: ["Shipping cost only revealed at checkout"],
        tactics: ["Discounts and promo codes", "Buy now, pay later"],
        agentReadiness: {
          llmsTxt: true,
          notes: ["Publishes /llms.txt for AI agents"],
        },
        sources: [S("trailhead")],
      },
      {
        name: "Cadence Running (sample)",
        url: S("cadence"),
        priceRange: "£110–£190",
        positioning: "Carbon racing shoes for marathoners.",
        shipping: "Free delivery on all orders",
        returns: "14-day returns, unworn only",
        strengths: ["Strong reviews on every product"],
        weaknesses: ["Tight returns window"],
        tactics: ["Social proof (reviews/ratings)", "Loyalty rewards"],
        agentReadiness: { llmsTxt: false, notes: ["No /llms.txt found"] },
        sources: [S("cadence")],
      },
    ],
    trends: [
      {
        text: "Sample trend: shoppers expect a delivery date, not just 'free shipping', before they add to bag.",
        sources: [S("trend-delivery")],
      },
      {
        text: "Sample trend: AI assistants now shortlist products for shoppers and favour stores with machine-readable stock and delivery.",
        sources: [S("trend-agents")],
      },
    ],
    suggestions: [
      {
        title: "Show the delivery date before the bag",
        why: "Two of three sample competitors lead with delivery.",
        testIdea:
          "Show a free delivery banner with the threshold and delivery date above the add to cart button",
        audience: "both",
        sources: [S("stridewell"), S("cadence")],
      },
      {
        title: "Give AI agents plain-text stock and delivery",
        why: "Only one sample competitor publishes llms.txt.",
        testIdea:
          "For AI agent visitors, show price, stock and delivery date as plain text at the top of the product page",
        audience: "agents",
        sources: [S("trailhead")],
      },
      {
        title: "Put the returns promise next to the price",
        why: "Generous returns are the sample leader's main hook.",
        testIdea:
          "Add a line under the price: free 60-day returns, even if worn",
        audience: "humans",
        sources: [S("stridewell")],
      },
    ],
    sources: [
      { title: "Stridewell (sample)", url: S("stridewell") },
      { title: "Trailhead Direct (sample)", url: S("trailhead") },
      { title: "Cadence Running (sample)", url: S("cadence") },
    ],
    steps: sampleSteps(),
    followUps: [],
  };
}
