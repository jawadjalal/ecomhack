import { describe, expect, it, vi } from "vitest";
import { evaluate, type Artifacts, type Fetched } from "./checks";
import {
  assertPublicUrl,
  blockedReason,
  expandIpv6,
  safeFetch,
} from "./fetcher";
import { isAllowed, parseRobots } from "./robots";
import { normaliseStoreUrl } from "./index";

const f = (
  url: string,
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): Fetched => ({ url, status, body, headers });
const missing = (url: string): Fetched => f(url, "Not found", 404);

const SHOP = "https://shop.example";

const productLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Trail Runner",
  image: `${SHOP}/trail.jpg`,
  offers: {
    "@type": "Offer",
    price: "120.00",
    priceCurrency: "GBP",
    availability: "https://schema.org/InStock",
    shippingDetails: { "@type": "OfferShippingDetails" },
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      merchantReturnDays: 30,
    },
  },
};

const shopifyHome = `<!doctype html><html><head><title>Trail Co | Running gear</title>
<meta name="description" content="Trail running shoes, made in Leeds.">
<script src="https://cdn.shopify.com/s/files/theme.js"></script>
<script type="application/ld+json">[{"@context":"https://schema.org","@type":"Organization","name":"Trail Co","url":"${SHOP}"},
{"@type":"WebSite","url":"${SHOP}","potentialAction":{"@type":"SearchAction"}}]</script></head>
<body><h1>Trail Co</h1><p>${"Shoes for mud, rock and rain. ".repeat(30)}</p>
<a href="/products/trail-runner">Trail Runner £120.00</a><a href="/policies/refund-policy">Returns</a><a href="/pages/shipping">Shipping</a></body></html>`;

const productPage = `<html><body><h1>Trail Runner</h1><p>${"Grippy, light, waterproof. ".repeat(30)}</p><span>£120.00</span>
<script type="application/ld+json">${JSON.stringify(productLd)}</script></body></html>`;

function shopify(over: Partial<Artifacts> = {}): Artifacts {
  return {
    url: `${SHOP}/`,
    home: f(`${SHOP}/`, shopifyHome),
    robots: f(
      `${SHOP}/robots.txt`,
      "User-agent: *\nDisallow: /cart\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://shop.example/sitemap.xml",
    ),
    sitemap: f(
      `${SHOP}/sitemap.xml`,
      `<urlset><url><loc>${SHOP}/products/trail-runner</loc></url></urlset>`,
    ),
    llms: missing(`${SHOP}/llms.txt`),
    agentCard: missing(`${SHOP}/.well-known/agent.json`),
    mcp: {
      ok: true,
      status: 200,
      tools: ["search_shop_catalog", "get_cart", "update_cart"],
    },
    productsJson: f(
      `${SHOP}/products.json`,
      JSON.stringify({
        products: [
          {
            title: "Trail Runner",
            handle: "trail-runner",
            variants: [{ price: "120.00" }],
          },
        ],
      }),
    ),
    product: f(`${SHOP}/products/trail-runner`, productPage),
    ucp: missing(`${SHOP}/.well-known/ucp`),
    ...over,
  };
}

const byId = (r: ReturnType<typeof evaluate>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("robots.txt", () => {
  it("applies the agent's own group, longest match and Allow on ties", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /\nAllow: /products/\n\nUser-agent: OAI-SearchBot\nUser-agent: PerplexityBot\nDisallow: /checkout\n\nSitemap: https://x/s.xml",
    );
    expect(isAllowed(r, "Googlebot", "/")).toBe(false);
    expect(isAllowed(r, "Googlebot", "/products/a")).toBe(true);
    expect(isAllowed(r, "OAI-SearchBot", "/")).toBe(true);
    expect(isAllowed(r, "PerplexityBot", "/checkout/1")).toBe(false);
    expect(r.sitemaps).toEqual(["https://x/s.xml"]);
    expect(
      isAllowed(
        parseRobots("User-agent: *\nDisallow: /*.json$"),
        "X",
        "/products.json",
      ),
    ).toBe(false);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "X", "/")).toBe(
      true,
    );
  });
});

