import Link from "next/link";
import type { PageSpec } from "@/lib/page-spec";

const DIRECTORY: [string, [string, string][]][][] = [
  [["Shop and Learn", [["Store", "/store"], ["Book", "/products/orchard-book-air"], ["Pad", "/products/orchard-pad-air"], ["Phone", "/products/orchard-phone-17-pro"], ["Watch", "/products/orchard-watch-11"], ["Buds", "/products/orchard-buds-pro"], ["Accessories", "/store#accessories"], ["Gift Cards", "/store"]]]],
  [
    ["Account", [["Manage your Orchard ID", "/support"], ["Orchard Store account", "/support"]]],
    ["Entertainment", [["Orchard TV+", "/"], ["Orchard Music", "/"], ["Orchard Arcade", "/"]]],
  ],
  [["Orchard Store", [["Find a Store", "/support"], ["Delivery", "/support#delivery"], ["Returns", "/support#returns"], ["Financing", "/support"], ["Order Status", "/support"], ["Shopping Help", "/support"]]]],
  [
    ["For Business", [["Orchard and Business", "/support"]]],
    ["For AI shoppers", [["Product catalogue (JSON)", "/api/catalog"], ["llms.txt", "/llms.txt"]]],
  ],
  [["Orchard Values", [["Accessibility", "/support"], ["Environment", "/support"], ["Privacy", "/support"]]], ["About Orchard", [["Newsroom", "/support"], ["Contact Orchard", "/support"]]]],
];

export function Footer({ spec, file }: { spec: PageSpec; file: string }) {
  return (
    <footer className="globalfooter">
      <div className="globalfooter-content">
        <section className="footer-sosumi">
          <p>
            Orchard is a fictional brand, built to demo Darwin, the storefront that improves itself. Products, prices, finance offers, ratings and
            reviews on this site are made up. Nothing is for sale and no payment is ever taken.
          </p>
          <ol>
            <li>Monthly prices are illustrative: the price divided over 30 months at 0% interest.</li>
            <li>Battery and performance claims describe fictional products.</li>
          </ol>
        </section>
        <nav className="footer-directory" aria-label="Orchard directory">
          {DIRECTORY.map((column, i) => (
            <div key={i}>
              {column.map(([title, links]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <ul>
                    {links.map(([label, href]) => (
                      <li key={label}>
                        <Link href={href}>{label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </nav>
        <section className="footer-shop">
          More ways to shop: <Link href="/support">find an Orchard Store</Link> or <Link href="/support">other retailer</Link> near you.
        </section>
        <section className="footer-legal">
          <span>Copyright © 2026 Orchard Demo Ltd. All rights reserved.</span>
          <ul>
            <li>
              <Link href="/support">Privacy Policy</Link>
            </li>
            <li>
              <Link href="/support">Terms of Use</Link>
            </li>
            <li>
              <Link href="/support#returns">Sales and Refunds</Link>
            </li>
            <li>
              <Link href="/support">Site Map</Link>
            </li>
          </ul>
          <span className="footer-config" data-darwin="config-version" title={file}>
            Config v{spec.version} · {spec.label}
          </span>
        </section>
      </div>
    </footer>
  );
}
