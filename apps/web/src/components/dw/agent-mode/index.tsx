"use client";

/**
 * Human / Agent mode. <AgentModeGate> wraps the console page content once (src/components/dw/shell.tsx): in human mode
 * it renders the page as usual; in agent mode it keeps the page mounted but hidden and shows <AgentView> in its place
 * (the header stays). It also mounts the bottom-left <ModeToggle>.
 */
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AgentView } from "./agent-view";
import { syncModeFromUrl, useViewMode } from "./mode";
import { ModeToggle } from "./toggle";

export { useViewMode, setViewMode, type ViewMode } from "./mode";

export function AgentModeGate({ children }: { children: ReactNode }) {
  const mode = useViewMode();
  const pathname = usePathname();
  useEffect(() => {
    syncModeFromUrl();
  }, [pathname]);

  return (
    <>
      <div className="contents" hidden={mode === "agent"} data-human-view="">
        {children}
      </div>
      {mode === "agent" && <AgentView />}
      <ModeToggle />
    </>
  );
}
