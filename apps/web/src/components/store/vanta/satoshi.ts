import localFont from "next/font/local";

/** Shared by the before and after storefronts so the demo compares design, not typeface. */
export const satoshi = localFont({
  src: [
    { path: "../../../app/store/fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../../app/store/fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../../app/store/fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-vanta",
  display: "swap",
});
