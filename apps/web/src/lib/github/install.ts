/**
 * Analytics install: detect the storefront's framework from a repo file listing and
 * inject the Darwin tracker. Everything here is pure (strings in, strings out) so it is
 * unit-testable with fixtures and safe to run in dry-run mode.
 */

export type Framework = "nextjs-app" | "nextjs-pages" | "vite" | "html" | "shopify" | "unknown";

export interface FrameworkDetection {
  framework: Framework;
  /** Human label, e.g. "Next.js (App Router)". */
  label: string;
  /** App root inside the repo ("" = repo root, "apps/web" in a monorepo). */
  root: string;
  /** Files Darwin will edit (or create, for DARWIN.md). */
  targets: string[];
  /** Paths that led to this conclusion. */
  evidence: string[];
  /** True when Darwin could not read the repo and assumed a layout (offline dry run). */
  assumed?: boolean;
}

export interface TrackerSnippet {
  /** Absolute URL of darwin.js, e.g. "https://darwin.example.com/darwin.js". */
  src: string;
  siteId: string;
}

export interface InstallChange {
  path: string;
  /** One-line description for the PR body. */
  summary: string;
  created?: boolean;
}

export interface InstallPlan {
  files: { path: string; content: string }[];
  changes: InstallChange[];
  /** Targets that already load darwin.js (left untouched). */
  alreadyInstalled: string[];
  /** True when Darwin fell back to DARWIN.md instructions instead of editing code. */
  manual: boolean;
}

export const INSTALL_BRANCH = "darwin/install-analytics";
export const INSTALL_TITLE = "Install Darwin analytics (humans + AI agents)";
export const MANUAL_DOC_PATH = "DARWIN.md";

/* ------------------------------------------------------------------ detection */

const IGNORED_DIR =
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|\.vercel|\.turbo|dist|build|out|coverage|vendor|storybook-static|__tests__|__fixtures__|fixtures|test|tests|e2e|examples?)\//;
const NEXT_CONFIG = /^next\.config\.(js|mjs|cjs|ts|mts)$/;
const VITE_CONFIG = /^vite\.config\.(js|mjs|cjs|ts|mts)$/;

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const join = (dir: string, file: string) => (dir ? `${dir}/${file}` : file);
const depth = (p: string) => p.split("/").length;

/** Strip a known suffix ("src/app/layout.tsx") from a path to get the app root. */
function rootOf(path: string, suffix: RegExp): string {
  return path.replace(suffix, "").replace(/\/$/, "");
}

