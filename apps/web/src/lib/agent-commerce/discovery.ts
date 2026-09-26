/**
 * Discovery documents for AI agents: /llms.txt (markdown) and /.well-known/agent-card.json (A2A-style).
 * Both reflect the spec the requesting agent would be served, so they never promise data the
 * agent surface hides (e.g. delivery times are only described when ETAs are exposed).
 */
import type { PageSpec } from "@/lib/contracts";
import { PRODUCTS, SHIPPING_FEE } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { resolveSpecForVisitor } from "@/lib/spec/resolve";
import { CORS_HEADERS, identityFromHeaders, publicOrigin } from "./http";
import { A2A_PROTOCOL_VERSIONS } from "./a2a";
import { MCP_PROTOCOL_VERSION, MCP_SERVER_INFO } from "./mcp";
import { productUrl } from "./surface";
import { TOOL_META } from "./tools";
import { AGENT_TOOL_NAMES } from "./types";

const STORE_NAME = "PACE Running";
const STORE_BLURB =
  "PACE is a London running brand selling performance running shoes (road, trail, racing) and running accessories, shipped across the UK.";

function toolsFor(spec: PageSpec) {
  return AGENT_TOOL_NAMES.filter((t) => t !== "negotiate" || spec.agentSurface.negotiation.enabled);
}

const yesNo = (v: boolean) => (v ? "yes" : "not exposed");

export function buildLlmsTxt(origin: string, spec: PageSpec): string {
  const s = spec.agentSurface;
  const threshold = spec.cart.freeShippingThreshold;
  const catalog = PRODUCTS.map(
    (p) => `- [${p.name}](${origin}${productUrl(p)}): ${p.category}, ${formatGBP(p.price)} (id \`${p.id}\`). ${p.tagline}`,
  ).join("\n");
  const tools = toolsFor(spec)
    .map((t) => `- \`${t}\`: ${TOOL_META[t].description}`)
    .join("\n");

  const deliveryParts = [`Standard UK delivery ${formatGBP(SHIPPING_FEE)}`];
  if (threshold !== null) deliveryParts.push(`free on orders over ${formatGBP(threshold)}`);
  if (s.exposeDeliveryEta) deliveryParts.push("each product's delivery time is in `deliveryEtaDays`");
  const returns = s.exposeReturnPolicy
    ? "Each product's policy is in `returnPolicy` ({ days, free }). Most footwear has free 60-day returns."
    : "See product pages on the website.";

  return `# ${STORE_NAME}

> ${STORE_BLURB} AI shopping agents can search, check stock, ${s.negotiation.enabled ? "negotiate, " : ""}and buy through MCP or a REST API. All prices are GBP in integer pence (14000 = £140.00).

## Catalog

${catalog}

## Talk to our merchant agent (A2A)

- Endpoint: \`POST ${origin}/api/a2a\` (A2A ${A2A_PROTOCOL_VERSIONS.join(" and ")}, JSON-RPC 2.0: \`SendMessage\` or \`message/send\`). Agent card: \`${origin}/.well-known/agent-card.json\`.
- Say what you need in plain English ("trail shoes, UK 10, under £150, by Friday"); reuse the \`contextId\` from the reply to continue the conversation (it is your cart).
- Then ask about an option ("tell me about the second one"), ${s.negotiation.enabled ? 'make an offer ("would you take £120?"), ' : ""}and say "buy it in UK 10". Replies carry a \`data\` part with the structured products, deal or order.

## Shop via MCP (tools)

- Endpoint: \`POST ${origin}/api/mcp\` (MCP Streamable HTTP, JSON-RPC 2.0, protocol ${MCP_PROTOCOL_VERSION}; JSON responses, no SSE).
- Call \`initialize\`, keep the \`Mcp-Session-Id\` response header and send it on every later request (it is your cart), then \`tools/list\` and \`tools/call\`.
- Optional headers: \`X-Agent-Name\` (who you are), \`X-Agent-Id\` (stable id across sessions).
- Not for shoppers: the store owner's agents drive Darwin itself at \`POST ${origin}/api/darwin/mcp\` (admin only, \`Authorization: Bearer <DARWIN_ADMIN_TOKEN>\`).

Tools:
${tools}

## Shop via REST

- \`GET ${origin}/api/agent/products?query=trail&size=10&maxPrice=14000&want=deliveryEtaDays,landedPrice\`
- \`GET ${origin}/api/agent/products/{id}?want=sizes,returnPolicy\`
- \`POST ${origin}/api/agent/availability\` \`{"id":"p_ridge","size":"10"}\`
- \`POST ${origin}/api/agent/cart\` \`{"id":"p_ridge","size":"10","quantity":1}\` · \`GET ${origin}/api/agent/cart\`
${s.negotiation.enabled ? `- \`POST ${origin}/api/agent/negotiate\` \`{"id":"p_ridge","offer":12000,"message":"..."}\`\n` : ""}- \`POST ${origin}/api/agent/checkout\` \`{"maxTotal":14000}\`
- \`POST ${origin}/api/agent/abandon\` \`{"reason":"..."}\`
- Identify yourself with \`X-Agent-Name\`, \`X-Agent-Id\` and \`X-Agent-Session\` headers; the session is echoed back in \`X-Agent-Session\`.
- Every response is \`{ "ok": boolean, "data"?, "error"?, "missing"? }\`. \`missing\` lists fields you asked for (via \`want\`) that this store does not expose yet.

## What agents can see right now

- Stock per size (\`sizes\`): ${yesNo(s.exposeStock)}
- Delivery ETA (\`deliveryEtaDays\`): ${yesNo(s.exposeDeliveryEta)}
- Return policy (\`returnPolicy\`): ${yesNo(s.exposeReturnPolicy)}
- Landed price incl. shipping (\`landedPrice\`): ${yesNo(s.exposeLandedPrice)}
- Price negotiation: ${s.negotiation.enabled ? `yes, with our merchant agent (up to ${s.negotiation.maxDiscountPct}% off; agreed prices are honoured at checkout)` : "not offered"}

## Policies

- Delivery: ${deliveryParts.join("; ")}.
- Returns: ${returns}
- Orders: checkout places the order immediately. This is a demo store; no payment is taken.
`;
}

