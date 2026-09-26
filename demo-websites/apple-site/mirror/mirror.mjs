#!/usr/bin/env node
/**
 * LOCAL-ONLY "exact mode": download a few live apple.com pages and their assets (HTML, CSS, images,
 * fonts) into ./.mirror/ so `npm run dev:mirror` can serve a pixel-exact copy with Darwin's tag, funnel
 * events and the planted conversion flaws (driven by storefront.config.json) layered on top.
 *
 *   npm run mirror                    # home, store, one buy page → .mirror/
 *   npm run mirror -- --force         # re-download everything
 *   npm run mirror -- --raw           # skip the browser render (raw HTML; less faithful)
 *
 * .mirror/ holds third-party copyrighted material. It is gitignored. NEVER commit, push, deploy or share
 * it: it exists only so the owner can rehearse the demo on their own laptop. No dependencies; Node 20+.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, ".mirror");
const FORCE = process.argv.includes("--force");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** Local path → page to mirror, and what kind of page it is (runtime.js applies the flaws per kind). */
const PAGES = [
  { local: "/", kind: "home", url: "https://www.apple.com/uk/" },
  { local: "/store", kind: "store", url: "https://www.apple.com/uk/store" },
  { local: "/buy/phone", kind: "buy", url: "https://www.apple.com/uk/shop/buy-iphone/iphone-18-pro" },
];

/** Links inside mirrored pages that should stay inside the mirror. Everything else keeps its remote URL. */
const LINK_MAP = [
  [/^\/uk\/?$/, "/"],
  [/^\/uk\/store\/?$/, "/store"],
  [/^\/uk\/shop\/buy-iphone\/iphone-1\d-pro\/?/, "/buy/phone"],
  [/^\/uk\/shop\/goto\/buy_iphone\/iphone_1\d_pro/, "/buy/phone"],
  [/^\/uk\/shop\/bag\/?/, "/bag"],
];

const ALLOWED_HOSTS = /(^|\.)apple\.com$|(^|\.)cdn-apple\.com$/;
const SKIP_EXT = /\.(mp4|m4v|mov|webm|m3u8|ts|vtt|zip|dmg|pdf)$/i;

const pending = new Map(); // remote URL → Promise
let downloaded = 0;
let failed = 0;
const failures = [];

function localFor(remote) {
  const u = new URL(remote);
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith("/")) p += "index";
  const ext = path.extname(p);
  const q = u.search ? `__${crypto.createHash("sha1").update(u.search).digest("hex").slice(0, 10)}` : "";
  const guessed = ext || (/fonts/.test(p) ? ".css" : "");
  const base = ext ? p.slice(0, -ext.length) : p;
  const safe = `${base}${q}${guessed}`.replace(/[^\w./-]/g, "_");
  return `/assets/${u.host}${safe}`;
}

async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: /fonts|\.css/.test(url) ? "text/css,*/*;q=0.1" : "*/*", "accept-language": "en-GB,en;q=0.9", referer: "https://www.apple.com/uk/" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res;
      if (res.status === 404 || res.status === 403) return null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

/** Limit concurrent downloads. */
let active = 0;
const queue = [];
function limit(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        active--;
        queue.shift()?.();
      }
    };
    if (active < 8) run();
    else queue.push(run);
  });
}

/**
 * Map a remote asset URL to its local path and schedule the download (recursing into CSS). Returns the
 * local URL path synchronously, or the remote URL when the asset isn't mirrored (other hosts, video).
 * Nothing awaits a child download, so CSS files that reference each other can't deadlock.
 */
function asset(remote) {
  let u;
  try {
    u = new URL(remote);
  } catch {
    return remote;
  }
  if (!/^https?:$/.test(u.protocol) || !ALLOWED_HOSTS.test(u.hostname) || SKIP_EXT.test(u.pathname)) return remote;
  u.hash = "";
  const key = u.href;
  const local = localFor(key);
  if (pending.has(key)) return local;
  const file = path.join(OUT, local);
  const isCss = /\.css$/i.test(local);
  const job = (async () => {
    if (!FORCE && fs.existsSync(file) && !isCss) return;
    const got = await limit(async () => {
      const res = await fetchWithRetry(key);
      if (!res) return null;
      const type = res.headers.get("content-type") ?? "";
      return isCss || type.includes("text/css") ? { css: await res.text() } : { bytes: Buffer.from(await res.arrayBuffer()) };
    });
    if (!got) {
      failed++;
      failures.push(key);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, got.css !== undefined ? rewriteCss(got.css, key) : got.bytes);
    downloaded++;
    if (downloaded % 50 === 0) process.stdout.write(`\r  ${downloaded} assets…`);
  })();
  pending.set(key, job);
  return local;
}

