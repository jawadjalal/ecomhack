import type { Metadata } from "next";
import { ReadinessApp } from "@/components/readiness/readiness-app";

export const metadata: Metadata = {
  title: "Agent readiness · Darwin",
  description: "Can AI agents buy from your store? Free check of robots.txt, structured data, llms.txt, MCP and A2A, with the exact fixes.",
};

export default async function ReadinessPage(props: PageProps<"/readiness">) {
  const { url } = await props.searchParams;
  return <ReadinessApp initialUrl={typeof url === "string" ? url.slice(0, 500) : ""} />;
}
