import { describe, expect, it } from "vitest";
import {
  REPRESENTATIVE_LAYOUT,
  assumedDetection,
  buildInstallPrBody,
  detectFramework,
  injectHtml,
  injectNextAppLayout,
  injectNextDocument,
  injectNextPagesApp,
  planInstall,
} from "./install";

const S = { src: "https://darwin.example.com/darwin.js", siteId: "acme-storefront" };
const TAG = '<script src="https://darwin.example.com/darwin.js" data-darwin-site="acme-storefront" defer></script>';

describe("detectFramework", () => {
  it("Next.js App Router at the repo root", () => {
    const d = detectFramework(["app/layout.tsx", "app/page.tsx", "next.config.ts", "package.json"]);
    expect(d).toMatchObject({ framework: "nextjs-app", root: "", targets: ["app/layout.tsx"] });
    expect(d.evidence).toContain("next.config.ts");
  });

  it("Next.js App Router with src/ in a monorepo, preferring the app with a next.config", () => {
    const d = detectFramework([
      "packages/ui/src/app/layout.tsx",
      "apps/web/src/app/layout.tsx",
      "apps/web/next.config.ts",
      "apps/web/src/app/store/layout.tsx",
      "node_modules/next/app/layout.js",
    ]);
    expect(d).toMatchObject({ framework: "nextjs-app", root: "apps/web", targets: ["apps/web/src/app/layout.tsx"] });
  });

  it("hybrid App + Pages Router wires both", () => {
    const d = detectFramework(["app/layout.jsx", "pages/_app.jsx", "next.config.mjs"]);
    expect(d.targets).toEqual(["app/layout.jsx", "pages/_app.jsx"]);
  });

  it("Next.js Pages Router prefers _app, falls back to _document", () => {
    expect(detectFramework(["pages/_app.tsx", "pages/_document.tsx", "pages/index.tsx", "next.config.js"])).toMatchObject({
      framework: "nextjs-pages",
      targets: ["pages/_app.tsx"],
    });
    expect(detectFramework(["src/pages/_document.js", "src/pages/index.js"])).toMatchObject({
      framework: "nextjs-pages",
      targets: ["src/pages/_document.js"],
    });
  });

  it("Vite + React", () => {
    const d = detectFramework(["index.html", "vite.config.ts", "src/main.tsx", "src/App.tsx", "public/favicon.svg"]);
    expect(d).toMatchObject({ framework: "vite", label: "Vite + React", targets: ["index.html"] });
  });

  it("plain HTML tags every page (capped)", () => {
    const d = detectFramework(["index.html", "about.html", "shop/product.html", "css/site.css"]);
    expect(d).toMatchObject({ framework: "html", targets: ["index.html", "about.html", "shop/product.html"] });
    const many = detectFramework(["index.html", ...Array.from({ length: 30 }, (_, i) => `p${i}.html`)]);
    expect(many.targets).toHaveLength(20);
  });

  it("Shopify theme", () => {
    const d = detectFramework(["layout/theme.liquid", "sections/header.liquid", "config/settings_schema.json"]);
    expect(d).toMatchObject({ framework: "shopify", targets: ["layout/theme.liquid"] });
  });

  it("unknown → DARWIN.md, ignoring vendored and build directories", () => {
    expect(detectFramework(["README.md", "main.go", "node_modules/x/index.html", "dist/index.html"])).toMatchObject({
      framework: "unknown",
      targets: ["DARWIN.md"],
    });
  });
});

