import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import "./globals.css";
import { getSpec, themeVars } from "@/lib/spec";
import { BagProvider } from "@/components/bag";
import { GlobalNav } from "@/components/global-nav";
import { DarwinTag } from "@/components/darwin-tag";
import { SpecVersion } from "@/components/track-on-mount";
import { Footer } from "@/components/footer";

export const metadata: Metadata = {
  title: { default: "Orchard (UK)", template: "%s - Orchard (UK)" },
  description: "Orchard phones, laptops, tablets, watches and earbuds. A fictional store for demoing Darwin.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f5f7" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { spec, preview, file, error } = await getSpec();
  return (
    <html lang="en-GB">
      <body style={themeVars(spec) as CSSProperties} data-config-version={spec.version}>
        <BagProvider>
          <SpecVersion version={spec.version} />
          <GlobalNav />
          {spec.announcement.enabled && spec.announcement.text && (
            <section className="ribbon" data-darwin="announcement" id="announcement">
              <p>
                {spec.announcement.text}{" "}
                <Link href="/store" className="more">
                  Shop
                </Link>
              </p>
            </section>
          )}
          <main id="main">{children}</main>
          <Footer spec={spec} file={file} />
          {(preview || error) && (
            <div className="preview-pill" role="status">
              {preview ? (
                <>
                  Previewing presets/{preview}.json · <a href="/preview?config=off">Back to storefront.config.json</a>
                </>
              ) : (
                <>
                  Config problem, showing {file}: {error}
                </>
              )}
            </div>
          )}
        </BagProvider>
        <DarwinTag />
      </body>
    </html>
  );
}
