import type { Metadata } from "next";
import { VoltHome } from "@/components/volt/volt-home";

export const metadata: Metadata = {
  title: "Volt — Good tech. Another great story.",
  description: "Explore thoughtfully renewed phones, laptops and audio at Volt.",
};

export default function VoltPage() {
  return <VoltHome />;
}
