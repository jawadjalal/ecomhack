import type { Metadata } from "next";
import localFont from "next/font/local";
import "./store.css";

/** Satoshi (Fontshare), self-hosted. Weights 300–900. */
const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/Satoshi-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
  fallback: ["Arial", "Helvetica Neue", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "PACE — Running shoes designed in London", template: "%s | PACE" },
  description: "Performance running shoes, engineered in London. Free 60-day returns.",
};

/**
 * Layouts don't receive searchParams, so the spec-driven chrome (theme, announcement, header)
 * lives in <StoreShell>, which every store page renders with its resolved StoreContext.
 */
export default function StoreLayout({ children }: LayoutProps<"/store">) {
  return <div className={`${satoshi.variable} flex min-h-full flex-1 flex-col`}>{children}</div>;
}
