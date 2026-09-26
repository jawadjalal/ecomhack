import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./store.css";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-pace-display" });

export const metadata: Metadata = {
  title: { default: "PACE — Running shoes designed in London", template: "%s | PACE" },
  description: "Performance running shoes, engineered in London. Free 60-day returns.",
};

/**
 * Layouts don't receive searchParams, so the spec-driven chrome (theme, announcement, header)
 * lives in <StoreShell>, which every store page renders with its resolved StoreContext.
 */
export default function StoreLayout({ children }: LayoutProps<"/store">) {
  return <div className={`${display.variable} flex min-h-full flex-1 flex-col`}>{children}</div>;
}
