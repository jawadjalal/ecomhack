import { DM_Mono, Outfit } from "next/font/google";
import { AssistantPanel } from "@/components/console/assistant-panel";
import { DemoBadge } from "@/components/demo/demo-badge";

// The design handoff's fonts, scoped to the assistant (the rest of the console keeps Geist).
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["400", "500", "600"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

/**
 * Every console page (mission control, dashboards, personalize, agents, traffic) gets the "Ask Darwin" assistant,
 * and, while nothing of the merchant's is connected, the "Demo store · connect your site" note.
 */
export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <>
      <DemoBadge />
      {children}
      <div className={`${outfit.variable} ${dmMono.variable}`}>
        <AssistantPanel />
      </div>
    </>
  );
}
