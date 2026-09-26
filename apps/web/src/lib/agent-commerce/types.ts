/**
 * Types shared inside the agent-commerce module. Everything here is re-exported from `./index`.
 */
import type { AgentProduct } from "@/lib/contracts";

export type AgentToolName =
  | "search_products"
  | "get_product"
  | "check_availability"
  | "add_to_cart"
  | "get_cart"
  | "negotiate"
  | "checkout"
  /** The agent tells the merchant it is leaving without buying, and why. Emits `agent_abandoned`. */
  | "abandon";

export const AGENT_TOOL_NAMES: readonly AgentToolName[] = [
  "search_products",
  "get_product",
  "check_availability",
  "add_to_cart",
  "get_cart",
  "negotiate",
  "checkout",
  "abandon",
];

/** How the agent reached us. Stamped on events as `properties.channel`. */
export type AgentChannel = "rest" | "mcp" | "a2a" | "in-process";

export interface AgentContext {
  /** Stable id for the agent (distinct_id). Also the experiment-assignment key. */
  agentId: string;
  agentName: string;
  sessionId: string;
  synthetic?: boolean;
  persona?: string;
  /** Transport, for the console. Default "in-process". */
  channel?: AgentChannel;
  /**
   * Clock (ISO-8601) used for event and session timestamps. The simulator can pass one to
   * spread synthetic traffic over time; defaults to the real time.
   */
  now?: () => string;
}

/** Why a tool call failed (REST maps these to HTTP statuses). */
export type AgentToolErrorCode =
  | "invalid_args"
  | "not_found"
  | "not_exposed"
  | "out_of_stock"
  | "empty_cart"
  | "over_budget"
  | "unknown_tool";

export interface AgentToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Fields the agent asked for that the current agentSurface does not expose. */
  missing?: string[];
  code?: AgentToolErrorCode;
}

/** Signature shared by in-process calls, the MCP client in scripts/grok-shopper.ts and tests. */
export type ToolCaller = (tool: AgentToolName, args: Record<string, unknown>) => Promise<AgentToolResult>;

/** Optional AgentProduct fields an agent can ask for in `want`, and the surface flag that controls each. */
export const WANTABLE_FIELDS = ["sizes", "deliveryEtaDays", "returnPolicy", "landedPrice"] as const;
export type WantableField = (typeof WANTABLE_FIELDS)[number];

/**
 * Every value that can appear in `missing`, mapped to the PageSpec path that would fix it.
 * The optimizer uses this to turn "agents keep asking for X" into a SpecPatch.
 */
export const MISSING_FIELD_SURFACE = {
  sizes: "agentSurface.exposeStock",
  stock: "agentSurface.exposeStock",
  deliveryEtaDays: "agentSurface.exposeDeliveryEta",
  returnPolicy: "agentSurface.exposeReturnPolicy",
  landedPrice: "agentSurface.exposeLandedPrice",
  negotiation: "agentSurface.negotiation.enabled",
} as const;
export type MissingField = keyof typeof MISSING_FIELD_SURFACE;

/** get_product returns the agent view plus copy an LLM can reason about. */
export type AgentProductDetail = AgentProduct & {
  tagline: string;
  description: string;
  features: string[];
  colors: string[];
  compareAtPrice?: number;
};

export interface CartLine {
  productId: string;
  name: string;
  size: string;
  quantity: number;
  /** Unit price actually charged (list price or negotiated deal), pence. */
  unitPrice: number;
  listPrice: number;
}

export interface CartView {
  items: CartLine[];
  subtotal: number;
  /** Present when the surface exposes landed prices. */
  shipping?: number;
  total?: number;
  currency: "GBP";
  note?: string;
}

export interface AgentOrder {
  orderId: string;
  items: CartLine[];
  subtotal: number;
  /** Savings vs list prices from negotiation, pence. */
  discount: number;
  shipping: number;
  total: number;
  currency: "GBP";
  /** Slowest item's delivery time. */
  deliveryEtaDays: number;
  createdAt: string;
}

export interface NegotiationOutcome {
  /** accepted = deal agreed; counter = merchant moved; final = merchant will not go lower. */
  status: "accepted" | "counter" | "final";
  productId: string;
  round: number;
  listPrice: number;
  offer: number;
  /** Merchant's price on the table, pence. */
  counterOffer?: number;
  /** Set when accepted: the unit price the agent will be charged at checkout. */
  agreedPrice?: number;
  message: string;
  /** Sweetener: add this product at a reduced price once the deal is agreed. */
  bundle?: { productId: string; name: string; price: number; listPrice: number };
}

export interface AvailabilityView {
  productId: string;
  size: string;
  inStock: boolean;
  quantity: number;
  deliveryEtaDays?: number;
}