export function detectFramework(paths: string[]): FrameworkDetection {
  const files = paths.filter((p) => !IGNORED_DIR.test(p));
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const d = dirname(f);
    byDir.set(d, [...(byDir.get(d) ?? []), basename(f)]);
  }
  const dirHas = (dir: string, re: RegExp) => (byDir.get(dir) ?? []).some((f) => re.test(f));
  const fileExists = new Set(files);
  /** Prefer roots that look like real Next apps (next.config present), then the shallowest. */
  const rankNext = (candidates: { path: string; root: string }[]) =>
    [...candidates].sort(
      (a, b) =>
        Number(!dirHas(a.root, NEXT_CONFIG)) - Number(!dirHas(b.root, NEXT_CONFIG)) ||
        depth(a.path) - depth(b.path) ||
        a.path.localeCompare(b.path),
    )[0];

  // Next.js App Router: (src/)app/layout.{tsx,jsx,js}
  const APP_LAYOUT = /(^|\/)(src\/)?app\/layout\.(tsx|jsx|js)$/;
  const appLayouts = files.filter((p) => APP_LAYOUT.test(p)).map((path) => ({ path, root: rootOf(path, /(src\/)?app\/layout\.\w+$/) }));
  const PAGES_APP = /(^|\/)(src\/)?pages\/_app\.(tsx|jsx|js)$/;
  const PAGES_DOC = /(^|\/)(src\/)?pages\/_document\.(tsx|jsx|js)$/;
  const pagesFiles = files
    .filter((p) => PAGES_APP.test(p) || PAGES_DOC.test(p))
    .map((path) => ({ path, root: rootOf(path, /(src\/)?pages\/_(app|document)\.\w+$/) }));

  if (appLayouts.length) {
    const best = rankNext(appLayouts);
    const targets = [best.path];
    const evidence = [best.path];
    // Hybrid apps: routes under pages/ don't render the root layout, so wire _app too.
    const pagesApp = pagesFiles.find((p) => p.root === best.root && PAGES_APP.test(p.path));
    if (pagesApp) targets.push(pagesApp.path);
    const config = (byDir.get(best.root) ?? []).find((f) => NEXT_CONFIG.test(f));
    if (config) evidence.push(join(best.root, config));
    return { framework: "nextjs-app", label: "Next.js (App Router)", root: best.root, targets, evidence };
  }

  if (pagesFiles.length) {
    const best = rankNext(pagesFiles);
    const inRoot = pagesFiles.filter((p) => p.root === best.root).map((p) => p.path);
    // Prefer _app (next/script works there); fall back to _document.
    const target = inRoot.find((p) => PAGES_APP.test(p)) ?? inRoot.find((p) => PAGES_DOC.test(p))!;
    const config = (byDir.get(best.root) ?? []).find((f) => NEXT_CONFIG.test(f));
    return {
      framework: "nextjs-pages",
      label: "Next.js (Pages Router)",
      root: best.root,
      targets: [target],
      evidence: [...inRoot, ...(config ? [join(best.root, config)] : [])],
    };
  }

  const shopify = files.filter((p) => /(^|\/)layout\/theme\.liquid$/.test(p)).sort((a, b) => depth(a) - depth(b))[0];
  if (shopify) {
    return {
      framework: "shopify",
      label: "Shopify theme (Liquid)",
      root: rootOf(shopify, /layout\/theme\.liquid$/),
      targets: [shopify],
      evidence: [shopify],
    };
  }

  const viteRoots = [...byDir.keys()].filter((d) => dirHas(d, VITE_CONFIG) && fileExists.has(join(d, "index.html")));
  if (viteRoots.length) {
    const root = viteRoots.sort((a, b) => (a ? depth(a) : 0) - (b ? depth(b) : 0))[0];
    const react = files.some((p) => new RegExp(`^${escapeRe(join(root, "src/"))}(main|index|App)\\.(tsx|jsx)$`).test(p));
    const config = (byDir.get(root) ?? []).find((f) => VITE_CONFIG.test(f))!;
    return {
      framework: "vite",
      label: react ? "Vite + React" : "Vite",
      root,
      targets: [join(root, "index.html")],
      evidence: [join(root, config), join(root, "index.html")],
    };
  }

  const indexes = files.filter((p) => basename(p) === "index.html").sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  if (indexes.length) {
    const index = indexes[0];
    const root = dirname(index);
    const prefix = root ? `${root}/` : "";
    // Static sites need the tag on every page. Cap the PR at 20 files to stay reviewable.
    const pages = files
      .filter((p) => p.endsWith(".html") && p.startsWith(prefix) && p !== index)
      .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
    return {
      framework: "html",
      label: root === "public" ? "HTML template (public/index.html)" : "Static HTML",
      root,
      targets: [index, ...pages].slice(0, 20),
      evidence: [index],
    };
  }

  return { framework: "unknown", label: "Unrecognised framework", root: "", targets: [MANUAL_DOC_PATH], evidence: [] };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Offline dry runs can't read the repo: assume the most common modern storefront setup. */
export function assumedDetection(): FrameworkDetection {
  return {
    framework: "nextjs-app",
    label: "Next.js (App Router)",
    root: "",
    targets: ["app/layout.tsx"],
    evidence: [],
    assumed: true,
  };
}

