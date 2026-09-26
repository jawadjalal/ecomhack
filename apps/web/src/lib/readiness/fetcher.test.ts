import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// DNS is ours: the first answer for a name is what gets vetted; a rebinding resolver would answer differently next time.
const dns = vi.hoisted(() => ({ answers: new Map<string, string[]>(), calls: [] as string[] }));
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    dns.calls.push(host);
    const next = dns.answers.get(host)?.shift();
    if (!next) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return [{ address: next, family: next.includes(":") ? 6 : 4 }];
  },
}));

import { assertPublicUrl, blockedReason, embeddedIPv4, pinnedLookup, safeFetch } from "./fetcher";

describe("fetcher: address normalisation", () => {
  it.each([
    ["::ffff:127.0.0.1", "127.0.0.1"],
    ["::ffff:7f00:1", "127.0.0.1"],
    ["0:0:0:0:0:ffff:7f00:1", "127.0.0.1"],
    ["::FFFF:A9FE:A9FE", "169.254.169.254"],
    ["::ffff:0:a00:1", "10.0.0.1"],
    ["::127.0.0.1", "127.0.0.1"],
    ["::a9fe:a9fe", "169.254.169.254"],
    ["64:ff9b::a9fe:a9fe", "169.254.169.254"],
    ["64:ff9b::10.0.0.1", "10.0.0.1"],
    ["2002:a9fe:a9fe::1", "169.254.169.254"],
    ["2002:c0a8:0101::", "192.168.1.1"],
  ])("%s carries %s", (v6, v4) => {
    expect(embeddedIPv4(v6)).toBe(v4);
  });

  it("leaves plain IPv6 alone", () => {
    expect(embeddedIPv4("::1")).toBeNull();
    expect(embeddedIPv4("::")).toBeNull();
    expect(embeddedIPv4("2606:4700::1111")).toBeNull();
  });

  it("blocks private IPv4 however it is written inside IPv6", () => {
    for (const ip of ["::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "[::ffff:c0a8:101]", "::a00:1", "64:ff9b::a9fe:a9fe", "2002:a00:1::", "::ffff:0:a9fe:a9fe"]) {
      expect(blockedReason(ip), ip).toMatch(/private|reserved/);
    }
    expect(blockedReason("::ffff:8.8.8.8")).toBeNull();
    expect(blockedReason("64:ff9b::808:808")).toBeNull();
    expect(blockedReason("2002:808:808::1")).toBeNull();
  });

  it("blocks mapped loopback when loopback is off", () => {
    vi.stubEnv("DARWIN_READINESS_ALLOW_LOCAL", "0");
    try {
      for (const ip of ["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::"]) {
        expect(blockedReason(ip), ip).toBe("loopback address");
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("blocks IPv6 unique-local, link-local, multicast and unspecified", () => {
    for (const ip of ["::", "0::0", "fc00::1", "fd12:3456::1", "fe80::1", "FE80::1%eth0", "febf::1", "fec0::1", "ff02::1", "2001::1", "2001:db8::1"]) {
      expect(blockedReason(ip), ip).toMatch(/private|reserved/);
    }
    // "fc::1" is 00fc::1, not fc00::/7
    expect(blockedReason("fc::1")).toBeNull();
  });

  it("reads other spellings of IPv4 and refuses anything that isn't an address", () => {
    expect(blockedReason("2852039166")).toMatch(/private|reserved/); // 169.254.169.254
    expect(blockedReason("0xa9.0xfe.0xa9.0xfe")).toMatch(/private|reserved/);
    expect(blockedReason("012.0.0.1")).toMatch(/private/); // octal 10.0.0.1
    expect(blockedReason("not-an-ip")).toBe("malformed address");
  });

  it("rejects URLs that spell a private address differently", async () => {
    for (const u of ["http://[::ffff:169.254.169.254]/", "http://[::ffff:a9fe:a9fe]/latest", "http://[64:ff9b::a9fe:a9fe]/", "http://2852039166/", "http://0xa9fea9fe/", "http://[fe80::1]/"]) {
      await expect(assertPublicUrl(u), u).rejects.toThrow(/can't be checked/);
    }
  });
});

describe("fetcher: pinned connections", () => {
  let server: Server;
  let port = 0;
  const seen: { host?: string; path?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ host: req.headers.host, path: req.url });
      if (req.url === "/hop") {
        res.writeHead(302, { location: `http://rebound.test:${port}/private` }).end();
      } else if (req.url === "/hop-ok") {
        res.writeHead(301, { location: "/done" }).end();
      } else if (req.url === "/gz") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(gzipSync("<h1>zipped</h1>"));
      } else {
        res.writeHead(200, { "content-type": "text/plain" }).end(`pinned ${req.url}`);
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  beforeEach(() => {
    dns.answers.clear();
    dns.calls.length = 0;
    seen.length = 0;
  });

  it("answers every lookup with the vetted address", () => {
    const lookup = pinnedLookup("93.184.215.14", 4);
    const one = vi.fn();
    const all = vi.fn();
    lookup("evil.test", {}, one);
    lookup("evil.test", { all: true }, all);
    expect(one).toHaveBeenCalledWith(null, "93.184.215.14", 4);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.215.14", family: 4 }]);
  });

  it("connects to the address it vetted, not to a second DNS answer", async () => {
    // A rebinding resolver: public-looking first (vetted), then the metadata address.
    dns.answers.set("shop.test", ["127.0.0.1", "169.254.169.254"]);
    const res = await safeFetch(`http://shop.test:${port}/page`);
    expect(res).toMatchObject({ status: 200, body: "pinned /page" });
    expect(seen).toEqual([{ host: `shop.test:${port}`, path: "/page" }]);
    // resolved exactly once: the socket never asked DNS again (shop.test doesn't exist outside this test)
    expect(dns.calls).toEqual(["shop.test"]);
  });

  it("re-checks every redirect hop", async () => {
    dns.answers.set("shop.test", ["127.0.0.1", "127.0.0.1", "127.0.0.1"]);
    dns.answers.set("rebound.test", ["10.0.0.7"]);
    const blocked = await safeFetch(`http://shop.test:${port}/hop`);
    expect(blocked.status).toBe(0);
    expect(blocked.error).toMatch(/rebound\.test points to a private/);

    const ok = await safeFetch(`http://shop.test:${port}/hop-ok`);
    expect(ok).toMatchObject({ status: 200, body: "pinned /done", url: `http://shop.test:${port}/done` });
    expect(dns.calls).toEqual(["shop.test", "rebound.test", "shop.test", "shop.test"]);
  });

  it("decodes compressed bodies and returns headers", async () => {
    dns.answers.set("shop.test", ["127.0.0.1"]);
    const res = await safeFetch(`http://shop.test:${port}/gz`);
    expect(res.body).toBe("<h1>zipped</h1>");
    expect(res.headers["content-type"]).toBe("text/html");
  });
});
