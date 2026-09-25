/**
 * Tool definitions: argument schemas (zod → JSON Schema for MCP), titles and descriptions.
 * One source of truth for the dispatcher, the MCP server, discovery docs and LLM prompts.
 */
import { z } from "zod";
import type { AgentToolName } from "./types";

const productRef = z
  .string()
  .min(1)
  .describe("Product id from search_products (e.g. 'p_ridge'). Slugs and exact names also work.");
const size = z
  .union([z.string(), z.number()])
  .describe("UK size as listed by the store, e.g. '10'. Accessories use 'One size', 'S/M' or 'L/XL'.");
const want = z
  .array(z.string())
  .describe(
    "Fields you need to decide: sizes (stock per size), deliveryEtaDays, returnPolicy, landedPrice (price incl. shipping). " +
      "Any the store does not expose are listed in `missing` so the merchant can fix it.",
  );
const money = (what: string) => z.coerce.number().positive().describe(`${what}, in pence (14000 = £140.00).`);

export const TOOL_SCHEMAS = {
  search_products: z.object({
    query: z.string().max(200).optional().describe("Free text, e.g. 'waterproof trail'."),
    category: z.string().optional().describe("One of: road, trail, racing, accessories, shoes (= all footwear)."),
    maxPrice: money("Maximum list price").optional(),
    size: size.optional(),
    terrain: z.string().optional().describe("road or trail."),
    want: want.optional(),
  }),
  get_product: z.object({ id: productRef, want: want.optional() }),
  check_availability: z.object({ id: productRef, size }),
  add_to_cart: z.object({
    id: productRef,
    size: size.optional(),
    quantity: z.coerce.number().int().min(1).max(10).default(1).describe("Units, 1-10."),
  }),
  get_cart: z.object({}),
  negotiate: z.object({
    id: productRef,
    offer: money("Your offer for one unit"),
    message: z.string().max(500).optional().describe("Optional message to the merchant agent."),
  }),
  checkout: z.object({
    maxTotal: money("Refuse to place the order if the total incl. shipping is above this").optional(),
  }),
  abandon: z.object({
    reason: z.string().min(1).max(300).describe("Why you are leaving without buying, e.g. 'no delivery ETA; need it by Friday'."),
  }),
} satisfies Record<AgentToolName, z.ZodObject>;

export type ToolArgs<T extends AgentToolName> = z.output<(typeof TOOL_SCHEMAS)[T]>;

export interface ToolMeta {
  name: AgentToolName;
  title: string;
  description: string;
  readOnly: boolean;
}

export const TOOL_META: Record<AgentToolName, ToolMeta> = {
  search_products: {
    name: "search_products",
    title: "Search products",
    description:
      "Search the PACE running catalog. Returns products with price in pence. Pass `want` with the fields you need " +
      "(sizes, deliveryEtaDays, returnPolicy, landedPrice); hidden ones come back in `missing`.",
    readOnly: true,
  },
  get_product: {
    name: "get_product",
    title: "Get product",
    description: "Full details for one product (description, features, attributes, plus any exposed stock/delivery/returns/landed price).",
    readOnly: true,
  },
  check_availability: {
    name: "check_availability",
    title: "Check availability",
    description: "Check whether a size is in stock. Fails with missing:['stock'] when the store does not expose stock levels.",
    readOnly: true,
  },
  add_to_cart: {
    name: "add_to_cart",
    title: "Add to cart",
    description: "Add a product in a size to your session cart. A negotiated price for that product is applied automatically.",
    readOnly: false,
  },
  get_cart: {
    name: "get_cart",
    title: "View cart",
    description: "Show the cart for this session with subtotal (and shipping/total when the store exposes landed prices).",
    readOnly: true,
  },
  negotiate: {
    name: "negotiate",
    title: "Negotiate price",
    description:
      "Make an offer (pence, per unit) to the merchant agent. It counters or accepts; counters converge within 3 rounds. " +
      "An accepted price is held for this session and honoured at checkout. Fails with missing:['negotiation'] when the store has negotiation off.",
    readOnly: false,
  },
  checkout: {
    name: "checkout",
    title: "Checkout",
    description:
      "Place the order for everything in the cart. Pass maxTotal (pence) to refuse the order if the total incl. shipping is over your budget.",
    readOnly: false,
  },
  abandon: {
    name: "abandon",
    title: "Leave without buying",
    description: "Tell the merchant you're leaving and why. Helps the store fix what stopped you buying.",
    readOnly: false,
  },
};

/** JSON Schema (draft 2020-12 subset) for a tool's arguments, as MCP `inputSchema`. */
export function toolInputSchema(tool: AgentToolName): Record<string, unknown> {
  const schema = z.toJSONSchema(TOOL_SCHEMAS[tool], { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return stripNoise(schema) as Record<string, unknown>;
}

/** Drop zod's default safe-integer bound; it only adds noise for LLM clients. */
function stripNoise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNoise);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "maximum" && v === Number.MAX_SAFE_INTEGER) continue;
    if (k === "minimum" && v === Number.MIN_SAFE_INTEGER) continue;
    out[k] = stripNoise(v);
  }
  return out;
}
