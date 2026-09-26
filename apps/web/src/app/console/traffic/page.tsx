import type { Metadata } from "next";
import { TrafficApp } from "@/components/traffic/traffic-app";

export const metadata: Metadata = {
  title: "Darwin · Traffic",
  description: "Where every visitor came from (channel, referring site, search query, campaign, country), human or AI agent, and whether they bought.",
};

/** /console/traffic — first-party traffic analytics for the demo store and every darwin.js site. */
export default function TrafficPage() {
  return <TrafficApp />;
}
