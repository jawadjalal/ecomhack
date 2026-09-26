import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { getSpec } from "@/lib/config";
import { Providers } from "@/components/providers";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Toast } from "@/components/toast";
import { DarwinTag } from "@/components/darwin-tag";
import "./globals.css";

// Every request reads storefront.config.json, so a merged Darwin PR is live without a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Rackd · Wholesale vintage bundles for resellers", template: "%s · Rackd" },
  description: "Wholesale vintage clothing bundles from verified suppliers, for resellers on Depop, Vinted, eBay and Whatnot. A Darwin demo store.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#121212" };

const RADIUS = { none: ["0px", "0px"], md: ["8px", "4px"], full: ["20px", "999px"] } as const;

/** Black or white text, whichever reads better on the accent colour. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0f0f0f" : "#ffffff";
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const spec = getSpec();
  const [radius, radiusSm] = RADIUS[spec.theme.radius];
  const style = { "--accent": spec.theme.accent, "--accent-ink": inkOn(spec.theme.accent), "--radius": radius, "--radius-sm": radiusSm } as CSSProperties;
  return (
    <html lang="en-GB">
      <head>
        {/* Montserrat (SIL Open Font License) from Google Fonts; falls back to the system stack offline. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" />
      </head>
      <body style={style} data-config-version={spec.version}>
        <Providers spec={spec}>
          {spec.announcement.enabled && spec.announcement.text ? (
            <div className="promo announce" id="announcement" data-darwin="announcement">
              {spec.announcement.text}
            </div>
          ) : (
            <div className="promo" id="promo-strip">
              <b>Get £15 off.</b> Use code &quot;FIRSTRACK&quot; on your first order.
              <a href="/#closer">Download app</a>
            </div>
          )}
          <Header />
          <main id="main">{children}</main>
          <Footer spec={spec} />
          <Toast />
        </Providers>
        <DarwinTag />
      </body>
    </html>
  );
}
