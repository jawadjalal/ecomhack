"use client";

/**
 * Checkout, shaped entirely by the PageSpec:
 *   checkout.steps          3 = Account → Delivery → Freight & payment, 2 = Details → Payment, 1 = one page
 *   checkout.guestCheckout  false = a full reseller account is required before anything else
 *   checkout.expressPay     Apple Pay / Google Pay / Pay by bank buttons that skip the forms
 *   cart.showShippingUpfront false = freight, customs and the small-order fee appear only at the payment step
 * No real payments: any card details are accepted and nothing is charged.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fees, gbp, priceLines } from "@/lib/commerce";
import { track, EVENTS } from "@/lib/track";
import { Totals } from "./order-summary";
import { useCart, useSpec } from "./providers";

type Section = "account" | "delivery" | "payment";

const PLAN: Record<1 | 2 | 3, { name: string; sections: Section[] }[]> = {
  3: [
    { name: "Account", sections: ["account"] },
    { name: "Delivery", sections: ["delivery"] },
    { name: "Freight & payment", sections: ["payment"] },
  ],
  2: [
    { name: "Your details", sections: ["account", "delivery"] },
    { name: "Payment", sections: ["payment"] },
  ],
  1: [{ name: "Checkout", sections: ["account", "delivery", "payment"] }],
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function CheckoutFlow() {
  const spec = useSpec();
  const cart = useCart();
  const router = useRouter();
  const lines = priceLines(cart.lines);
  const f = fees(lines, spec.cart.freeShippingThreshold);
  const plan = PLAN[spec.checkout.steps];
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const revealed = useRef(false);
  const done = useRef(false);
  const stepRef = useRef(0);
  stepRef.current = step;

  const current = plan[step];
  const last = step === plan.length - 1;
  const showFees = spec.cart.showShippingUpfront || current.sections.includes("payment");
  const shipping = f.total - f.subtotal;

  useEffect(() => {
    if (!cart.ready || started.current || !lines.length) return;
    started.current = true;
    track(EVENTS.checkoutStarted, {
      value: f.subtotal,
      items: cart.count,
      steps: spec.checkout.steps,
      guest_checkout: spec.checkout.guestCheckout,
      express_pay: spec.checkout.expressPay,
    });
  }, [cart.ready, cart.count, lines.length, f.subtotal, spec.checkout]);

  useEffect(() => {
    if (!started.current || revealed.current || !current.sections.includes("payment")) return;
    revealed.current = true;
    track(EVENTS.shippingRevealed, { shipping, stage: "checkout", step: step + 1, upfront: spec.cart.showShippingUpfront });
  }, [current.sections, shipping, step, spec.cart.showShippingUpfront]);

  // Leaving checkout without ordering is an abandon (Darwin reads what the shopper saw last).
  // The unmount report is deferred a tick so React's dev double-mount doesn't count as leaving.
  const pendingAbandon = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(pendingAbandon.current);
    const abandon = () => {
      if (!started.current || done.current) return;
      done.current = true;
      track(EVENTS.checkoutAbandoned, { step: stepRef.current + 1, steps: plan.length, shipping_seen: revealed.current });
      const d = window.darwin;
      if (d && !Array.isArray(d) && "flush" in d) (d as unknown as { flush: (b?: boolean) => void }).flush(true);
    };
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      pendingAbandon.current = window.setTimeout(abandon, 0);
    };
  }, [plan.length]);

  if (!cart.ready) return <div className="page" style={{ minHeight: "50vh" }} />;
  if (!lines.length) {
    return (
      <div className="page empty">
        <h1 className="page-title">Nothing to check out</h1>
        <Link href="/bundles" className="btn btn-ink">
          Browse bundles
        </Link>
      </div>
    );
  }

  const complete = (express: string | null) => {
    setBusy(true);
    if (!revealed.current) {
      revealed.current = true;
      track(EVENTS.shippingRevealed, { shipping, stage: express ? "express" : "checkout", step: step + 1, upfront: spec.cart.showShippingUpfront });
    }
    const orderId = `RK-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    done.current = true;
    track(EVENTS.orderCompleted, {
      order_id: orderId,
      revenue: f.total,
      subtotal: f.subtotal,
      shipping,
      items: cart.count,
      product_ids: lines.map((l) => l.bundle.id),
      express_pay: express ?? undefined,
      steps: plan.length,
    });
    try {
      sessionStorage.setItem(
        `rackd_order_${orderId}`,
        JSON.stringify({ orderId, lines: cart.lines, total: f.total, subtotal: f.subtotal, shipping, pieces: f.pieces, express }),
      );
    } catch {
      /* ignore */
    }
    cart.clear();
    router.push(`/order/${orderId}`);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    track(EVENTS.checkoutStepCompleted, { step: step + 1, step_name: current.name, steps: plan.length });
    if (last) complete(null);
    else {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Checkout</h1>
      <div className="cart-grid">
        <form className="form" onSubmit={submit} id="checkout-form" data-darwin="checkout-form" data-step={step + 1}>
          {plan.length > 1 && (
            <div className="stepper" aria-label="Checkout steps">
              {plan.map((p, i) => (
                <span key={p.name} style={{ display: "contents" }}>
                  {i > 0 && <i />}
                  <span className={i === step ? "on" : i < step ? "done" : ""}>
                    <b>{i < step ? "✓" : i + 1}</b>
                    {p.name}
                  </span>
                </span>
              ))}
            </div>
          )}

          {step === 0 && spec.checkout.expressPay && (
            <div className="express-pay" data-darwin="express-pay">
              <div className="express">
                <button type="button" className="pay-apple" disabled={busy} onClick={() => complete("apple_pay")}>
                   Pay
                </button>
                <button type="button" className="pay-google" disabled={busy} onClick={() => complete("google_pay")}>
                  G Pay
                </button>
                <button type="button" className="pay-bank" disabled={busy} onClick={() => complete("pay_by_bank")}>
                  Pay by bank
                </button>
              </div>
              <div className="divider" style={{ marginTop: 14 }}>
                or pay by card
              </div>
            </div>
          )}

          {current.sections.includes("account") &&
            (spec.checkout.guestCheckout ? (
              <section className="form" data-darwin="guest-checkout">
                <h2>Contact</h2>
                <Field label="Email" hint="For your order confirmation and tracking.">
                  <input type="email" name="email" required autoComplete="email" placeholder="you@example.com" />
                </Field>
                <label className="checkbox">
                  <input type="checkbox" name="create_account" /> Save my details for next time (optional)
                </label>
              </section>
            ) : (
              <section className="form" data-darwin="account-required">
                <h2>Create your reseller account</h2>
                <div className="notice notice-info">An account is required to order. Already have one? Log in from the top of the page.</div>
                <Field label="Business or shop name">
                  <input name="business" required autoComplete="organization" />
                </Field>
                <div className="row">
                  <Field label="Email">
                    <input type="email" name="email" required autoComplete="email" />
                  </Field>
                  <Field label="Phone">
                    <input type="tel" name="phone" required autoComplete="tel" />
                  </Field>
                </div>
                <div className="row">
                  <Field label="Password" hint="At least 8 characters, one number.">
                    <input type="password" name="password" required minLength={8} pattern=".*\d.*" autoComplete="new-password" />
                  </Field>
                  <Field label="Confirm password">
                    <input type="password" name="password2" required minLength={8} autoComplete="new-password" />
                  </Field>
                </div>
                <div className="row">
                  <Field label="VAT number" hint="Required for UK and EU business accounts.">
                    <input name="vat" required placeholder="GB123456789" />
                  </Field>
                  <Field label="Where do you sell?">
                    <select name="platform" required defaultValue="">
                      <option value="" disabled>
                        Choose one
                      </option>
                      <option>Depop</option>
                      <option>Vinted</option>
                      <option>eBay</option>
                      <option>Whatnot</option>
                      <option>My own shop</option>
                    </select>
                  </Field>
                </div>
                <label className="checkbox">
                  <input type="checkbox" required /> I agree to the reseller terms and trading conditions
                </label>
              </section>
            ))}

          {current.sections.includes("delivery") && (
            <section className="form">
              <h2>Delivery address</h2>
              <Field label="Full name">
                <input name="name" required autoComplete="name" />
              </Field>
              <Field label="Address">
                <input name="address1" required autoComplete="address-line1" />
              </Field>
              <div className="row">
                <Field label="Town or city">
                  <input name="city" required autoComplete="address-level2" />
                </Field>
                <Field label="Postcode">
                  <input name="postcode" required autoComplete="postal-code" />
                </Field>
              </div>
              <Field label="Country">
                <select name="country" defaultValue="GB" autoComplete="country">
                  <option value="GB">United Kingdom</option>
                  <option value="IE">Ireland</option>
                  <option value="FR">France</option>
                  <option value="DE">Germany</option>
                  <option value="NL">Netherlands</option>
                </select>
              </Field>
            </section>
          )}

          {current.sections.includes("payment") && (
            <section className="form">
              <h2>Freight &amp; payment</h2>
              {!spec.cart.showShippingUpfront && shipping > 0 && (
                <div className="notice notice-warn" data-darwin="fees-added">
                  Freight, customs handling{f.smallOrder ? " and a small order fee" : ""} have been added to your order: <strong>+{gbp(shipping, { decimals: true })}</strong>
                </div>
              )}
              <Field label="Card number" hint="Demo store: no payment is taken. Any number works.">
                <input name="card" required inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" />
              </Field>
              <div className="row">
                <Field label="Expiry">
                  <input name="exp" required autoComplete="cc-exp" placeholder="MM / YY" />
                </Field>
                <Field label="Security code">
                  <input name="cvc" required inputMode="numeric" autoComplete="cc-csc" placeholder="123" />
                </Field>
              </div>
            </section>
          )}

          <button type="submit" className="btn btn-accent btn-block" disabled={busy} id="checkout-continue" data-darwin="checkout-continue">
            {last ? `Place order · ${gbp(f.total, { decimals: true })}` : `Continue to ${plan[step + 1].name.toLowerCase()}`}
          </button>
          {step > 0 && (
            <button type="button" className="line-remove" onClick={() => setStep(step - 1)} style={{ alignSelf: "flex-start" }}>
              ← Back
            </button>
          )}
        </form>

        <aside className="summary" data-darwin="checkout-summary">
          <h2>Your order</h2>
          {lines.map(({ bundle, qty, total }) => (
            <div key={bundle.id} className="sum-row">
              <span>
                {qty} × {bundle.name}
              </span>
              <span>{gbp(total)}</span>
            </div>
          ))}
          <Totals f={f} showFees={showFees} threshold={spec.cart.freeShippingThreshold} highlight={!spec.cart.showShippingUpfront} />
        </aside>
      </div>
    </div>
  );
}