describe("injectNextAppLayout", () => {
  it("adds next/script with afterInteractive before </body>", () => {
    const out = injectNextAppLayout(
      `import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
`,
      S,
    )!;
    expect(out).toBe(`import Script from "next/script";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Darwin: conversion analytics for human shoppers and AI shopping agents */}
        <Script
          src="https://darwin.example.com/darwin.js"
          data-darwin-site="acme-storefront"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
`);
  });

  it("expands an inline <body>{children}</body> and keeps CSS imports last", () => {
    const out = injectNextAppLayout(REPRESENTATIVE_LAYOUT, S)!;
    expect(out).toContain(`import type { Metadata } from "next";\nimport Script from "next/script";\nimport "./globals.css";`);
    expect(out).toContain(`      <body>
        {children}
        {/* Darwin: conversion analytics for human shoppers and AI shopping agents */}
        <Script
          src="https://darwin.example.com/darwin.js"`);
    expect(out).toContain(`          strategy="afterInteractive"\n        />\n      </body>\n    </html>`);
  });

  it("keeps attributes on an inline body", () => {
    const out = injectNextAppLayout(
      `import type { Metadata } from "next";\nexport default function L({ children }) {\n  return (\n    <html>\n      <body className="min-h-full flex flex-col">{children}</body>\n    </html>\n  );\n}\n`,
      S,
    )!;
    expect(out).toContain(`      <body className="min-h-full flex flex-col">\n        {children}\n        {/* Darwin`);
  });

  it("is idempotent", () => {
    const once = injectNextAppLayout(REPRESENTATIVE_LAYOUT, S)!;
    expect(injectNextAppLayout(once, S)).toBe(once);
    expect(injectNextAppLayout(once, { ...S, src: "https://other.host/darwin.js" })).toBe(once);
  });

  it("reuses an existing next/script import", () => {
    const src = `import NextScript from "next/script";\nexport default function L({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`;
    const out = injectNextAppLayout(src, S)!;
    expect(out.match(/next\/script/g)).toHaveLength(1);
    expect(out).toContain("<NextScript\n");
  });

  it("avoids clashing with an existing Script identifier and matches quote/semicolon style", () => {
    const src = `import { Script } from './ui'\n\nexport default function L({ children }) {\n  return (\n    <html>\n      <body>\n        <Script />\n        {children}\n      </body>\n    </html>\n  )\n}\n`;
    const out = injectNextAppLayout(src, S)!;
    expect(out).toContain(`import { Script } from './ui'\nimport DarwinScript from 'next/script'\n`);
    expect(out).toContain("<DarwinScript\n");
  });

  it("adds the import after a 'use client' directive when there are no imports", () => {
    const out = injectNextAppLayout(`"use client";\nexport default function L({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`, S)!;
    expect(out.startsWith(`"use client";\nimport Script from "next/script";\n`)).toBe(true);
  });

  it("returns null when there is no <body>", () => {
    expect(injectNextAppLayout(`export default function L({ children }) { return children; }`, S)).toBeNull();
  });
});

describe("Pages Router", () => {
  it("wraps a bare <Component /> return in a fragment", () => {
    const out = injectNextPagesApp(
      `import type { AppProps } from "next/app";

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
`,
      S,
    )!;
    expect(out).toContain(`import type { AppProps } from "next/app";\nimport Script from "next/script";`);
    expect(out).toContain(`  return (
    <>
      <Component {...pageProps} />
      {/* Darwin: conversion analytics for human shoppers and AI shopping agents */}
      <Script
        src="https://darwin.example.com/darwin.js"
        data-darwin-site="acme-storefront"
        strategy="afterInteractive"
      />
    </>
  );`);
    expect(injectNextPagesApp(out, S)).toBe(out);
  });

  it("handles return ( <Component /> ) and nested layouts", () => {
    const parens = injectNextPagesApp(`export default function App({ Component, pageProps }) {\n  return (\n    <Component {...pageProps} />\n  );\n}\n`, S)!;
    expect(parens).toContain(`  return (\n    <>\n      <Component {...pageProps} />\n      {/* Darwin`);
    expect(parens).toContain(`      />\n    </>\n  );`);

    const nested = injectNextPagesApp(
      `export default function App({ Component, pageProps }) {\n  return (\n    <Layout>\n      <Component {...pageProps} />\n    </Layout>\n  );\n}\n`,
      S,
    )!;
    expect(nested).toContain(`      <Component {...pageProps} />\n      {/* Darwin`);
    expect(nested).toContain(`      />\n    </Layout>`);
  });

  it("_document gets a deferred script in <Head>", () => {
    const out = injectNextDocument(
      `import { Html, Head, Main, NextScript } from "next/document";\n\nexport default function Document() {\n  return (\n    <Html lang="en">\n      <Head>\n      </Head>\n      <body>\n        <Main />\n        <NextScript />\n      </body>\n    </Html>\n  );\n}\n`,
      S,
    )!;
    expect(out).toContain(`      <Head>\n        <script src="https://darwin.example.com/darwin.js" data-darwin-site="acme-storefront" defer />\n      </Head>`);
    const selfClosing = injectNextDocument(`      <Head />\n`, S)!;
    expect(selfClosing).toContain(`<Head>\n        <script src=`);
  });
});