/** Representative create-next-app root layout, used for offline dry runs. */
export const REPRESENTATIVE_LAYOUT = `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Storefront",
  description: "Shop the collection.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

/* ------------------------------------------------------------------ injection */

const ALREADY_INSTALLED = /data-darwin-site|\/darwin\.js\b/;

export function hasDarwinTracker(source: string): boolean {
  return ALREADY_INSTALLED.test(source);
}

/** `<script src=… data-darwin-site=… defer></script>` for HTML / Liquid / _document. */
export function scriptTag(s: TrackerSnippet, opts: { jsx?: boolean } = {}): string {
  const tag = `<script src="${escapeAttr(s.src)}" data-darwin-site="${escapeAttr(s.siteId)}" defer`;
  return opts.jsx ? `${tag} />` : `${tag}></script>`;
}

function escapeAttr(v: string) {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function nextScriptElement(s: TrackerSnippet, name: string, indent: string): string {
  return [
    `${indent}{/* Darwin: conversion analytics for human shoppers and AI shopping agents */}`,
    `${indent}<${name}`,
    `${indent}  src="${escapeAttr(s.src)}"`,
    `${indent}  data-darwin-site="${escapeAttr(s.siteId)}"`,
    `${indent}  strategy="afterInteractive"`,
    `${indent}/>`,
  ].join("\n");
}

interface CodeStyle {
  quote: '"' | "'";
  semi: boolean;
}

function codeStyle(source: string): CodeStyle {
  const imp = source.match(/^import\s[^\n]*?from\s+(["'])[^"'\n]+\1(;?)/m) ?? source.match(/^import\s+(["'])[^"'\n]+\1(;?)/m);
  if (!imp) return { quote: '"', semi: true };
  return { quote: imp[1] as '"' | "'", semi: imp[2] === ";" };
}

const lineIndent = (source: string, index: number) => {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  return source.slice(start).match(/^[ \t]*/)![0];
};

/** Add `import Script from "next/script"` (or reuse an existing default import). Returns the local name. */
function ensureNextScriptImport(source: string): { code: string; name: string } {
  const existing = source.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']next\/script["']/m);
  if (existing) return { code: source, name: existing[1] };

  const name = /\bScript\b/.test(source) ? "DarwinScript" : "Script";
  const { quote, semi } = codeStyle(source);
  const line = `import ${name} from ${quote}next/script${quote}${semi ? ";" : ""}`;

  const imports = [...source.matchAll(/^import\b[\s\S]*?(?:from\s*)?(["'])[^"'\n]+\1;?[ \t]*$/gm)];
  // After the last binding import, so side-effect imports (`import "./globals.css"`) stay last.
  const last = imports.filter((m) => /\bfrom\s*["']/.test(m[0])).at(-1);
  if (last) {
    const end = last.index! + last[0].length;
    return { code: `${source.slice(0, end)}\n${line}${source.slice(end)}`, name };
  }
  if (imports.length) {
    // Only side-effect imports: go before the first one.
    const at = imports[0].index!;
    return { code: `${source.slice(0, at)}${line}\n${source.slice(at)}`, name };
  }
  // No imports: after any directive prologue ("use client"), else at the top.
  const directive = source.match(/^(?:\s*(["'])use [a-z ]+\1;?[ \t]*\n)+/);
  const at = directive ? directive[0].length : 0;
  return { code: `${source.slice(0, at)}${line}\n${at ? "" : "\n"}${source.slice(at)}`, name };
}

/**
 * Next.js App Router root layout: load darwin.js with next/script (afterInteractive) as the
 * last child of <body>. Returns the source unchanged if already installed, null if it can't
 * find a <body> to inject into.
 */
export function injectNextAppLayout(source: string, s: TrackerSnippet): string | null {
  if (hasDarwinTracker(source)) return source;
  if (source.lastIndexOf("</body>") === -1) return null;

  const { code, name } = ensureNextScriptImport(source);
  const close = code.lastIndexOf("</body>");
  const lineStart = code.lastIndexOf("\n", close - 1) + 1;
  const indent = lineIndent(code, close);
  const before = code.slice(lineStart, close);
  const el = nextScriptElement(s, name, `${indent}  `);

  if (before.trim() === "") {
    // </body> on its own line: add our element just above it.
    return `${code.slice(0, lineStart)}${el}\n${code.slice(lineStart)}`;
  }
  // Inline body, e.g. `<body className="…">{children}</body>`: expand to multiple lines.
  const open = before.match(/^([\s\S]*<body\b[^>]*>)([\s\S]*)$/);
  if (open) {
    const inner = open[2].trim();
    const children = inner ? `${indent}  ${inner}\n` : "";
    return `${code.slice(0, lineStart)}${open[1]}\n${children}${el}\n${indent}</body>${code.slice(close + "</body>".length)}`;
  }
  return `${code.slice(0, close).replace(/[ \t]*$/, "")}\n${el}\n${indent}${code.slice(close)}`;
}

/**
 * Next.js Pages Router `_app`: render next/script next to <Component {...pageProps} />,
 * wrapping the return in a fragment when the component is the root element.
 */
export function injectNextPagesApp(source: string, s: TrackerSnippet): string | null {
  if (hasDarwinTracker(source)) return source;
  const COMPONENT = /<Component\s+\{\s*\.\.\.pageProps\s*\}\s*\/>/;
  if (!COMPONENT.test(source)) return null;

  const { code, name } = ensureNextScriptImport(source);
  const m = code.match(COMPONENT)!;
  const at = m.index!;
  const end = at + m[0].length;
  const indent = lineIndent(code, at);
  const preceding = code.slice(0, at).replace(/\s+$/, "");

  if (/return\s*$/.test(preceding)) {
    // `return <Component {...pageProps} />;` → return ( <> … </> );
    const i = indent;
    const replacement = `(\n${i}  <>\n${i}    ${m[0]}\n${nextScriptElement(s, name, `${i}    `)}\n${i}  </>\n${i})`;
    return code.slice(0, at) + replacement + code.slice(end);
  }
  if (/return\s*\(\s*$/.test(preceding) && code.slice(0, at).endsWith(indent)) {
    // return (\n    <Component {...pageProps} />\n  );
    const lineStart = at - indent.length;
    const lineEnd = code.indexOf("\n", end);
    const rest = lineEnd === -1 ? "" : code.slice(lineEnd);
    const tail = code.slice(end, lineEnd === -1 ? code.length : lineEnd);
    const block = `${indent}<>\n${indent}  ${m[0]}${tail}\n${nextScriptElement(s, name, `${indent}  `)}\n${indent}</>`;
    return code.slice(0, lineStart) + block + rest;
  }
  // Nested inside a layout element: a sibling is fine.
  const lineEnd = code.indexOf("\n", end);
  const insertAt = lineEnd === -1 ? code.length : lineEnd;
  return `${code.slice(0, insertAt)}\n${nextScriptElement(s, name, indent)}${code.slice(insertAt)}`;
}

/** Next.js `_document`: a deferred <script> inside <Head>. */
export function injectNextDocument(source: string, s: TrackerSnippet): string | null {
  if (hasDarwinTracker(source)) return source;
  const close = source.search(/<\/Head>/);
  if (close !== -1) return insertBeforeLine(source, close, scriptTag(s, { jsx: true }));
  const selfClosing = source.match(/<Head\s*\/>/);
  if (selfClosing) {
    const at = selfClosing.index!;
    const indent = lineIndent(source, at);
    const replacement = `<Head>\n${indent}  ${scriptTag(s, { jsx: true })}\n${indent}</Head>`;
    return source.slice(0, at) + replacement + source.slice(at + selfClosing[0].length);
  }
  return null;
}

/** Plain HTML, Vite index.html and Shopify theme.liquid: deferred <script> before </head>. */
export function injectHtml(source: string, s: TrackerSnippet): string | null {
  if (hasDarwinTracker(source)) return source;
  const head = source.search(/<\/head>/i);
  if (head !== -1) return insertBeforeLine(source, head, scriptTag(s));
  const body = source.search(/<\/body>/i);
  if (body !== -1) return insertBeforeLine(source, body, scriptTag(s));
  return null;
}

/** Insert `line` just before the closing tag at `index`, indented one level deeper than it. */
function insertBeforeLine(source: string, index: number, line: string): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  const indent = lineIndent(source, index);
  if (source.slice(lineStart, index).trim() === "") {
    const unit = indent.includes("\t") ? "\t" : "  ";
    return `${source.slice(0, lineStart)}${indent}${unit}${line}\n${source.slice(lineStart)}`;
  }
  return `${source.slice(0, index)}${line}${source.slice(index)}`;
}

/* ------------------------------------------------------------------ plan */

export function manualInstructions(s: TrackerSnippet, detection?: FrameworkDetection): string {
  return `# Darwin analytics

