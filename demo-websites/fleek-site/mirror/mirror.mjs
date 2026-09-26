#!/usr/bin/env node
/**
 * LOCAL-ONLY exact mode. Downloads a snapshot of the live reference site (rendered HTML plus the CSS,
 * images and fonts it loads) into ./.mirror/ so `npm run dev:mirror` can serve it on this laptop with
 * Darwin's tag, funnel events and the PageSpec-driven conversion flaws applied on top.
 *
 *   npm run mirror                       # home, the "all" collection and 6 product pages
 *   npm run mirror -- --products 10      # more product pages
 *   npm run mirror -- --origin https://www.joinfleek.com
 *
 * .mirror/ is gitignored. It contains a third party's copyrighted pages and assets: NEVER commit it,
 * push it, deploy it or share it. It exists only so the owner can rehearse the demo against a
 * pixel-exact copy. Scripts from the original site are stripped; nothing is sent back to it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, ".mirror");
const ASSETS = join(OUT, "assets");
const PAGES = join(OUT, "pages");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ORIGIN = arg("origin", "https://www.joinfleek.com").replace(/\/+$/, "");
const PRODUCTS = Number(arg("products", 6));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Needs Playwright: npm install, then npx playwright install chromium");
  process.exit(1);
}

/** url → "/__mirror/assets/<hash>.<ext>" */
const assetMap = new Map();
const EXT = { "text/css": "css", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif", "image/svg+xml": "svg", "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "application/font-woff2": "woff2", "video/mp4": "mp4" };

function localName(url, contentType) {
  const type = (contentType ?? "").split(";")[0].trim();
  const fromPath = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  const ext = EXT[type] ?? fromPath ?? "bin";
  return `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.${ext}`;
}

function saveAsset(url, body, contentType) {
  if (assetMap.has(url)) return assetMap.get(url);
  const name = localName(url, contentType);
  writeFileSync(join(ASSETS, name), body);
  const local = `/__mirror/assets/${name}`;
  assetMap.set(url, local);
  return local;
}

async function fetchAsset(url) {
  if (assetMap.has(url)) return assetMap.get(url);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    let body = Buffer.from(await res.arrayBuffer());
    if (type.includes("text/css")) body = Buffer.from(await rewriteCss(body.toString("utf8"), url));
    return saveAsset(url, body, type);
  } catch {
    return null;
  }
}

