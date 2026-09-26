"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PageSpec } from "@/lib/page-spec";
import { getProduct, RETURNS_DAYS, unitPrice } from "@/lib/catalog";
import { deliveryDate, gbp, monthly } from "@/lib/format";
import { useBag } from "./bag";
import { DeviceArt } from "./device-art";
import { Stars } from "./stars";

interface Props {
  slug: string;
  pp: PageSpec["productPage"];
  freeShippingThreshold: number | null;
  /** Product information rendered on the server (What's in the box, compare, reviews). */
  children: ReactNode;
}

/**
 * The buy page. Knobs: productPage.ctaPosition (where Add to Bag lives), ctaText, showReviews (rating in
 * the header), showSizeGuide, showDeliveryEstimate, showReturnsPolicy, urgency, trustBadges.
 */
export function BuyFlow({ slug, pp, freeShippingThreshold, children }: Props) {
  const p = getProduct(slug)!;
  const bag = useBag();
  const [colour, setColour] = useState(p.colours[0].name);
  const [option, setOption] = useState(p.option?.choices[0].name);
  const [added, setAdded] = useState(false);
  const [guide, setGuide] = useState(false);
  const [bar, setBar] = useState(false);
  const headerCta = useRef<HTMLDivElement>(null);

  const hex = p.colours.find((c) => c.name === colour)?.hex ?? p.colours[0].hex;
  const price = unitPrice(p, option);
  const left = p.stock[colour] ?? 0;
  const pro = slug.endsWith("-pro");
  const sticky = pp.ctaPosition === "sticky";
  const top = pp.ctaPosition !== "below-description";

  useEffect(() => {
    if (!sticky || !headerCta.current) return;
    const io = new IntersectionObserver(([e]) => setBar(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(headerCta.current);
    return () => io.disconnect();
  }, [sticky]);

  const add = (source: string) => {
    bag.add({ slug, colour, option }, source);
    setAdded(true);
  };

  const cta = (source: string, extra = "") => (
    <button type="button" className={`button button-block button-rect ${extra}`} data-darwin="add-to-bag" onClick={() => add(source)}>
      {pp.ctaText}
    </button>
  );
  const addedNote = added && (
    <p className="added-note" role="status" data-darwin="added-to-bag">
      Added to your bag. <Link href="/bag">Review bag ›</Link>
    </p>
  );

  const summary = (
    <section className="summary" id="buy-summary" data-darwin="buy-summary">
      <div className="summary-grid">
        <h2 className="summary-headline">
          Your new {p.short}.<br />
          Ready when you are.
        </h2>
        <div>
          <p className="summary-price">
            {gbp(price)} or {monthly(price)}
          </p>
          <p className="summary-choice">
            {p.name}
            {option ? `, ${option}` : ""}, {colour}
          </p>
          <div className="summary-moment">
            <strong>Need a moment?</strong>
            Keep all your selections by saving this device, then come back any time.
          </div>
          {!pp.showDeliveryEstimate && <p className="summary-note">Delivery details for your area will be shown in Checkout.</p>}
        </div>
        <div>
          <div className="summary-facts">
            {pp.urgency === "low-stock" && left > 0 && left <= 5 && (
              <p className="urgency" data-darwin="urgency">
                Only {left} left in {colour}.
              </p>
            )}
            {pp.showDeliveryEstimate && (
              <div className="fact" data-darwin="delivery-estimate">
                <TruckIcon />
                <span>
                  <strong>Delivery:</strong> order by 3pm, delivers {deliveryDate()}
                  {freeShippingThreshold !== null && price >= freeShippingThreshold ? " – Free" : ""}
                </span>
              </div>
            )}
            {pp.showReturnsPolicy && (
              <div className="fact" data-darwin="returns-policy">
                <ReturnIcon />
                <span>
                  <strong>Free returns</strong> within {RETURNS_DAYS} days.
                </span>
              </div>
            )}
            <div className="fact">
              <StoreIcon />
              <span>Pick up from an Orchard Store</span>
            </div>
          </div>
          {cta("buy-summary")}
          {addedNote}
          {pp.trustBadges && (
            <ul className="badges" data-darwin="trust-badges">
              <li>
                <LockIcon /> Secure checkout
              </li>
              <li>
                <ShieldIcon /> 1-year warranty
              </li>
              <li>
                <ReturnIcon /> {RETURNS_DAYS}-day free returns
              </li>
              <li>
                <CardIcon /> 0% finance available
              </li>
            </ul>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <>
      <header className="buy-header" id="buy">
        <div>
          {p.isNew && <p className="buy-eyebrow">New</p>}
          <h1 className="buy-title">Buy {p.name}</h1>
          <p className="buy-price">
            From {gbp(p.price, { whole: true })} or {monthly(p.price)}
          </p>
          {pp.showReviews && (
            <a href="#reviews" className="buy-rating">
              <Stars rating={p.rating} count={p.reviews} />
            </a>
          )}
        </div>
        {top ? (
          <div className="buy-quick" ref={headerCta} data-darwin="add-to-bag-top">
            {cta("buy-header")}
            {addedNote}
            <span className="buy-quick-note">
              {p.name}
              {option ? `, ${option}` : ""}, {colour} · {gbp(price)}
            </span>
          </div>
        ) : (
          <div className="buy-pills">
            <span className="pill plus-circle">Trade in and save</span>
            <span className="pill plus-circle">Monthly payments available</span>
          </div>
        )}
      </header>

      <div className="configurator">
        <div className="gallery-pane">
          <div className="gallery-stage">
            <DeviceArt kind={p.kind} colour={hex} pro={pro} label={`${p.name} in ${colour}`} />
            <span className="paddle" aria-hidden="true">
              ›
            </span>
          </div>
          <div className="gallery-dotnav" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="options">
          {p.colours.length > 1 && (
            <section className="option-section">
              <h2 className="option-header">
                Finish. <span>Pick your favourite.</span>
              </h2>
              <p className="option-label">Colour – {colour}</p>
              <div className="colornav">
                {p.colours.map((c) => (
                  <button key={c.name} type="button" className={c.name === colour ? "on" : ""} aria-label={c.name} aria-pressed={c.name === colour} onClick={() => setColour(c.name)}>
                    <span style={{ background: c.hex }} />
                  </button>
                ))}
              </div>
            </section>
          )}
          {p.option && (
            <section className="option-section">
              <h2 className="option-header">
                {p.option.label}. <span>{p.option.label === "Storage" ? "How much space do you need?" : "Which is best for you?"}</span>
              </h2>
              <div className="choices">
                {p.option.choices.map((c) => (
                  <button key={c.name} type="button" className={`choice ${c.name === option ? "on" : ""}`} aria-pressed={c.name === option} onClick={() => setOption(c.name)}>
                    <span className="choice-name">
                      {c.name}
                      {c.note && <small>{c.note}</small>}
                    </span>
                    <span className="choice-price">
                      From {gbp(p.price + c.delta, { whole: true })} or {gbp(Math.ceil((p.price + c.delta) / 30))}/mo.
                    </span>
                  </button>
                ))}
              </div>
              {pp.showSizeGuide && p.sizeGuide && (
                <div className="help-box" data-darwin="size-guide">
                  <button type="button" aria-expanded={guide} onClick={() => setGuide((v) => !v)}>
                    <span>
                      <strong>Need help choosing a size?</strong>
                      Compare sizes and weights side by side.
                    </span>
                    <span aria-hidden="true">{guide ? "−" : "+"}</span>
                  </button>
                  {guide && (
                    <dl>
                      {p.sizeGuide.map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {!p.accessory && (
        <>
          <section className="addon-section">
            <h2>
              Orchard Trade In. <span>Get credit towards your new {p.short}.</span>
            </h2>
            <div className="addon-row">
              <div className="addon-box plain">Add a trade-in</div>
              <div className="addon-box plain">No trade-in</div>
            </div>
          </section>
          <section className="addon-section">
            <h2>
              OrchardCare coverage. <span>Peace of mind in every plan.</span>
            </h2>
            <div className="addon-row">
              <div className="addon-box">
                <h3>OrchardCare+</h3>
                Cover this product only
                <ul>
                  <li>Unlimited repairs for accidental damage</li>
                  <li>Priority support from Orchard experts</li>
                </ul>
              </div>
              <div className="addon-box">
                <h3>OrchardCare One</h3>
                Cover up to three products
                <ul>
                  <li>Everything in OrchardCare+</li>
                  <li>Add more products at any time</li>
                </ul>
              </div>
              <div className="addon-box plain">No OrchardCare coverage</div>
            </div>
          </section>
        </>
      )}

      {top && summary}
      {children}
      {!top && summary}

      {sticky && (
        <div className={`sticky-bar ${bar ? "show" : ""}`} data-darwin="sticky-add-to-bag" aria-hidden={!bar}>
          <div className="sticky-bar-inner">
            <span className="sticky-bar-name">
              <strong>{p.name}</strong>
              {option ? `${option}, ` : ""}
              {colour} · {gbp(price)}
            </span>
            <button type="button" className="button button-reduced" tabIndex={bar ? 0 : -1} onClick={() => add("sticky-bar")}>
              {pp.ctaText}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function TruckIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
      <path d="M1 3h12v9H1zM13 6h4l3 3v3h-7z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="5" cy="14" r="1.8" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="16" cy="14" r="1.8" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function StoreIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
      <path d="M4 6h14l-1 10H5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 6V4.5a3 3 0 0 1 6 0V6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function ReturnIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
      <path d="M6 7h8a4 4 0 0 1 0 8h-4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9 4 6 7l3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
      <rect x="1.5" y="7" width="11" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true">
      <path d="M7 1 1.5 3v4.5C1.5 11 4 13.5 7 15c3-1.5 5.5-4 5.5-7.5V3z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      <rect x="1" y="2" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1 5.5h14" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