Darwin couldn't safely edit this repository automatically${detection && detection.framework !== "unknown" ? ` (${detection.label}, but no place to inject was found)` : ""}, so here is the one line to add by hand.

## Install

Add this tag to the \`<head>\` of every page (usually your root layout or HTML template):

\`\`\`html
${scriptTag(s)}
\`\`\`

- **Next.js**: in \`app/layout.tsx\` render \`<Script src="${s.src}" data-darwin-site="${s.siteId}" strategy="afterInteractive" />\` from \`next/script\` inside \`<body>\`.
- **Remix / React Router**: add the tag inside \`<head>\` in \`app/root.tsx\`.
- **Nuxt**: add it to \`app.head.script\` in \`nuxt.config.ts\`.
- **SvelteKit**: add it to \`src/app.html\` before \`%sveltekit.head%\`.
- **Shopify**: add it to \`layout/theme.liquid\` before \`</head>\`.

## Custom events

Commerce events make Darwin's funnel analysis much sharper:

\`\`\`js
window.darwin.capture("product_viewed", { product_id: "sku_123", price: 8999 }); // price in minor units
window.darwin.capture("product_added", { product_id: "sku_123", quantity: 1 });
window.darwin.capture("checkout_started");
window.darwin.capture("order_completed", { revenue: 8999 });
\`\`\`

## Verify

Open your site, click around, and check the Network tab for \`POST ${originOf(s.src)}/api/collect\` requests returning \`200\`.
`;
}

