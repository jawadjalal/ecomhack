/**
 * Agent-to-agent commerce contracts: what AI shoppers see and do, and how we record it.
 */

/** Product as exposed to AI agents. Optional fields depend on PageSpec.agentSurface. */
export interface AgentProduct {
  id: string;
  name: string;
  category: string;
  url: string;
  price: { amount: number; currency: "GBP" };
  rating?: { value: number; count: number };
  attributes: Record<string, string | number | boolean>;
  sizes?: { size: string; inStock: boolean; quantity?: number }[];
  /** Present when agentSurface.exposeDeliveryEta. */
  deliveryEtaDays?: number;
  /** Present when agentSurface.exposeReturnPolicy. */
  returnPolicy?: { days: number; free: boolean };
  /** Present when agentSurface.exposeLandedPrice: price + shipping. */
  landedPrice?: { amount: number; currency: "GBP"; shipping: number };
}

/** A shopping goal handed to a buyer agent (by the simulator or a human principal). */
export interface ShoppingGoal {
  /** Natural language, e.g. "Trail shoes, UK 10, under £120, delivered by Friday". */
  brief: string;
  category?: string;
  maxBudget?: number; // pence
  size?: string;
  /** Needs delivery within N days. */
  deadlineDays?: number;
  /** Will only buy with a free-returns policy. */
  requiresFreeReturns?: boolean;
  /** Will try to negotiate before buying. */
  negotiates?: boolean;
}

export interface NegotiationTurn {
  from: "buyer" | "merchant";
  message: string;
  /** Offer on the table after this turn, pence. */
  offer?: number;
}

export interface AgentSessionSummary {
  sessionId: string;
  agentName: string;
  goal?: ShoppingGoal;
  startedAt: string;
  outcome: "purchased" | "abandoned" | "in_progress";
  reason?: string;
  orderTotal?: number;
  toolCalls: { tool: string; ok: boolean; missing?: string[]; at: string }[];
  negotiation?: NegotiationTurn[];
  experimentId?: string;
  variant?: string;
  synthetic: boolean;
}
