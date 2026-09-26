import { DM_Mono, Outfit } from "next/font/google";
import { AssistantPanel } from "@/components/console/assistant-panel";

// The design handoff's fonts, scoped to the assistant (the rest of the console keeps Geist).
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["400", "500", "600"] });
const dmMono = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"], weight: ["400", "500"] });

/** Every console page (mission control, dashboards, personalize, agents, traffic) gets the team chat (Darwin and his team). */
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
