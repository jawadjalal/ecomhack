/**
 * The agent-readiness checks, as pure functions over what the fetcher collected. No network here,
 * so every verdict is unit-testable with fixture pages.
 */
import type { ReadinessCategory, ReadinessCheck, ReadinessReport, StorePlatform } from "@/lib/contracts";
import {
  detectPlatform,
  findNode,
  hasVisiblePrice,
  jsonLdNodes,
  links,
  looksLikeProductUrl,
  metaDescription,
  offersOf,
  policyLinks,
  title,
  visibleTextLength,
} from "./html";
import { ASSISTANT_AGENTS, isAllowed, parseRobots, TRAINING_AGENTS } from "./robots";

/** One HTTP result, as the fetcher saw it. `status` 0 = network error / blocked by us. */
export interface Fetched {
  url: string;
  status: number;
  body: string;
  headers: Record<string, string>;
  error?: string;
}

export interface Artifacts {
  url: string;
  home: Fetched;
  robots?: Fetched;
  sitemap?: Fetched;
  llms?: Fetched;
  agentCard?: Fetched;
  mcp?: { ok: boolean; status: number; tools: string[]; error?: string };
  /** Shopify's public catalog JSON (/products.json), when the store is on Shopify. */
  productsJson?: Fetched;
  product?: Fetched;
  ucp?: Fetched;
}

const ok = (f?: Fetched) => Boolean(f && f.status >= 200 && f.status < 300);

type Json = Record<string, unknown>;

interface ShopifyProduct {
  title: string;
  handle: string;
  variants?: { price?: string; available?: boolean }[];
}

export function shopifyProducts(f?: Fetched): ShopifyProduct[] {
  if (!ok(f)) return [];
  try {
    const parsed = JSON.parse(f!.body) as { products?: ShopifyProduct[] };
    return Array.isArray(parsed.products) ? parsed.products.filter((p) => p && typeof p.handle === "string") : [];
  } catch {
    return [];
  }
}

