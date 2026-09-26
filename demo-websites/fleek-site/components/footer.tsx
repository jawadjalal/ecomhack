import Link from "next/link";
import { specBadge, type PageSpec } from "@/lib/spec";
import { Logo } from "./header";

export function Footer({ spec }: { spec: PageSpec }) {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div>
          <h4>Platform</h4>
          <ul>
            <li><Link href="/account?mode=signup">Sell on Rackd</Link></li>
            <li><Link href="/#how-it-works">How it works</Link></li>
            <li><Link href="/#closer">Download the mobile app</Link></li>
          </ul>
        </div>
        <div>
          <h4>Information</h4>
          <ul>
            <li><Link href="/#how-it-works">FAQ</Link></li>
            <li><a href="/llms.txt">For AI assistants</a></li>
            <li><a href="/api/catalog">Catalog API</a></li>
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            <li><Link href="/#built-for-resellers">About us</Link></li>
            <li><Link href="/#suppliers">Suppliers</Link></li>
          </ul>
        </div>
        <div>
          <h4>Resources</h4>
          <ul>
            <li><Link href="/bundles?sort=price-asc">New Reseller</Link></li>
            <li><Link href="/bundles?sort=bestselling">Full-Time Reseller</Link></li>
            <li><Link href="/bundles">Business</Link></li>
          </ul>
        </div>
      </div>
      <div className="footer-base">
        <Logo />
        <div className="legal">
          <span>Terms</span>
          <span>Privacy</span>
          <span>Cookie policy</span>
        </div>
        <div className="social" aria-hidden>
          <i>ig</i>
          <i>f</i>
          <i>tt</i>
          <i>in</i>
        </div>
      </div>
      <div className="footer-note">
        <span>Rackd is a fictional demo store for Darwin. Nothing is for sale and no payment is taken.</span>
        <span className="config-badge" title="storefront.config.json (Darwin PageSpec)" id="config-badge">
          <i />
          storefront.config.json · {specBadge(spec)}
        </span>
      </div>
    </footer>
  );
}
