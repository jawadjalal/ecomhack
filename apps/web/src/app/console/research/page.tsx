import type { Metadata } from "next";
import { ResearchApp } from "@/components/research/research-app";

export const metadata: Metadata = {
  title: "Darwin · Research",
  description: "Market and competitor research with sources, turned into tests for your store.",
};

/** /console/research?id=… — competitor & market research (Tavily + LLM), with past reports and follow-ups. */
export default async function ResearchPage({ searchParams }: PageProps<"/console/research">) {
  const sp = await searchParams;
  const id = typeof sp.id === "string" && /^rsr_[a-z0-9]{6,20}$/.test(sp.id) ? sp.id : undefined;
  return <ResearchApp initialId={id} />;
}
