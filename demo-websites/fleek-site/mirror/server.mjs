#!/usr/bin/env node
/**
 * LOCAL-ONLY exact mode server: `npm run dev:mirror` → http://localhost:3003
 *
 *   - serves the snapshot in .mirror/ (made by `npm run mirror`) for the captured routes,
 *   - injects into every captured page: the live storefront.config.json (read per request), Darwin's
 *     darwin.js tag, and mirror/runtime.js (funnel events + the PageSpec-driven conversion flaws),
 *   - proxies everything else (/cart, /checkout, /order, /account, /api, /_next, …) to the Next.js store
 *     on :3002, which it starts for you unless NEXT_URL is already up. Same origin, so the cart is shared.
 *
 * Env: MIRROR_PORT (3003), NEXT_URL (http://localhost:3002), DARWIN_URL (http://localhost:3000, "off" to
 * disable), DARWIN_SITE (rackd). Never deploy this: it serves a third party's pages.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIRROR = join(root, ".mirror");
const PORT = Number(process.env.MIRROR_PORT || 3003);
const NEXT_URL = (process.env.NEXT_URL || "http://localhost:3002").replace(/\/+$/, "");
const DARWIN_URL = (process.env.DARWIN_URL || "http://localhost:3000").replace(/\/+$/, "");
const DARWIN_SITE = process.env.DARWIN_SITE || "rackd";

if (!existsSync(join(MIRROR, "manifest.json"))) {
  console.error("No snapshot yet. Run `npm run mirror` first (local only; .mirror/ is gitignored).");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(MIRROR, "manifest.json"), "utf8"));
const TYPES = { ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".mp4": "video/mp4", ".js": "text/javascript" };

function spec() {
  try {
    return JSON.parse(readFileSync(join(root, "storefront.config.json"), "utf8"));
  } catch {
    return JSON.parse(readFileSync(join(root, "configs", "gen0.json"), "utf8"));
  }
}

const inline = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

function pageKind(path) {
  if (path === "/" || path === "/home") return "home";
  if (path.startsWith("/collections/")) return "collection";
  if (path.startsWith("/products/")) return "product";
  return "other";
}

function inject(html, path) {
  const tag = /^(off|false|0|none)$/i.test(DARWIN_URL) ? "" : `<script src="${DARWIN_URL}/darwin.js" data-darwin-site="${DARWIN_SITE}" defer></script>`;
  const head = `<script>window.__RACKD_SPEC=${inline(spec())};window.__MIRROR=${inline({ page: pageKind(path), path })};</script>
<link rel="stylesheet" href="/__mirror/runtime.css">
<script src="/__mirror/runtime.js" defer></script>
${tag}`;
  return html.replace(/<head([^>]*)>/i, `<head$1>${head}`);
}

function notCaptured(path) {
  return `<!doctype html><meta charset="utf-8"><title>Not in the local copy</title>
<body style="font:16px/1.5 Montserrat,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="text-align:center;max-width:460px"><h1 style="font-size:24px">${path.replace(/[<>&"]/g, "")} wasn't captured</h1>
<p>This local demo copy only has the pages <code>npm run mirror</code> saved.</p>
<p><a href="/" style="font-weight:700">Back to the home page</a> · <a href="/collections/all" style="font-weight:700">All bundles</a></p>
<p style="color:#98a2b3;font-size:13px">Demo copy, not affiliated with Fleek. Local only.</p></div></body>`;
}

function proxy(req, res) {
  const target = new URL(req.url, NEXT_URL);
  const p = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  p.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`The store app isn't reachable at ${NEXT_URL}. It starts automatically; wait a few seconds and reload.`);
  });
  req.pipe(p);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path.startsWith("/__mirror/")) {
    const rel = path.slice("/__mirror/".length);
    const file = rel.startsWith("runtime.") ? join(root, "mirror", normalize(rel)) : join(MIRROR, normalize(rel));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": rel.startsWith("runtime.") ? "no-store" : "public, max-age=86400" });
    return res.end(readFileSync(file));
  }

  const page = manifest.routes[path];
  if (page) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(inject(readFileSync(join(MIRROR, "pages", page), "utf8"), path));
  }
  if (/^\/(products|collections|brands|suppliers|vendors|categories)\//.test(path)) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    return res.end(notCaptured(path));
  }
  proxy(req, res);
});

async function nextUp() {
  try {
    const r = await fetch(`${NEXT_URL}/api/catalog`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

if (!(await nextUp())) {
  const port = new URL(NEXT_URL).port || "3002";
  console.log(`Starting the store app on :${port} (cart, checkout, order pages)…`);
  const child = spawn("npx", ["next", "dev", "-p", port], { cwd: root, stdio: "inherit", env: { ...process.env, DARWIN_URL: process.env.DARWIN_URL ?? "http://localhost:3000" } });
  process.on("exit", () => child.kill());
  process.on("SIGINT", () => process.exit(0));
}

server.listen(PORT, () => {
  console.log(`Mirror (LOCAL ONLY, never deploy): http://localhost:${PORT}  ·  ${Object.keys(manifest.routes).length} captured routes from ${manifest.origin}`);
  console.log(`Flaws follow storefront.config.json (npm run config:gen0 / config:fixed, then reload). Darwin: ${DARWIN_URL} site "${DARWIN_SITE}".`);
});
