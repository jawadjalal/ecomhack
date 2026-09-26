#!/usr/bin/env node
/**
 * LOCAL-ONLY: serve the pages `npm run mirror` downloaded into .mirror/ on http://localhost:3011, with
 *   - Darwin's darwin.js tag (NEXT_PUBLIC_DARWIN_URL / NEXT_PUBLIC_DARWIN_SITE, same as the Next app),
 *   - mirror/runtime.js: funnel events + the planted conversion flaws, read live from storefront.config.json,
 *   - a "Demo copy, not affiliated with Apple" note on every page.
 * Bag, checkout and order pages (and /_next, /api) are proxied to the Orchard Next app, started here on
 * port 3001 unless --no-next is passed or ORCHARD_APP_URL points at one that's already running.
 *
 * Never deploy this server or the .mirror/ folder anywhere. No dependencies; Node 20+.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MIRROR = path.join(root, ".mirror");
const PORT = Number(process.env.MIRROR_PORT || 3011);
const APP = (process.env.ORCHARD_APP_URL || "http://localhost:3001").replace(/\/+$/, "");
const CONFIG = path.join(root, process.env.STOREFRONT_CONFIG || "storefront.config.json");
const DARWIN_URL = (process.env.NEXT_PUBLIC_DARWIN_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
const DARWIN_SITE = (process.env.NEXT_PUBLIC_DARWIN_SITE || "orchard").trim();
const DARWIN_ON = DARWIN_URL !== "" && DARWIN_URL.toLowerCase() !== "off";

const manifestFile = path.join(MIRROR, "manifest.json");
if (!fs.existsSync(manifestFile)) {
  console.error("No .mirror/ yet. Run `npm run mirror` first (downloads the pages to your laptop only).");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const pages = new Map(manifest.pages.map((p) => [p.local, p]));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

function readSpec() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch (err) {
    return { error: String(err) };
  }
}

const NOTE =
  '<div id="orchard-demo-note" style="position:relative;z-index:1;padding:10px 22px;background:#1d1d1f;color:#f5f5f7;font:12px/1.4 -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;text-align:center">' +
  "Demo copy, not affiliated with Apple. Local rehearsal build of a fictional store for demoing Darwin: nothing here is for sale.</div>";

function inject(html, page) {
  const spec = readSpec();
  const head =
    `<script>window.__ORCHARD_SPEC__=${JSON.stringify(spec).replace(/</g, "\\u003c")};window.__ORCHARD_PAGE__=${JSON.stringify(page.kind)};</script>` +
    `<script src="/__orchard/runtime.js" defer></script>` +
    (DARWIN_ON ? `<script src="${DARWIN_URL}/darwin.js" data-darwin-site="${DARWIN_SITE}" defer></script>` : "");
  html = html.includes("</head>") ? html.replace("</head>", `${head}</head>`) : head + html;
  html = html.replace(/<\/body>/i, `${NOTE}</body>`);
  return html;
}

function proxy(req, res) {
  const target = new URL(req.url, APP);
  const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`The Orchard app isn't answering at ${APP}. Start it with \`npm run dev\` (or run dev:mirror without --no-next).`);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname.replace(/\/+$/, "") || "/";

  if (p === "/__orchard/runtime.js") {
    res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(here, "runtime.js")));
  }
  if (p === "/__orchard/spec.json") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    return res.end(JSON.stringify(readSpec()));
  }
  const page = pages.get(p);
  if (page) {
    const html = fs.readFileSync(path.join(MIRROR, page.file), "utf8");
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    return res.end(inject(html, page));
  }
  if (p.startsWith("/assets/")) {
    const file = path.join(MIRROR, decodeURIComponent(p));
    if (!file.startsWith(MIRROR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "public, max-age=3600" });
    return fs.createReadStream(file).pipe(res);
  }
  // Bag, checkout, order confirmation, Next assets and APIs come from the Orchard app.
  return proxy(req, res);
});

let child;
if (!process.argv.includes("--no-next") && !process.env.ORCHARD_APP_URL) {
  child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "-p", "3001"], { cwd: root, stdio: "inherit", env: process.env });
  const stop = () => {
    child?.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

server.listen(PORT, () => {
  console.log(`Mirror (local only, never deploy): http://localhost:${PORT}  · pages: ${[...pages.keys()].join(", ")}`);
  console.log(`Flaws follow ${path.relative(root, CONFIG)} (reloaded on every request). Bag/checkout proxied to ${APP}.`);
});