/** Point url(...) and @import in a stylesheet at local copies (downloading fonts/images it references). */
async function rewriteCss(css, base) {
  const refs = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]).filter((u) => !u.startsWith("data:") && !u.startsWith("#"));
  for (const ref of new Set(refs)) {
    let abs;
    try {
      abs = new URL(ref, base).href;
    } catch {
      continue;
    }
    const local = await fetchAsset(abs);
    if (local) css = css.split(ref).join(local);
  }
  return css;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function snapshot(page, path, name) {
  const url = `${ORIGIN}${path}`;
  console.log(`· ${url}`);
  const pending = [];
  const onResponse = (res) => {
    const type = res.request().resourceType();
    if (!["stylesheet", "image", "font", "media"].includes(type) || res.status() !== 200) return;
    pending.push(
      res
        .body()
        .then(async (body) => {
          const ct = res.headers()["content-type"] ?? "";
          const buf = ct.includes("text/css") ? Buffer.from(await rewriteCss(body.toString("utf8"), res.url())) : body;
          saveAsset(res.url(), buf, ct);
        })
        .catch(() => {}),
    );
  };
  page.on("response", onResponse);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => console.warn(`  ! ${e.message.split("\n")[0]}`));
  await page.waitForTimeout(4000);
  await page.keyboard.press("Escape").catch(() => {});
  for (const sel of ['[aria-label="Close"]', '[aria-label="close"]', 'button:has-text("×")']) {
    const el = await page.$(sel);
    if (el && (await el.isVisible().catch(() => false))) await el.click({ timeout: 2000 }).catch(() => {});
  }
  // Scroll so lazy images load.
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);

  // Freeze the DOM: absolute URLs, chosen srcset candidate, no scripts, no open modals.
  const data = await page.evaluate(() => {
    const abs = (u) => {
      try {
        return new URL(u, location.href).href;
      } catch {
        return u;
      }
    };
    // CSS-in-JS libraries insert rules through the CSSOM (insertRule), which outerHTML doesn't include:
    // write every <style> sheet's live rules back into its text so the snapshot keeps its styling.
    for (const sheet of document.styleSheets) {
      const node = sheet.ownerNode;
      if (!node || node.tagName !== "STYLE") continue;
      try {
        const text = [...sheet.cssRules].map((r) => r.cssText).join("\n");
        if (text.length > (node.textContent || "").length) node.textContent = text;
      } catch {
        /* cross-origin sheet */
      }
    }
    for (const node of document.querySelectorAll("style")) {
      node.textContent = (node.textContent || "").replace(/url\((['"]?)([^'")]+)\1\)/g, (m, _q, u) => (u.startsWith("data:") || u.startsWith("#") ? m : `url("${abs(u)}")`));
    }
    for (const img of document.querySelectorAll("img")) {
      const src = img.currentSrc || img.src;
      if (src) img.setAttribute("src", abs(src));
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.removeAttribute("loading");
      img.removeAttribute("decoding");
    }
    for (const s of document.querySelectorAll("picture source")) s.remove();
    for (const l of document.querySelectorAll('link[rel="stylesheet"]')) l.setAttribute("href", abs(l.getAttribute("href")));
    for (const v of document.querySelectorAll("video")) {
      v.removeAttribute("autoplay");
      if (v.poster) v.setAttribute("poster", abs(v.poster));
    }
    for (const el of document.querySelectorAll("[style*='url(']")) {
      el.setAttribute("style", el.getAttribute("style").replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, u) => `url("${abs(u)}")`));
    }
    for (const el of document.querySelectorAll("script, noscript, link[rel=preload], link[rel=prefetch], link[rel=modulepreload], iframe")) el.remove();
    for (const el of document.querySelectorAll('[role="dialog"], [role="presentation"].MuiModal-root, .MuiBackdrop-root')) el.remove();
    document.body.style.overflow = "";
    document.documentElement.style.overflow = "";
    const links = [...document.querySelectorAll('a[href*="/products/"]')].map((a) => new URL(a.getAttribute("href"), location.href).pathname);
    return { html: "<!doctype html>\n" + document.documentElement.outerHTML, productLinks: [...new Set(links)] };
  });
  page.off("response", onResponse);
  await Promise.all(pending);

  let html = data.html;
  // Anything referenced but not captured yet (backgrounds in inline styles, video posters, stylesheets).
  const refs = new Set([...html.matchAll(/(?:src|href|poster)="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")));
  for (const m of html.matchAll(/url\(&quot;(https?:[^&]+)&quot;\)|url\("(https?:[^"]+)"\)/g)) refs.add((m[1] ?? m[2]).replace(/&amp;/g, "&"));
  for (const ref of refs) {
    if (ref.startsWith(ORIGIN) && !/\.(css|png|jpe?g|webp|avif|gif|svg|woff2?|ttf|mp4)(\?|$)|\/_next\/image|\/_next\/static\/css/.test(ref)) continue;
    if (!assetMap.has(ref) && /^(https?:)/.test(ref) && !/\/(products|collections)\//.test(new URL(ref).pathname)) await fetchAsset(ref);
  }
  for (const [remote, local] of assetMap) {
    const variants = [remote, remote.replace(/&/g, "&amp;")];
    for (const v of variants) html = html.replace(new RegExp(escapeRe(v), "g"), local);
  }
  // Same-site links become local paths (the mirror server serves what was captured).
  html = html.replace(new RegExp(`href="${escapeRe(ORIGIN)}`, "g"), 'href="').replace(/href="https:\/\/joinfleek\.com/g, 'href="');
  writeFileSync(join(PAGES, `${name}.html`), html);
  return data.productLinks;
}

async function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(PAGES, { recursive: true });
  writeFileSync(join(OUT, "README.txt"), "LOCAL ONLY. Snapshot of a third-party website for a private demo rehearsal. Never commit, push, deploy or share this folder.\n");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, userAgent: UA });
  const routes = {};
  const homeLinks = await snapshot(page, "/home", "home");
  routes["/"] = "home.html";
  routes["/home"] = "home.html";
  const colLinks = await snapshot(page, "/collections/all", "collection-all");
  routes["/collections/all"] = "collection-all.html";
  const products = [...new Set([...homeLinks, ...colLinks])].slice(0, PRODUCTS);
  for (const [i, path] of products.entries()) {
    await snapshot(page, path, `product-${i}`);
    routes[path] = `product-${i}.html`;
  }
  await browser.close();
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ origin: ORIGIN, capturedAt: new Date().toISOString(), routes, assets: assetMap.size }, null, 2));
  console.log(`\nSaved ${Object.keys(routes).length} routes and ${assetMap.size} assets to .mirror/ (local only, gitignored).`);
  console.log("Run: npm run dev:mirror  →  http://localhost:3003");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