const originOf = (src: string) => {
  try {
    return new URL(src).origin;
  } catch {
    return "";
  }
};

function describeTarget(path: string, detection: FrameworkDetection): string {
  const file = basename(path);
  if (/^layout\.\w+$/.test(file)) return "Load `darwin.js` via `next/script` (`afterInteractive`) at the end of `<body>`";
  if (/^_app\.\w+$/.test(file)) return "Load `darwin.js` via `next/script` (`afterInteractive`) for Pages Router routes";
  if (/^_document\.\w+$/.test(file)) return "Add a deferred `darwin.js` `<script>` to `<Head>`";
  if (file.endsWith(".liquid")) return "Add a deferred `darwin.js` `<script>` before `</head>` (loads on every storefront page)";
  if (file.endsWith(".html")) {
    return detection.framework === "vite"
      ? "Add a deferred `darwin.js` `<script>` before `</head>` (Vite serves this as the app shell)"
      : "Add a deferred `darwin.js` `<script>` before `</head>`";
  }
  return "Update file";
}

/** Where the manual-install doc goes when Darwin can't edit code (the app root). */
export function manualDocPath(detection: FrameworkDetection): string {
  return detection.root ? `${detection.root}/${MANUAL_DOC_PATH}` : MANUAL_DOC_PATH;
}

/**
 * Turn a detection plus current file contents into the edits for the PR.
 * `sources[path]` is the file's current content (undefined if it doesn't exist).
 */
export function planInstall(
  detection: FrameworkDetection,
  sources: Record<string, string | undefined>,
  snippet: TrackerSnippet,
): InstallPlan {
  const plan: InstallPlan = { files: [], changes: [], alreadyInstalled: [], manual: false };

  const inject = (path: string, source: string): string | null => {
    const file = basename(path);
    if (/^layout\.(tsx|jsx|js)$/.test(file)) return injectNextAppLayout(source, snippet);
    if (/^_app\.(tsx|jsx|js)$/.test(file)) return injectNextPagesApp(source, snippet);
    if (/^_document\.(tsx|jsx|js)$/.test(file)) return injectNextDocument(source, snippet);
    if (/\.(html|liquid)$/.test(file)) return injectHtml(source, snippet);
    return null;
  };

  let failed = false;
  if (detection.framework !== "unknown") {
    for (const path of detection.targets) {
      const source = sources[path];
      if (source === undefined) {
        failed = true;
        continue;
      }
      const next = inject(path, source);
      if (next === null) {
        failed = true;
      } else if (next === source) {
        plan.alreadyInstalled.push(path);
      } else {
        plan.files.push({ path, content: next });
        plan.changes.push({ path, summary: describeTarget(path, detection) });
      }
    }
  }

  // Unknown framework, or nothing we could edit safely: ship instructions instead of guessing.
  if (detection.framework === "unknown" || (failed && plan.files.length === 0 && plan.alreadyInstalled.length === 0)) {
    const docPath = manualDocPath(detection);
    const content = manualInstructions(snippet, detection);
    plan.manual = true;
    if (sources[docPath] !== content) {
      plan.files.push({ path: docPath, content });
      plan.changes.push({
        path: docPath,
        summary: "Add install instructions (framework not auto-detected, so no code is changed)",
        created: sources[docPath] === undefined,
      });
    }
  }
  return plan;
}

/* ------------------------------------------------------------------ PR body */

export interface InstallBodyInput {
  repo: string;
  detection: FrameworkDetection;
  plan: InstallPlan;
  snippet: TrackerSnippet;
  /** "offline" = no token, nothing read; "dry-run" = read-only token run. */
  mode: "live" | "dry-run" | "offline";
}

