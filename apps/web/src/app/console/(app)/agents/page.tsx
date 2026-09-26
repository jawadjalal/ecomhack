import type { Metadata } from "next";
import { headers } from "next/headers";
import { AgentsApp } from "@/components/agents/agents-app";

export const metadata: Metadata = {
  title: "Darwin · Store agent",
  description: "Your Whop store's own AI agent: buyer agents shop it over A2A and pay through tagged checkout links.",
};

/** /console/agents — the store agent: endpoint, catalog, a live chat as a buyer agent, and agent sales. */
export default async function AgentsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") ? "http" : "https");
  return <AgentsApp origin={`${proto}://${host}`} />;
}
