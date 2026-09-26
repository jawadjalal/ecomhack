import type { Metadata } from "next";
import { VantaAfter } from "@/components/store/vanta/vanta-after";

export const metadata: Metadata = {
  title: "VANTA — Instruments for people who look closely",
  description: "Cameras, audio and wearables machined from titanium, aluminium and glass.",
};

export default function VantaAfterPage() {
  return <VantaAfter />;
}
