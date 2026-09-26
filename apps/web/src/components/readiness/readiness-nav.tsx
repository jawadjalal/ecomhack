"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DarwinLogo } from "@/components/dw/mascot";

/** Quiet public nav (same as the landing): the Darwin mark on the left, page actions on the right. */
export function ReadinessNav({ children }: { children?: ReactNode }) {
  return (
    <header className="mx-auto flex h-16 w-full max-w-[1600px] shrink-0 items-center justify-between gap-3 px-4 pt-4 sm:px-7">
      <Link href="/" className="flex items-center gap-2.5 rounded-full focus-visible:outline-2 focus-visible:outline-dw-ink" aria-label="Darwin home">
        <DarwinLogo size={32} />
        <span className="text-[22px] font-semibold tracking-[-0.02em]">darwin</span>
      </Link>
      <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
        {children}
      </nav>
    </header>
  );
}