function rewriteCss(css, base) {
  const swap = (raw) => {
    if (raw.startsWith("data:") || raw.startsWith("#")) return raw;
    try {
      return asset(new URL(raw, base).href);
    } catch {
      return raw;
    }
  };
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, q, raw) => `url(${q}${swap(raw)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/g, (_, q, raw) => `@import ${q}${swap(raw)}${q}`);
}

/** Wait until every scheduled download (including ones scheduled by other downloads) has finished. */
async function drain() {
  for (;;) {
    const n = pending.size;
    await Promise.all(pending.values());
    if (pending.size === n) return;
  }
}

function mapLink(href, pageUrl) {
  let u;
  try {
    u = new URL(href, pageUrl);
  } catch {
    return href;
  }
  if (!/apple\.com$/.test(u.hostname)) return href;
  for (const [re, local] of LINK_MAP) if (re.test(u.pathname)) return local;
  return u.href; // leaves the mirror (fine for a local demo)
}

/**
 * Playwright renders the page like a browser does (lazy images resolved, JS-built sections present), so
 * the snapshot matches what a visitor sees. It isn't a dependency of this site: we use one that's
 * installed here, or the one in the Darwin monorepo (apps/web). Without it we fall back to raw HTML,
 * which is much less faithful on script-heavy pages.
 */
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* not installed here */
  }
  for (const base of [path.join(root, "..", "..", "apps", "web"), process.cwd()]) {
    try {
      const req = createRequire(path.join(base, "package.json"));
      return req("playwright");
    } catch {
      /* try the next place */
    }
  }
  return null;
}

async function launch(pw) {
  try {
    return await pw.chromium.launch();
  } catch (err) {
    // The installed browser build may not match this playwright version: use any cached Chromium.
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
    const candidates = [];
    try {
      for (const dir of fs.readdirSync(cache).sort().reverse()) {
        const full = path.join(cache, dir);
        for (const rel of [
          "chrome-headless-shell-mac-arm64/chrome-headless-shell",
          "chrome-headless-shell-mac-x64/chrome-headless-shell",
          "chrome-headless-shell-linux64/chrome-headless-shell",
          "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          "chrome-linux/chrome",
        ]) {
          if (fs.existsSync(path.join(full, rel))) candidates.push(path.join(full, rel));
        }
      }
    } catch {
      /* no cache */
    }
    for (const executablePath of candidates) {
      try {
        return await pw.chromium.launch({ executablePath });
      } catch {
        /* next */
      }
    }
    throw err;
  }
}

/** Render with Playwright: save every stylesheet/image/font the page loads, return the rendered HTML. */
async function render(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, locale: "en-GB" });
  const tab = await ctx.newPage();
  const saves = [];
  tab.on("response", (r) => {
    const type = r.request().resourceType();
    if (!["stylesheet", "image", "font"].includes(type) || !r.ok()) return;
    const u = new URL(r.url());
    if (!ALLOWED_HOSTS.test(u.hostname) || SKIP_EXT.test(u.pathname)) return;
    const file = path.join(OUT, localFor(u.href));
    if (type === "stylesheet" || (!FORCE && fs.existsSync(file))) return; // CSS is fetched and rewritten by asset()
    saves.push(
      r
        .body()
        .then((body) => {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, body);
          downloaded++;
        })
        .catch(() => {}),
    );
  });
  await tab.goto(url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
  // Scroll through the page so lazy images load, then back to the top.
  const height = await tab.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await tab.evaluate((top) => window.scrollTo(0, top), y);
    await tab.waitForTimeout(150);
  }
  await tab.evaluate(() => window.scrollTo(0, 0));
  await tab.waitForLoadState("networkidle").catch(() => {});
  await tab.waitForTimeout(1200);
  const html = await tab.evaluate(() => "<!DOCTYPE html>\n" + document.documentElement.outerHTML);
  const finalUrl = tab.url();
  await Promise.all(saves);
  await ctx.close();
  return { html, pageUrl: finalUrl };
}

async function mirrorPage(page, browser) {
  console.log(`→ ${page.url}${browser ? "" : " (raw HTML)"}`);
  let html;
  let pageUrl;
  if (browser) {
    ({ html, pageUrl } = await render(browser, page.url));
  } else {
    const res = await fetchWithRetry(page.url);
    if (!res) throw new Error(`Could not download ${page.url}`);
    html = await res.text();
    pageUrl = res.url || page.url;
  }

  // Scripts out (Apple's JS talks to Apple's servers); structured data stays.
  html = html.replace(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<link\b[^>]*rel=["']?(?:preload|modulepreload|prefetch|dns-prefetch|preconnect)["']?[^>]*>/gi, (tag) => (/as=["']?(font|style|image)/i.test(tag) ? tag : ""));
  html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy[^>]*>/gi, "");
  html = html.replace(/<base\b[^>]*>/gi, "");
  // Videos aren't mirrored: show their start frames instead of an empty player.
  html = html.replace(/<video\b[\s\S]*?<\/video>/gi, "");
  html = html.replace(/(class="[^"]*\binline-media-wrapper\b[^"]*)\bplaying\b/g, "$1");

  // Point every asset at its local copy (downloads are scheduled as we go).
  const swap = (raw) => {
    if (!raw || raw.startsWith("data:") || raw.startsWith("#") || raw.startsWith("javascript:")) return raw;
    try {
      return asset(new URL(raw.trim().replace(/&amp;/g, "&"), pageUrl).href);
    } catch {
      return raw;
    }
  };
  html = html.replace(/(\s(?:src|poster|data-src)=["'])([^"']+)(["'])/gi, (_, a, raw, b) => a + swap(raw) + b);
  html = html.replace(/(\s(?:srcset|data-srcset)=["'])([^"']+)(["'])/gi, (_, a, set, b) =>
    a +
    set
      .split(/,\s+(?=[^\s,]+(?:\s+[\d.]+[wx])?(?:,|$))/)
      .map((part) => {
        const [raw, ...rest] = part.trim().split(/\s+/);
        return [swap(raw), ...rest].join(" ");
      })
      .join(", ") +
    b,
  );
  html = html.replace(/<link\b[^>]*>/gi, (tag) =>
    /rel=["']?(?:stylesheet|icon|apple-touch-icon|preload)/i.test(tag) ? tag.replace(/href=(["'])([^"']+)\1/i, (_, q, raw) => `href=${q}${swap(raw)}${q}`) : tag,
  );
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => `<style${attrs}>${rewriteCss(css, pageUrl)}</style>`);
  html = html.replace(/(\sstyle=["'])([^"']*url\([^"']*)(["'])/gi, (_, a, css, b) => a + rewriteCss(css, pageUrl) + b);

  // Page links: keep the mirrored pages and the bag inside the mirror.
  html = html.replace(/(<a\b[^>]*\shref=["'])([^"']+)(["'])/gi, (_, a, href, b) => a + mapLink(href, pageUrl) + b);
  html = html.replace(/(<form\b[^>]*\saction=["'])([^"']+)(["'])/gi, (_, a, href, b) => a + mapLink(href, pageUrl) + b);

  const file = path.join(OUT, "pages", `${page.kind}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return { ...page, file: path.relative(OUT, file), bytes: html.length };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "README.txt"),
    "Local mirror of third-party pages for rehearsing a demo. NEVER commit, push, deploy or share this folder.\n",
  );
  const pw = process.argv.includes("--raw") ? null : await loadPlaywright();
  if (!pw && !process.argv.includes("--raw")) console.warn("Playwright not found: saving raw HTML (less faithful). `npm i -D playwright` for exact snapshots.");
  const browser = pw ? await launch(pw) : null;
  const pages = [];
  for (const page of PAGES) {
    try {
      pages.push(await mirrorPage(page, browser));
    } catch (err) {
      console.error(`  ✗ ${err.message}`);
    }
  }
  await browser?.close();
  await drain();
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), pages, failures }, null, 2));
  console.log(`\nMirrored ${pages.length}/${PAGES.length} pages, ${downloaded} assets downloaded${failed ? `, ${failed} failed (left remote)` : ""} → ${path.relative(process.cwd(), OUT) || OUT}`);
  console.log("Serve it with: npm run dev:mirror  (http://localhost:3011). Never commit or deploy .mirror/.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
