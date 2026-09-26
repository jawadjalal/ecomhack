"use client";

import { CrewLoop } from "@/components/dw/landing/crew-loop";

/** The landing page loop: the five-mascot crew going round observe → diagnose → propose → experiment → ship. */
export function LandingLoop({ className }: { className?: string }) {
  return <CrewLoop className={className} />;
}
