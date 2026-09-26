import { BrandWordmark } from "./logo";
import { StoreLink } from "./store-provider";

/** Footer entries that have a real page. */
const HREFS: Record<string, string> = { Delivery: "/store/help/delivery", Returns: "/store/help/returns" };

const COLS = [
  { title: "Shop", links: ["Road", "Trail", "Racing", "Accessories", "Gift cards"] },
  { title: "Help", links: ["Delivery", "Returns", "Size guide", "Contact us"] },
  { title: "PACE", links: ["Our story", "Run clubs", "Sustainability", "Journal"] },
];

export function StoreFooter({ slim = false, brand = "PACE" }: { slim?: boolean; brand?: string }) {
  if (slim) {
    return (
      <footer className="border-t border-black/10 bg-[#f6f4f1] px-4 py-6 text-center text-xs text-(--muted)">
        © 2026 {brand} · Demo store powered by Darwin · No real payments are taken
      </footer>
    );
  }
  return (
    <footer className="bg-[#0c0a09] text-white">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_2fr] lg:px-10">
        <div className="max-w-sm">
          <BrandWordmark brand={brand} />
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Performance running shoes designed in London and tested on the towpaths, trails and track of the UK.
          </p>
          <form className="mt-6 flex gap-2" aria-label="Newsletter">
            <label htmlFor="pace-newsletter" className="sr-only">
              Email address
            </label>
            <input
              id="pace-newsletter"
              type="email"
              placeholder="Email for early access"
              className="min-h-11 w-full rounded-(--r-input) border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/40 focus:border-white/50 focus:outline-none"
            />
            <button type="button" className="pace-btn pace-btn-dark-surface min-h-11 px-5 text-sm">
              Join
            </button>
          </form>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {COLS.map((c) => (
            <div key={c.title}>
              <h3 className="pace-eyebrow text-white/50">{c.title}</h3>
              <ul className="mt-4 space-y-2.5 text-sm text-white/80">
                {c.links.map((l) => (
                  <li key={l}>
                    {HREFS[l] ? (
                      <StoreLink href={HREFS[l]} className="hover:text-white">
                        {l}
                      </StoreLink>
                    ) : (
                      <span className="cursor-default hover:text-white">{l}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-6 text-xs text-white/45 sm:flex-row sm:justify-between sm:px-6 lg:px-10">
          <span>© 2026 PACE Running Ltd · Shoreditch, London</span>
          <span>Demo store powered by Darwin · No real payments are taken</span>
        </div>
      </div>
    </footer>
  );
}
