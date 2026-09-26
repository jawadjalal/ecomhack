import type { Metadata } from "next";
import { ConsoleApp } from "@/components/console/console-app";

export const metadata: Metadata = {
  title: "Darwin · Classic mission control",
  description: "Watch Darwin observe, diagnose, propose, A/B test and ship storefront improvements for humans and AI agents.",
};

/** /console/classic — the original mission control. `?mock=1` runs the whole loop in the browser (offline demo fallback). */
export default async function ConsolePage({ searchParams }: PageProps<"/console/classic">) {
  const sp = await searchParams;
  const mock = sp.mock === "1" || sp.mock === "true";
  return <ConsoleApp mock={mock} />;
}
