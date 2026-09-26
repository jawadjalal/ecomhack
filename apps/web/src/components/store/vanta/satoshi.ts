import localFont from "next/font/local";

/** Shared by the before and after storefronts so the demo compares design, not typeface. */
export const satoshi = localFont({
  src: [
    { path: "../../../fonts/satoshi-regular.woff2", weight: "400", style: "normal" },
    { path: "../../../fonts/satoshi-medium.woff2", weight: "500", style: "normal" },
    { path: "../../../fonts/satoshi-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-vanta",
  display: "swap",
});