/** What the merchant agent can do in conversation (A2A skills). Negotiation only when the spec allows it. */
function agentSkills(spec: PageSpec) {
  const s = spec.agentSurface;
  const skills = [
    {
      id: "shop",
      name: "Personal shopper",
      description:
        "Describe what you need in plain English (category, UK size, budget, deadline) and get a shortlist, using only the product data this store exposes to agents.",
      tags: ["commerce", "running", "search"],
      examples: ["Trail shoes, UK 10, under £150, delivered by Friday", "A carbon race shoe for a marathon, UK 8"],
    },
    {
      id: "product_details",
      name: "Product questions",
      description: "Ask about a product by name or by its number in the last shortlist.",
      tags: ["commerce", "running", "read"],
      examples: ["Tell me more about the second one"],
    },
    ...(s.negotiation.enabled
      ? [
          {
            id: "negotiate",
            name: "Negotiate a price",
            description: `Make an offer and the merchant agent counters within its margin (up to ${s.negotiation.maxDiscountPct}% off). Agreed prices are honoured at checkout.`,
            tags: ["commerce", "running", "negotiation"],
            examples: ["Would you take £120 for the Ridge Trail Pro?"],
          },
        ]
      : []),
    {
      id: "checkout",
      name: "Place an order",
      description: "Order a product in a size; stays within the budget from your brief, delivery included.",
      tags: ["commerce", "running", "write"],
      examples: ["Buy the first one in UK 10"],
    },
  ];
  return skills;
}

export function buildAgentCard(origin: string, spec: PageSpec) {
  const s = spec.agentSurface;
  return {
    protocolVersion: "0.3.0",
    name: `${STORE_NAME} merchant agent`,
    description: `${STORE_BLURB} Search the catalog, check stock and delivery, ${s.negotiation.enabled ? "negotiate prices, " : ""}and place orders.`,
    url: `${origin}/api/a2a`,
    preferredTransport: "JSONRPC",
    version: MCP_SERVER_INFO.version,
    provider: { organization: STORE_NAME, url: origin },
    documentationUrl: `${origin}/llms.txt`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: agentSkills(spec),
    // A2A v1.0 clients read supportedInterfaces; v0.3 clients read url / preferredTransport / protocolVersion.
    supportedInterfaces: A2A_PROTOCOL_VERSIONS.map((v) => ({ url: `${origin}/api/a2a`, protocolBinding: "JSONRPC", protocolVersion: v })),
    additionalInterfaces: [{ url: `${origin}/api/a2a`, transport: "JSONRPC" }],
    /** Non-A2A ways in: MCP tools and a REST API with the same capabilities. */
    endpoints: {
      a2a: `${origin}/api/a2a`,
      mcp: `${origin}/api/mcp`,
      rest: `${origin}/api/agent`,
      llmsTxt: `${origin}/llms.txt`,
    },
    commerce: {
      currency: "GBP",
      amounts: "integer minor units (pence)",
      exposes: {
        stock: s.exposeStock,
        deliveryEta: s.exposeDeliveryEta,
        returnPolicy: s.exposeReturnPolicy,
        landedPrice: s.exposeLandedPrice,
      },
      ...(s.negotiation.enabled ? { negotiation: { enabled: true, maxDiscountPct: s.negotiation.maxDiscountPct } } : {}),
    },
  };
}

/** Shared handler for /.well-known/agent-card.json and the legacy /.well-known/agent.json. */
export function agentCardResponse(req: Request): Response {
  const { spec } = resolveSpecForVisitor(identityFromHeaders(req.headers).agentId);
  return Response.json(buildAgentCard(publicOrigin(req), spec), {
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store" },
  });
}