/** The product page URL to inspect: Shopify catalog → sitemap → homepage links. */
export function pickProductUrl(a: Pick<Artifacts, "url" | "home" | "sitemap" | "productsJson">): string | undefined {
  const origin = new URL(a.home.url || a.url).origin;
  const shop = shopifyProducts(a.productsJson)[0];
  if (shop) return `${origin}/products/${shop.handle}`;
  if (ok(a.sitemap)) {
    const locs = [...a.sitemap!.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    const hit = locs.find((l) => {
      try {
        return new URL(l).origin === origin && looksLikeProductUrl(l);
      } catch {
        return false;
      }
    });
    if (hit) return hit;
  }
  if (ok(a.home)) return links(a.home.body, a.home.url).find(looksLikeProductUrl);
  return undefined;
}

function check(
  id: string,
  category: ReadinessCategory,
  weight: number,
  title: string,
  status: ReadinessCheck["status"],
  detail: string,
  extra: Partial<ReadinessCheck> = {},
): ReadinessCheck {
  return { id, category, weight, title, status, detail, ...extra };
}

/* ------------------------------------------------------------------ access */

function checkAssistants(a: Artifacts, productPath: string): ReadinessCheck[] {
  const title = "AI shopping assistants can reach the store";
  if (!ok(a.robots)) {
    const missing = a.robots && a.robots.status === 404;
    return [
      check("robots-assistants", "access", 15, title, "pass", missing ? "No robots.txt, so every agent is allowed." : "robots.txt couldn't be read; agents treat that as allowed.", {
        evidence: a.robots ? [`robots.txt: HTTP ${a.robots.status || "error"}`] : [],
      }),
    ];
  }
  const robots = parseRobots(a.robots!.body);
  const blocked = ASSISTANT_AGENTS.filter((ag) => !isAllowed(robots, ag.token, "/") || !isAllowed(robots, ag.token, productPath));
  const training = TRAINING_AGENTS.filter((t) => !isAllowed(robots, t, "/"));
  const out: ReadinessCheck[] = [
    blocked.length
      ? check("robots-assistants", "access", 15, title, blocked.length >= 3 ? "fail" : "warn", `robots.txt blocks ${blocked.length} AI shopping assistant${blocked.length === 1 ? "" : "s"}: shoppers asking them won't see your products.`, {
          evidence: blocked.map((b) => `${b.token} (${b.name}) is disallowed`),
          fix: {
            summary: "Allow the assistants that search and browse for shoppers. You can still block model-training crawlers separately.",
            snippet: blocked.map((b) => `User-agent: ${b.token}\nAllow: /`).join("\n\n"),
            snippetLang: "text",
          },
        })
      : check("robots-assistants", "access", 15, title, "pass", "robots.txt lets ChatGPT, Claude, Perplexity, Google and Apple assistants fetch your pages.", {
          evidence: [`Checked ${ASSISTANT_AGENTS.length} assistant agents on / and ${productPath}`],
        }),
  ];
  out.push(
    check(
      "robots-training",
      "access",
      0,
      "Model-training crawlers",
      training.length ? "warn" : "pass",
      training.length
        ? `You block ${training.length} training crawler${training.length === 1 ? "" : "s"} (${training.join(", ")}). That's a business choice and doesn't stop shopping assistants.`
        : "Training crawlers are allowed. Block them if you'd rather not have your content used for model training; it won't affect shopping assistants.",
      { informational: true },
    ),
  );
  return out;
}

function checkReachable(a: Artifacts): ReadinessCheck {
  const title = "Pages load for automated visitors";
  const s = a.home.status;
  const wall = /cf-chl|challenge-platform|captcha|Attention Required|Access denied|px-captcha|_Incapsula_/i.test(a.home.body);
  if (s >= 200 && s < 300 && !wall) return check("reachable", "access", 10, title, "pass", `Your storefront answered HTTP ${s} to an automated request.`);
  return check(
    "reachable",
    "access",
    10,
    title,
    "fail",
    s === 0
      ? `We couldn't load the page (${a.home.error ?? "network error"}).`
      : wall || s === 403 || s === 429 || s === 503
        ? `A bot wall or firewall answered (HTTP ${s}). Agents shopping for people are turned away before they see a product.`
        : `The storefront answered HTTP ${s}.`,
    {
      fix: {
        summary: "Let verified AI assistants through your bot protection (Cloudflare 'Verified bots' / allow-list their user agents), while keeping rate limits.",
      },
    },
  );
}

function checkHttps(a: Artifacts): ReadinessCheck {
  const https = new URL(a.home.url || a.url).protocol === "https:";
  return check("https", "access", 5, "Served over HTTPS", https ? "pass" : "fail", https ? "The store is served over HTTPS." : "The store isn't served over HTTPS; many agents refuse to shop on plain HTTP.", {
    ...(https ? {} : { fix: { summary: "Serve the storefront over HTTPS (your host or CDN can issue a certificate for free)." } }),
  });
}

/* ------------------------------------------------------------------ understand */

function checkRendered(a: Artifacts): ReadinessCheck {
  const title = "Content is in the HTML (no JavaScript needed)";
  const page = ok(a.product) ? a.product! : a.home;
  if (!ok(page)) return check("rendered", "understand", 8, title, "fail", "We couldn't load a page to read.");
  const textLen = visibleTextLength(page.body);
  const price = hasVisiblePrice(page.body);
  const ld = jsonLdNodes(page.body).length > 0;
  if (textLen > 400 && (price || ld)) {
    return check("rendered", "understand", 8, title, "pass", "Product text and prices are in the server-rendered HTML, so agents that don't run JavaScript can read them.", {
      evidence: [`${textLen.toLocaleString("en-GB")} characters of text${price ? ", prices visible" : ""}${ld ? ", JSON-LD present" : ""}`],
    });
  }
  return check(
    "rendered",
    "understand",
    8,
    title,
    textLen > 400 ? "warn" : "fail",
    textLen > 400 ? "Text is there, but no prices were visible without JavaScript." : "The page is nearly empty until JavaScript runs. Most agents read the raw HTML and see nothing to buy.",
    {
      evidence: [`${textLen} characters of visible text in ${page.url}`],
      fix: { summary: "Server-render product names, prices and stock (SSR/SSG), or at least publish them as JSON-LD in the HTML." },
    },
  );
}

function checkProductJsonLd(a: Artifacts, productUrl?: string): ReadinessCheck[] {
  const title = "Products are described in structured data";
  const shop = shopifyProducts(a.productsJson)[0];
  const example = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: shop?.title ?? "Your product name",
    image: "https://…/product.jpg",
    sku: "SKU-123",
    brand: { "@type": "Brand", name: "Your brand" },
    offers: {
      "@type": "Offer",
      price: shop?.variants?.[0]?.price ?? "49.00",
      priceCurrency: "GBP",
      availability: "https://schema.org/InStock",
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: "4.95", currency: "GBP" },
        deliveryTime: { "@type": "ShippingDeliveryTime", transitTime: { "@type": "QuantitativeValue", minValue: 2, maxValue: 3, unitCode: "DAY" } },
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        merchantReturnDays: 30,
        returnFees: "https://schema.org/FreeReturn",
      },
    },
  };
  const fixSnippet = `<script type="application/ld+json">\n${JSON.stringify(example, null, 2)}\n</script>`;

  if (!productUrl || !ok(a.product)) {
    return [
      check("product-jsonld", "understand", 12, title, "fail", "We couldn't find a product page from your homepage, sitemap or catalog, so agents probably can't either.", {
        fix: { summary: "Link products from the homepage and list them in sitemap.xml, each with Product JSON-LD.", snippet: fixSnippet, snippetLang: "html", darwinCanFix: true },
      }),
      check("offer-details", "understand", 8, "Delivery and returns are machine-readable", "fail", "No product page to check.", {}),
    ];
  }
  const nodes = jsonLdNodes(a.product!.body);
  const product = findNode(nodes, "Product", "ProductGroup");
  if (!product) {
    return [
      check("product-jsonld", "understand", 12, title, "fail", "The product page has no Product JSON-LD. Agents have to guess the price, currency and stock from the page layout.", {
        evidence: [productUrl],
        fix: { summary: "Add Product JSON-LD with price, currency and availability to every product page.", snippet: fixSnippet, snippetLang: "html", darwinCanFix: true },
      }),
      check("offer-details", "understand", 8, "Delivery and returns are machine-readable", "fail", "Without structured offers, agents can't answer \"will it arrive by Friday?\" or \"are returns free?\".", {
        fix: { summary: "Add shippingDetails and hasMerchantReturnPolicy to each Offer.", snippet: fixSnippet, snippetLang: "html", darwinCanFix: true },
      }),
    ];
  }
  const offers = offersOf(product as Json);
  const offer = offers[0] ?? {};
  const missing = [
    !offer.price && !offer.lowPrice && "price",
    !offer.priceCurrency && "priceCurrency",
    !offer.availability && "availability",
    !product.image && "image",
  ].filter(Boolean) as string[];
  const out: ReadinessCheck[] = [
    missing.length
      ? check("product-jsonld", "understand", 12, title, missing.length > 1 ? "fail" : "warn", `Product JSON-LD is there but missing ${missing.join(", ")}.`, {
          evidence: [productUrl],
          fix: { summary: `Add ${missing.join(", ")} to the Product/Offer JSON-LD.`, snippet: fixSnippet, snippetLang: "html", darwinCanFix: true },
        })
      : check("product-jsonld", "understand", 12, title, "pass", `Product JSON-LD includes price, currency, availability and images.`, {
          evidence: [`${String(product.name ?? "Product")}: ${String(offer.price ?? offer.lowPrice)} ${String(offer.priceCurrency ?? "")}`, productUrl],
        }),
  ];
  const shipping = offers.some((o) => o.shippingDetails);
  const returns = offers.some((o) => o.hasMerchantReturnPolicy) || Boolean(product.hasMerchantReturnPolicy);
  out.push(
    shipping && returns
      ? check("offer-details", "understand", 8, "Delivery and returns are machine-readable", "pass", "Offers include shipping details and a return policy, so agents can check delivery times and returns before buying.")
      : check(
          "offer-details",
          "understand",
          8,
          "Delivery and returns are machine-readable",
          shipping || returns ? "warn" : "fail",
          `Offers are missing ${[!shipping && "shipping details (cost, delivery time)", !returns && "a return policy"].filter(Boolean).join(" and ")}. Agents with a deadline or a returns requirement walk away.`,
          { fix: { summary: "Add OfferShippingDetails and MerchantReturnPolicy to each Offer.", snippet: fixSnippet, snippetLang: "html", darwinCanFix: true } },
        ),
  );
  return out;
}

