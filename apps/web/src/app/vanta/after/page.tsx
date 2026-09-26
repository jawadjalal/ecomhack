import type { Metadata } from "next";
import { VANTA_AFTER_SPEC, VantaHome } from "@/components/store/vanta/vanta-home";

export const metadata: Metadata = {
  title: "VANTA — Instruments for people who look closely",
  description: "Cameras, audio and wearables machined from titanium, aluminium and glass.",
};

/** Static polished reference. The demo reloads /vanta after Darwin ships — this route does not flip. */
export default function VantaAfterPage() {
  return <VantaHome spec={VANTA_AFTER_SPEC} />;
}
