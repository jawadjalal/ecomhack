import { DM_Mono, Outfit } from "next/font/google";
import { AssistantPanel } from "@/components/console/assistant-panel";

// The design handoff's fonts, scoped to the assistant (the rest of the console keeps Geist).
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["400", "500", "600"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

/**
 * Every console page (mission control, dashboards, personalize, agents, traffic) gets the "Ask Darwin" assistant.
 * The "which store is this" note lives in the header only (StoreChip in top-nav: a pill from 640px, a bar on
 * phones), so the console no longer mounts DemoBadge: it said the same thing a second time.
 * The account menu (top-nav) repeats the demo status in one line, next to the in-browser demo switch.
 */
export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <>
      {children}
      <div className={`${outfit.variable} ${dmMono.variable}`}>
        <AssistantPanel />
      </div>
    </>
  );
}