function checkOrgJsonLd(a: Artifacts): ReadinessCheck {
  const nodes = ok(a.home) ? jsonLdNodes(a.home.body) : [];
  const org = findNode(nodes, "Organization", "OnlineStore", "Store", "Corporation");
  const site = findNode(nodes, "WebSite");
  const search = site && site.potentialAction;
  const title = "The store identifies itself";
  if (org && site) return check("org-jsonld", "understand", 4, title, "pass", `Organization and WebSite JSON-LD found${search ? ", with a search action" : ""}.`);
  const origin = new URL(a.home.url || a.url).origin;
  return check("org-jsonld", "understand", 4, title, org || site ? "warn" : "fail", `Missing ${[!org && "Organization", !site && "WebSite"].filter(Boolean).join(" and ")} JSON-LD on the homepage, so agents can't confirm who they're buying from.`, {
    fix: {
      summary: "Add Organization and WebSite (with a SearchAction) JSON-LD to the homepage.",
      snippet: `<script type="application/ld+json">\n${JSON.stringify(
        [
          { "@context": "https://schema.org", "@type": "Organization", name: title_(a) ?? "Your store", url: origin, logo: `${origin}/logo.png` },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            url: origin,
            potentialAction: { "@type": "SearchAction", target: `${origin}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
          },
        ],
        null,
        2,
      )}\n</script>`,
      snippetLang: "html",
      darwinCanFix: true,
    },
  });
}

function title_(a: Artifacts): string | undefined {
  return ok(a.home) ? title(a.home.body)?.split(/[|–—-]/)[0]?.trim() : undefined;
}

function checkSitemap(a: Artifacts): ReadinessCheck {
  const found = ok(a.sitemap) && /<(urlset|sitemapindex)/i.test(a.sitemap!.body);
  return check("sitemap", "understand", 4, "There's a sitemap", found ? "pass" : "fail", found ? `sitemap.xml found (${a.sitemap!.url}).` : "No sitemap.xml, so agents have to crawl links to find products.", {
    ...(found ? {} : { fix: { summary: "Publish /sitemap.xml listing every product and reference it from robots.txt (Sitemap: https://…/sitemap.xml)." } }),
  });
}

/* ------------------------------------------------------------------ act */

function checkLlmsTxt(a: Artifacts, generated: string): ReadinessCheck {
  const found = ok(a.llms) && a.llms!.body.trim().length > 20 && !/<html/i.test(a.llms!.body.slice(0, 200));
  return check("llms-txt", "act", 8, "llms.txt tells agents how to shop", found ? "pass" : "fail", found ? "An /llms.txt is published." : "No /llms.txt: agents get no summary of what you sell or how to buy.", {
    ...(found ? {} : { fix: { summary: "Publish /llms.txt. We drafted one from your catalog: review it and upload it to your site root.", snippet: generated, snippetLang: "text", darwinCanFix: true } }),
  });
}

function checkMcp(a: Artifacts, platform: StorePlatform): ReadinessCheck {
  const title = "Agents can shop through an API (MCP)";
  if (a.mcp?.ok) {
    return check("mcp", "act", 12, title, "pass", `An MCP endpoint answers at /api/mcp${a.mcp.tools.length ? ` with ${a.mcp.tools.length} tools` : ""}.`, {
      evidence: a.mcp.tools.length ? [a.mcp.tools.slice(0, 8).join(", ")] : [],
    });
  }
  return check("mcp", "act", 12, title, "fail", "No MCP endpoint: agents have to scrape pages and click through checkout instead of calling search, cart and checkout tools.", {
    fix: {
      summary:
        platform === "shopify"
          ? "Shopify stores normally expose a Storefront MCP endpoint at /api/mcp; check it isn't blocked by an app or proxy. Darwin can host a richer one (stock, delivery, negotiation) for your catalog."
          : "Darwin can host an MCP endpoint for your catalog (search, availability, cart, checkout) without changing your theme.",
      darwinCanFix: true,
    },
  });
}

function checkAgentCard(a: Artifacts): ReadinessCheck {
  let valid = false;
  if (ok(a.agentCard)) {
    try {
      const card = JSON.parse(a.agentCard!.body) as Json;
      valid = typeof card.name === "string" && (typeof card.url === "string" || Array.isArray(card.supportedInterfaces));
    } catch {
      valid = false;
    }
  }
  return check("agent-card", "act", 6, "Other agents can talk to your store (A2A)", valid ? "pass" : "fail", valid ? "An A2A agent card is published at /.well-known/agent-card.json." : "No A2A agent card: buyer agents can't discover a merchant agent to ask questions or negotiate with.", {
    ...(valid ? {} : { fix: { summary: "Publish /.well-known/agent-card.json pointing at a merchant agent. Darwin runs one for you (A2A v1.0 and v0.3).", darwinCanFix: true } }),
  });
}

function checkCatalogApi(a: Artifacts): ReadinessCheck {
  const shop = shopifyProducts(a.productsJson);
  const mcpSearch = a.mcp?.tools.some((t) => /search|catalog|product/i.test(t));
  const pass = shop.length > 0 || mcpSearch;
  return check("catalog-api", "act", 4, "The catalog is available as data", pass ? "pass" : "fail", pass ? (shop.length ? "Your catalog is readable as JSON (/products.json)." : "Your MCP endpoint exposes product search.") : "There's no machine-readable catalog; agents compare you on scraped pages.", {
    ...(pass ? {} : { fix: { summary: "Expose your catalog as data: a product feed, /products.json, or an MCP search tool.", darwinCanFix: true } }),
  });
}

function checkPolicies(a: Artifacts): ReadinessCheck {
  const found = ok(a.home) ? policyLinks(links(a.home.body, a.home.url)) : [];
  return check("policies", "act", 4, "Delivery and returns policies are linked", found.length ? "pass" : "fail", found.length ? `Found ${found.length} policy link${found.length === 1 ? "" : "s"} on the homepage.` : "No delivery or returns policy linked from the homepage, so agents can't check the terms before buying.", {
    evidence: found.slice(0, 3),
    ...(found.length ? {} : { fix: { summary: "Link your shipping and returns policies from the footer of every page." } }),
  });
}

function checkUcp(a: Artifacts): ReadinessCheck {
  const found = ok(a.ucp);
  return check("ucp", "act", 0, "Universal Commerce Protocol profile", found ? "pass" : "warn", found ? "A UCP profile is published at /.well-known/ucp." : "No /.well-known/ucp profile. UCP is an emerging standard for agent checkout; worth watching, not required yet.", {
    informational: true,
  });
}

/* ------------------------------------------------------------------ llms.txt draft */

export function draftLlmsTxt(a: Artifacts, productUrl?: string): string {
  const origin = new URL(a.home.url || a.url).origin;
  const name = title_(a) ?? new URL(origin).hostname;
  const about = ok(a.home) ? (metaDescription(a.home.body) ?? "") : "";
  const shop = shopifyProducts(a.productsJson).slice(0, 12);
  const productLines = shop.length
    ? shop.map((p) => `- [${p.title}](${origin}/products/${p.handle})${p.variants?.[0]?.price ? `: ${p.variants[0].price}` : ""}`)
    : productUrl
      ? [`- [Example product](${productUrl})`]
      : ["- (list your key products or collections here)"];
  const policies = ok(a.home) ? policyLinks(links(a.home.body, a.home.url)).slice(0, 4) : [];
  return [
    `# ${name}`,
    "",
    `> ${about || `${name} online store.`}`,
    "",
    "## Products",
    "",
    ...productLines,
    "",
    "## How to shop",
    "",
    `- Browse: ${origin}${ok(a.sitemap) ? ` (sitemap: ${a.sitemap!.url})` : ""}`,
    a.mcp?.ok ? `- MCP: POST ${origin}/api/mcp` : "- MCP: not available yet",
    shop.length ? `- Catalog JSON: ${origin}/products.json` : "",
    "",
    "## Policies",
    "",
    ...(policies.length ? policies.map((p) => `- ${p}`) : ["- Delivery: (add your delivery times and costs)", "- Returns: (add your returns window and fees)"]),
    "",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

