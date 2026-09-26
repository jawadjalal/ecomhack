import type { Metadata } from "next";
import { VantaHome } from "@/components/store/vanta/vanta-home";

export const metadata: Metadata = {
  title: "VANTA — Instruments for people who look closely",
  description: "Cameras, audio and wearables machined from titanium, aluminium and glass.",
};

export default function VantaPage() {
  return <VantaHome />;
}
