"use client";

import type { ReactNode } from "react";
import { CommandBar, CommandRuntimeProvider, RunToast } from "./command";
import { AgentModeGate } from "./agent-mode";
import { DarwinProvider } from "./provider";
import { MobileTabBar } from "./mobile-nav";
import { TopNav } from "./top-nav";

/** Cream page + top nav + the shared provider. Pages render their content below the nav. */
export function DarwinShell({ children }: { children: ReactNode }) {
  return (
    <DarwinProvider>
      {/* ⌘K command bar + WebMCP tools + window.darwin (src/components/dw/command) */}
      <CommandRuntimeProvider>
        <div data-dw className="min-h-screen w-full bg-dw-bg font-dw text-dw-ink max-sm:[--dw-tabbar-h:calc(64px+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-[1600px] overflow-x-clip px-4 pt-5 pb-40 max-sm:pt-3 max-sm:pb-[calc(10rem+env(safe-area-inset-bottom))] sm:px-7">
            <TopNav />
            <main className="mt-10 flex flex-col gap-8 max-sm:mt-6 max-sm:gap-6 sm:gap-10"><AgentModeGate>{children}</AgentModeGate></main>
          </div>
          {/* phones: the main nav as a bottom tab bar */}
          <MobileTabBar />
          <CommandBar />
          <RunToast />
        </div>
      </CommandRuntimeProvider>
    </DarwinProvider>
  );
}