/* ------------------------------------------------------------------ report */

export function evaluate(a: Artifacts): Omit<ReadinessReport, "checkedAt" | "durationMs"> {
  const origin = new URL(a.home.url || a.url).origin;
  const platform = detectPlatform(a.home.body, a.home.headers);
  const productUrl = a.product?.url ?? pickProductUrl(a);
  const productPath = productUrl ? new URL(productUrl).pathname : "/products/example";
  const llmsTxt = draftLlmsTxt(a, productUrl);

  const checks: ReadinessCheck[] = [
    ...checkAssistants(a, productPath),
    checkReachable(a),
    checkHttps(a),
    checkRendered(a),
    ...checkProductJsonLd(a, productUrl),
    checkOrgJsonLd(a),
    checkSitemap(a),
    checkLlmsTxt(a, llmsTxt),
    checkMcp(a, platform),
    checkAgentCard(a),
    checkCatalogApi(a),
    checkPolicies(a),
    checkUcp(a),
  ];
  return { url: a.url, origin, platform, productUrl, generated: { llmsTxt }, checks, ...score(checks) };
}

const POINTS: Record<ReadinessCheck["status"], number> = { pass: 1, warn: 0.5, fail: 0 };

export function score(checks: ReadinessCheck[]): Pick<ReadinessReport, "score" | "grade" | "categories"> {
  const categories: ReadinessReport["categories"] = { access: { score: 0, max: 0 }, understand: { score: 0, max: 0 }, act: { score: 0, max: 0 } };
  for (const c of checks) {
    if (c.informational || !c.weight) continue;
    categories[c.category].max += c.weight;
    categories[c.category].score += c.weight * POINTS[c.status];
  }
  for (const k of Object.keys(categories) as ReadinessCategory[]) categories[k].score = Math.round(categories[k].score * 10) / 10;
  const max = Object.values(categories).reduce((s, c) => s + c.max, 0) || 1;
  const total = Math.round((Object.values(categories).reduce((s, c) => s + c.score, 0) / max) * 100);
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";
  return { score: total, grade, categories };
}