export function buildInstallPrBody({ repo, detection, plan, snippet, mode }: InstallBodyInput): string {
  const origin = originOf(snippet.src) || snippet.src.replace(/\/darwin\.js$/, "");
  const out: string[] = [];

  if (mode === "offline") {
    out.push(
      "> [!NOTE]",
      "> **Dry run — preview only.** Darwin has no working `GITHUB_TOKEN`, so it could not read this repository.",
      `> This preview assumes a ${detection.label} project with \`${detection.targets[0]}\`; the real PR is generated from your actual files.`,
      "",
    );
  } else if (mode === "dry-run") {
    out.push(
      "> [!NOTE]",
      "> **Dry run — preview only** (`DARWIN_GITHUB_DRY_RUN=1`). Darwin read the repository but did not create a branch or PR.",
      "",
    );
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(snippet.src)) {
    out.push(
      "> [!WARNING]",
      `> The script URL points at \`${origin}\`, which only works on your machine. Set \`DARWIN_PUBLIC_URL\` to Darwin's public URL and reconnect before merging.`,
      "",
    );
  }

  out.push(
    "## What this does",
    "",
    `Adds the Darwin tracker to **${repo}** so Darwin can see how **human shoppers and AI shopping agents** move through the store — and then improve it with A/B-tested changes, each delivered as a pull request like this one.`,
    "",
    `**Detected:** ${detection.label}${detection.root ? ` in \`${detection.root}/\`` : ""}${
      detection.evidence.length ? ` (${detection.evidence.map((e) => `\`${e}\``).join(", ")})` : ""
    }`,
    "",
  );

  if (plan.changes.length) {
    out.push("| File | Change |", "|---|---|");
    for (const c of plan.changes) out.push(`| \`${c.path}\`${c.created ? " (new)" : ""} | ${c.summary} |`);
    out.push("");
  }
  if (plan.alreadyInstalled.length) {
    out.push(`Already loading Darwin (left unchanged): ${plan.alreadyInstalled.map((p) => `\`${p}\``).join(", ")}.`, "");
  }
  if (plan.manual) {
    out.push(
      "Darwin couldn't find a safe place to inject the script automatically, so this PR only adds `DARWIN.md` with a one-line install for your framework. No application code is changed.",
      "",
    );
  }

  out.push(
    "The script is under 4 KB (~2 KB gzipped), has no dependencies, loads with `defer` / `afterInteractive` (never blocks rendering) and sends events in batches.",
    "",
    ...(detection.framework.startsWith("nextjs") && !plan.manual
      ? ["```tsx", `<Script src="${snippet.src}" data-darwin-site="${snippet.siteId}" strategy="afterInteractive" />`, "```"]
      : ["```html", scriptTag(snippet), "```"]),
    "",
    "## What it tracks",
    "",
    "| Event | When | Why it matters |",
    "|---|---|---|",
    "| `$pageview` / `$pageleave` | Page loads, client-side navigations and exits | Funnel steps and dead ends |",
    "| `$autocapture` | Clicks on links, buttons and controls — tag, visible text (≤ 64 chars), CSS selector | Which CTAs work |",
    "| `$rageclick` | 3+ clicks on the same element within 1 s | Frustration: broken or unclear UI |",
    '| Custom events | `window.darwin.capture("order_completed", { revenue: 8999 })` | Conversion and revenue |',
    "",
    "Every visitor is classified server-side as a **human** or an **AI agent** (GPTBot, ClaudeBot, PerplexityBot, headless / automated browsers, …), so Darwin can optimise for both audiences separately.",
    "",
    "## Privacy",
    "",
    "- **No PII.** Never reads form fields, input values or keystrokes; the only identifier is a random first-party visitor id (`darwin_id`).",
    `- **First-party only.** Events go to \`${origin}/api/collect\`; no third-party requests, no fingerprinting, no session recording.`,
    "- **Honours opt-outs.** Browsers sending Global Privacy Control or Do Not Track are not tracked.",
    "- **Removable in one line.** Delete the tag (or revert this PR) to uninstall.",
    "",
    "## How to verify",
    "",
    "1. Check out this branch (or open its preview deployment) and run the site.",
    `2. Open DevTools → Network, click around, and look for \`POST ${origin}/api/collect\` requests returning \`200\`.`,
    `3. Watch the events arrive live in Darwin's console at ${origin}/console.`,
    '4. Optional: call `window.darwin.capture("test_event")` in the browser console.',
    "",
    "## What happens next",
    "",
    "1. **Observe** — Darwin builds a baseline funnel for humans and AI agents.",
    "2. **Diagnose** — it looks for friction: rage clicks, dead ends, shipping-cost shock, data agents asked for but couldn't find.",
    "3. **Experiment** — it proposes a focused change and A/B tests it on live traffic.",
    "4. **Ship** — each winning change arrives as a PR with the full results table. **Nothing reaches production without your review and merge.**",
    "",
    "---",
    `<sub>Opened by Darwin · site id \`${snippet.siteId}\` · branch \`${INSTALL_BRANCH}\`</sub>`,
  );
  return out.join("\n");
}