describe("HTML, Vite and Shopify", () => {
  it("adds a deferred script before </head>, idempotently", () => {
    const html = `<!doctype html>\n<html>\n  <head>\n    <title>Shop</title>\n  </head>\n  <body></body>\n</html>\n`;
    const out = injectHtml(html, S)!;
    expect(out).toBe(`<!doctype html>\n<html>\n  <head>\n    <title>Shop</title>\n    ${TAG}\n  </head>\n  <body></body>\n</html>\n`);
    expect(injectHtml(out, S)).toBe(out);
  });

  it("works for theme.liquid", () => {
    const liquid = `<html>\n<head>\n  {{ content_for_header }}\n</head>\n<body>{{ content_for_layout }}</body>\n</html>`;
    expect(injectHtml(liquid, S)).toContain(`  {{ content_for_header }}\n  ${TAG}\n</head>`);
  });

  it("falls back to </body>, then gives up", () => {
    expect(injectHtml(`<body>\n  <p>x</p>\n</body>`, S)).toContain(`  ${TAG}\n</body>`);
    expect(injectHtml(`<p>fragment</p>`, S)).toBeNull();
  });
});

describe("planInstall", () => {
  it("edits every target and reports already-installed files", () => {
    const d = detectFramework(["index.html", "about.html"]);
    const plan = planInstall(d, { "index.html": "<html><head></head></html>", "about.html": `<head>${TAG}</head>` }, S);
    expect(plan.files.map((f) => f.path)).toEqual(["index.html"]);
    expect(plan.alreadyInstalled).toEqual(["about.html"]);
    expect(plan.manual).toBe(false);
  });

  it("is a no-op once installed", () => {
    const d = assumedDetection();
    const first = planInstall(d, { "app/layout.tsx": REPRESENTATIVE_LAYOUT }, S);
    const second = planInstall(d, { "app/layout.tsx": first.files[0].content }, S);
    expect(second.files).toEqual([]);
    expect(second.alreadyInstalled).toEqual(["app/layout.tsx"]);
  });

  it("falls back to DARWIN.md for unknown frameworks or files it can't edit", () => {
    const unknown = planInstall(detectFramework(["main.go"]), {}, S);
    expect(unknown.manual).toBe(true);
    expect(unknown.files[0].path).toBe("DARWIN.md");
    expect(unknown.files[0].content).toContain(TAG);

    const noBody = planInstall(detectFramework(["apps/shop/app/layout.tsx", "apps/shop/next.config.js"]), { "apps/shop/app/layout.tsx": "export default () => null" }, S);
    expect(noBody.files.map((f) => f.path)).toEqual(["apps/shop/DARWIN.md"]);
  });

  it("builds a PR body with detection, tracked events, privacy and verification", () => {
    const d = detectFramework(["apps/web/src/app/layout.tsx", "apps/web/next.config.ts"]);
    const plan = planInstall(d, { "apps/web/src/app/layout.tsx": REPRESENTATIVE_LAYOUT }, S);
    const body = buildInstallPrBody({ repo: "acme/storefront", detection: d, plan, snippet: S, mode: "live" });
    expect(body).toContain("**Detected:** Next.js (App Router) in `apps/web/`");
    expect(body).toContain("| `apps/web/src/app/layout.tsx` | Load `darwin.js` via `next/script`");
    for (const section of ["## What it tracks", "## Privacy", "## How to verify", "## What happens next"]) expect(body).toContain(section);
    expect(body).toContain("`$rageclick`");
    expect(body).toContain("POST https://darwin.example.com/api/collect");
    expect(body).not.toContain("Dry run");

    const local = buildInstallPrBody({ repo: "a/b", detection: d, plan, snippet: { ...S, src: "http://localhost:3000/darwin.js" }, mode: "offline" });
    expect(local).toContain("Dry run — preview only");
    expect(local).toContain("DARWIN_PUBLIC_URL");
  });
});
