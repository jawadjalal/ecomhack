"use client";

import type { ReactNode } from "react";
import { DarwinProvider } from "./provider";
import { TopNav } from "./top-nav";

/** Cream page + top nav + the shared provider. Pages render their content below the nav. */
export function DarwinShell({ children }: { children: ReactNode }) {
  return (
    <DarwinProvider>
      <div data-dw className="min-h-screen w-full bg-dw-bg font-dw text-dw-ink">
        <div className="mx-auto w-full max-w-[1600px] px-4 pt-5 pb-40 sm:px-7">
          <TopNav />
          <main className="mt-8 flex flex-col gap-4">{children}</main>
        </div>
      </div>
    </DarwinProvider>
  );
}