describe("evaluate", () => {
  it("scores a well-built Shopify store highly and only flags what's missing", () => {
    const r = evaluate(shopify());
    expect(r.platform).toBe("shopify");
    expect(r.productUrl).toBe(`${SHOP}/products/trail-runner`);
    expect(byId(r, "robots-assistants").status).toBe("pass");
    expect(byId(r, "robots-training")).toMatchObject({
      status: "warn",
      informational: true,
    });
    expect(byId(r, "product-jsonld").status).toBe("pass");
    expect(byId(r, "offer-details").status).toBe("pass");
    expect(byId(r, "org-jsonld").status).toBe("pass");
    expect(byId(r, "mcp").status).toBe("pass");
    expect(byId(r, "catalog-api").status).toBe("pass");
    expect(byId(r, "policies").status).toBe("pass");
    expect(byId(r, "llms-txt").status).toBe("fail");
    expect(byId(r, "agent-card").status).toBe("fail");
    // 100 − llms.txt (8) − agent card (6)
    expect(r.score).toBe(86);
    expect(r.grade).toBe("A");
    // The llms.txt we draft comes from the real catalog.
    expect(r.generated.llmsTxt).toContain("# Trail Co");
    expect(r.generated.llmsTxt).toContain(
      `[Trail Runner](${SHOP}/products/trail-runner): 120.00`,
    );
    expect(r.generated.llmsTxt).toContain(`${SHOP}/policies/refund-policy`);
    expect(byId(r, "llms-txt").fix?.snippet).toBe(r.generated.llmsTxt);
  });

  it("flags blocked shopping assistants with the robots.txt lines to fix it", () => {
    const r = evaluate(
      shopify({
        robots: f(
          `${SHOP}/robots.txt`,
          "User-agent: OAI-SearchBot\nUser-agent: ChatGPT-User\nUser-agent: PerplexityBot\nDisallow: /",
        ),
      }),
    );
    const c = byId(r, "robots-assistants");
    expect(c.status).toBe("fail");
    expect(c.evidence).toEqual(
      expect.arrayContaining(["OAI-SearchBot (ChatGPT search) is disallowed"]),
    );
    expect(c.fix?.snippet).toContain("User-agent: ChatGPT-User\nAllow: /");
  });

  it("fails a JavaScript-only shell behind a bot wall", () => {
    const shell = `<html><head><title>Shop</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    const r = evaluate({
      url: `${SHOP}/`,
      home: f(`${SHOP}/`, `${shell}<!-- cf-chl -->`, 403),
      robots: missing(`${SHOP}/robots.txt`),
      sitemap: missing(`${SHOP}/sitemap.xml`),
      llms: missing(`${SHOP}/llms.txt`),
      agentCard: missing(`${SHOP}/.well-known/agent.json`),
      mcp: { ok: false, status: 404, tools: [] },
      productsJson: missing(`${SHOP}/products.json`),
    });
    expect(byId(r, "reachable").status).toBe("fail");
    expect(byId(r, "rendered").status).toBe("fail");
    expect(byId(r, "product-jsonld").status).toBe("fail");
    expect(byId(r, "robots-assistants").status).toBe("pass"); // no robots.txt = allowed
    expect(r.grade).toBe("F");
    expect(
      r.checks.filter((c) => c.fix?.darwinCanFix).map((c) => c.id),
    ).toEqual(
      expect.arrayContaining([
        "product-jsonld",
        "llms-txt",
        "mcp",
        "agent-card",
      ]),
    );
  });

  it("reports partial offers as a warning with the missing fields", () => {
    const thin = {
      ...productLd,
      offers: {
        "@type": "Offer",
        price: "120.00",
        priceCurrency: "GBP",
        availability: "InStock",
      },
    };
    const r = evaluate(
      shopify({
        product: f(
          `${SHOP}/products/trail-runner`,
          productPage.replace(JSON.stringify(productLd), JSON.stringify(thin)),
        ),
      }),
    );
    expect(byId(r, "product-jsonld").status).toBe("pass");
    expect(byId(r, "offer-details")).toMatchObject({ status: "fail" });
    expect(byId(r, "offer-details").detail).toMatch(
      /shipping details .* and a return policy/,
    );
  });
});

describe("safety", () => {
  it("blocks private, link-local and metadata addresses", () => {
    expect(blockedReason("169.254.169.254")).toMatch(/private|reserved/);
    expect(blockedReason("10.1.2.3")).toMatch(/private/);
    expect(blockedReason("192.168.1.10")).toMatch(/private/);
    expect(blockedReason("::ffff:10.0.0.1")).toMatch(/private/);
    expect(blockedReason("fd00::1")).toMatch(/private/);
    expect(blockedReason("8.8.8.8")).toBeNull();
    expect(blockedReason("2606:4700::1111")).toBeNull();
  });

  it("judges IPv6 forms that embed an IPv4 address by that address (no ::ffff: bypass)", async () => {
    vi.stubEnv("DARWIN_READINESS_ALLOW_LOCAL", "0");
    try {
      // The URL parser rewrites [::ffff:127.0.0.1] to [::ffff:7f00:1]: both notations must be blocked.
      expect(new URL("http://[::ffff:169.254.169.254]/").hostname).toBe(
        "[::ffff:a9fe:a9fe]",
      );
      for (const ip of [
        "::ffff:127.0.0.1",
        "::ffff:7f00:1",
        "::ffff:a9fe:a9fe",
        "0:0:0:0:0:ffff:a9fe:a9fe",
        "::ffff:0:a00:1",
        "::a9fe:a9fe",
        "::127.0.0.1",
        "64:ff9b::a9fe:a9fe",
        "2002:a9fe:a9fe::1",
        "2002:7f00:1::",
        "::1",
        "::",
        "fe80::1%eth0",
        "fec0::1",
        "ff02::1",
        "2001:0:4136:e378::1",
        "not-an-ip",
      ])
        expect(blockedReason(ip), ip).not.toBeNull();
      expect(blockedReason("::ffff:8.8.8.8")).toBeNull();
      expect(blockedReason("64:ff9b::808:808")).toBeNull();
      expect(blockedReason("2a00:1450:4009:81f::200e")).toBeNull();
      expect(expandIpv6("::ffff:127.0.0.1")).toEqual([
        0, 0, 0, 0, 0, 0xffff, 0x7f00, 1,
      ]);
      expect(expandIpv6("1:2:3")).toBeNull();
      await expect(
        assertPublicUrl("http://[::ffff:169.254.169.254]/latest"),
      ).rejects.toThrow(/can't be checked/);
      await expect(
        assertPublicUrl("http://[::ffff:127.0.0.1]:3000/"),
      ).rejects.toThrow(/loopback/);
      await expect(assertPublicUrl("http://0x7f000001/")).rejects.toThrow(
        /loopback/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("re-checks every redirect hop: a public page redirecting to a private address is never fetched", async () => {
    // safeFetch connects only to the address it vetted (node:http, pinned lookup) and vets every hop again;
    // the full redirect round trip against a local server lives in fetcher.test.ts ("re-checks every redirect hop").
    // Here: the private hop from this scenario is refused before any request is made.
    await expect(assertPublicUrl("http://[::ffff:169.254.169.254]/latest/meta-data")).rejects.toThrow(/can't be checked/);
    const r = await safeFetch("http://[::ffff:169.254.169.254]/latest/meta-data");
    expect(r.status).toBe(0);
    expect(r.body).toBe("");
    expect(r.error).toMatch(/can't be checked/);
  });

  it("rejects non-http URLs and credentials, and normalises bare domains", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://user:pw@example.com")).rejects.toThrow(
      /credentials/,
    );
    await expect(
      assertPublicUrl("http://169.254.169.254/latest"),
    ).rejects.toThrow(/can't be checked/);
    expect(normaliseStoreUrl("  shop.example/store#top ")).toBe(
      "https://shop.example/store",
    );
  });
});
