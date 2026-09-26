"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PageSpec } from "@/lib/page-spec";
import { getProduct } from "@/lib/catalog";
import { deliveryDate, deliveryFee, gbp } from "@/lib/format";
import { flush, track } from "@/lib/track";
import { lineTotal, useBag } from "./bag";

type Section = "account" | "delivery" | "payment";
const NAMES: Record<Section, string> = { account: "Orchard ID", delivery: "Delivery", payment: "Payment" };

/** checkout.steps groups the three sections into 3, 2 or 1 pages. */
function groupSteps(steps: 1 | 2 | 3): Section[][] {
  if (steps === 1) return [["account", "delivery", "payment"]];
  if (steps === 2) return [["account", "delivery"], ["payment"]];
  return [["account"], ["delivery"], ["payment"]];
}

type Fields = Record<string, string>;
const DEMO: Fields = {
  email: "sam.taylor@example.com",
  password: "Orchard2026!",
  confirm: "Orchard2026!",
  first: "Sam",
  last: "Taylor",
  dob: "1990-04-12",
  phone: "07700 900123",
  address: "12 Orchard Lane",
  city: "London",
  postcode: "N1 9GU",
  card: "4242 4242 4242 4242",
  expiry: "12/29",
  cvc: "123",
};

const REQUIRED: Record<Section, (guest: boolean, mode: "create" | "guest" | "signin") => string[]> = {
  account: (_g, mode) => (mode === "guest" ? ["email"] : mode === "signin" ? ["email", "password"] : ["email", "password", "confirm", "first", "last", "dob", "phone"]),
  delivery: () => ["first", "last", "address", "city", "postcode"],
  payment: () => ["card", "expiry", "cvc"],
};

export interface CompletedOrder {
  id: string;
  lines: { name: string; qty: number; total: number }[];
  subtotal: number;
  shipping: number;
  total: number;
  email: string;
  delivery: string;
  express: boolean;
}

/** Multi-step checkout. Knobs: checkout.steps / guestCheckout / expressPay, cart.showShippingUpfront / freeShippingThreshold. */
export function CheckoutFlow({ checkout, cart }: { checkout: PageSpec["checkout"]; cart: PageSpec["cart"] }) {
  const bag = useBag();
  const router = useRouter();
  const steps = useMemo(() => groupSteps(checkout.steps), [checkout.steps]);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"create" | "guest" | "signin">(checkout.guestCheckout ? "guest" : "create");
  const [f, setF] = useState<Fields>({});
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const done = useRef(false);
  const started = useRef(false);
  const revealed = useRef(false);
  const stepRef = useRef(0);
  stepRef.current = step;

  const subtotal = bag.subtotal;
  const shipping = deliveryFee(subtotal, cart.freeShippingThreshold);
  const sections = steps[step] ?? [];
  const last = step === steps.length - 1;
  const shippingVisible = cart.showShippingUpfront || sections.includes("payment");

  // checkout_started once the bag is known; checkout_abandoned if the shopper leaves before paying.
  useEffect(() => {
    if (!bag.ready || started.current || !bag.lines.length) return;
    started.current = true;
    track("checkout_started", { value: subtotal, items: bag.count, steps: checkout.steps, guest_checkout: checkout.guestCheckout, express_pay: checkout.expressPay });
  }, [bag.ready, bag.lines.length, bag.count, subtotal, checkout]);

  useEffect(() => {
    const abandon = (reason: string) => {
      if (done.current || !started.current) return;
      done.current = true;
      const s = stepRef.current;
      track("checkout_abandoned", { step: s + 1, step_name: steps[s]?.map((x) => NAMES[x]).join(" + "), steps: steps.length, reason });
      flush();
    };
    const onHide = () => abandon("left_site");
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      abandon("navigated_away");
    };
  }, [steps]);

  useEffect(() => {
    if (!started.current) return;
    track("checkout_step_viewed", { step: step + 1, step_name: sections.map((s) => NAMES[s]).join(" + "), steps: steps.length });
    if (!cart.showShippingUpfront && sections.includes("payment") && !revealed.current) {
      revealed.current = true;
      track("shipping_cost_revealed", { shipping, subtotal, where: `checkout-step-${step + 1}` });
    }
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bag.ready]);

  if (!bag.ready) return <div className="checkout" aria-busy="true" />;
  if (!bag.lines.length && !placing) {
    return (
      <div className="bag">
        <header className="bag-header" style={{ borderBottom: 0 }}>
          <h1>Your bag is empty.</h1>
          <Link href="/store" className="button button-elevated">
            Continue Shopping
          </Link>
        </header>
      </div>
    );
  }

  const set = (k: string) => (e: { target: { value: string } }) => setF((prev) => ({ ...prev, [k]: e.target.value }));

  const validate = (): string => {
    const need = sections.flatMap((s) => REQUIRED[s](checkout.guestCheckout, mode));
    const missing = [...new Set(need)].filter((k) => !f[k]?.trim());
    if (missing.length) return "Please fill in every required field.";
    if (sections.includes("account") && mode === "create") {
      if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(f.password ?? "")) return "Your password needs 8+ characters, a capital letter and a number.";
      if (f.password !== f.confirm) return "Passwords don't match.";
    }
    return "";
  };

  const place = (express: boolean, method?: string) => {
    if (placing) return;
    setPlacing(true);
    done.current = true;
    const id = `OR${Date.now().toString(36).toUpperCase().slice(-7)}`;
    const order: CompletedOrder = {
      id,
      lines: bag.lines.map((l) => {
        const p = getProduct(l.slug)!;
        return { name: `${p.name}${l.option ? ` ${l.option}` : ""} – ${l.colour}`, qty: l.qty, total: lineTotal(l) };
      }),
      subtotal,
      shipping,
      total: subtotal + shipping,
      email: f.email || DEMO.email,
      delivery: deliveryDate(),
      express,
    };
    if (express) {
      track("express_pay_clicked", { method, value: order.total });
      if (!revealed.current && !cart.showShippingUpfront) track("shipping_cost_revealed", { shipping, subtotal, where: "express-pay" });
    }
    track("order_completed", {
      order_id: id,
      revenue: order.total,
      shipping,
      items: bag.count,
      express,
      product_ids: bag.lines.map((l) => l.slug),
      guest: mode === "guest",
    });
    flush();
    try {
      sessionStorage.setItem(`orchard_order_${id}`, JSON.stringify(order));
    } catch {
      /* private mode */
    }
    bag.clear();
    router.push(`/order/${id}`);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      track("checkout_error", { step: step + 1, message: problem });
      return;
    }
    setError("");
    track("checkout_step_completed", { step: step + 1, step_name: sections.map((s) => NAMES[s]).join(" + "), steps: steps.length, account: sections.includes("account") ? mode : undefined });
    if (last) place(false);
    else setStep(step + 1);
  };

  const field = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <input value={f[k] ?? ""} onChange={set(k)} name={k} {...props} />
      <span>{label}</span>
    </label>
  );

  return (
    <>
    <div className="checkout-bar">
      <div className="checkout-bar-inner">
        <h1>Checkout</h1>
        <span className="checkout-bar-total">Order summary: {gbp(subtotal + (shippingVisible ? shipping : 0))}</span>
      </div>
    </div>
    <div className="checkout" data-darwin="checkout" data-steps={steps.length}>
      <div>
        <header>
          <p className="checkout-step" data-darwin="checkout-step">
            {steps.length > 1 ? `Step ${step + 1} of ${steps.length}` : "Checkout"} · {sections.map((s) => NAMES[s]).join(", ")}
          </p>
          {steps.length > 1 && (
            <ol className="stepper" aria-hidden="true">
              {steps.map((s, i) => (
                <li key={i} className={i < step ? "done" : i === step ? "on" : ""}>
                  {s.map((x) => NAMES[x]).join(" + ")}
                </li>
              ))}
            </ol>
          )}
          <h2 className="checkout-title">{sections.includes("account") ? (checkout.guestCheckout ? "Ready to check out?" : "Create your Orchard ID to check out.") : sections.includes("payment") ? "How do you want to pay?" : "Where should we send your order?"}</h2>
        </header>

        {checkout.expressPay && step === 0 && (
          <section className="express" data-darwin="express-pay">
            <p className="express-title">Express checkout</p>
            <div className="express-row">
              <button type="button" className="express-btn black" onClick={() => place(true, "orchard-pay")}>
                <strong>Orchard</strong>&nbsp;Pay
              </button>
              <button type="button" className="express-btn" onClick={() => place(true, "wallet-pay")}>
                Wallet&nbsp;<strong>Pay</strong>
              </button>
            </div>
            <p className="or-line">or check out below</p>
          </section>
        )}

        <form onSubmit={next} noValidate>
          {sections.includes("account") && (
            <fieldset className="panel" data-darwin="checkout-account">
              {checkout.guestCheckout ? (
                <>
                  <legend>Continue as a guest or sign in.</legend>
                  <div className="seg" role="tablist">
                    <button type="button" className={mode === "guest" ? "on" : ""} onClick={() => setMode("guest")} data-darwin="guest-checkout">
                      Guest checkout
                    </button>
                    <button type="button" className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")}>
                      Sign in
                    </button>
                  </div>
                  {field("email", "Email (for your receipt)", { type: "email", autoComplete: "email" })}
                  {mode === "signin" && field("password", "Password", { type: "password", autoComplete: "current-password" })}
                  {mode === "guest" && <p className="hint">No account needed. You can create an Orchard ID after you order.</p>}
                </>
              ) : (
                <>
                  <legend>Create your Orchard ID to continue.</legend>
                  <p className="required-note" data-darwin="account-required">
                    An Orchard ID is required to place an order.
                  </p>
                  <div className="seg" role="tablist">
                    <button type="button" className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>
                      Create Orchard ID
                    </button>
                    <button type="button" className={mode === "signin" ? "on" : ""} onClick={() => setMode("signin")}>
                      Sign in
                    </button>
                  </div>
                  {field("email", "Email", { type: "email", autoComplete: "email" })}
                  {field("password", mode === "create" ? "Create password" : "Password", { type: "password", autoComplete: mode === "create" ? "new-password" : "current-password" })}
                  {mode === "create" && (
                    <>
                      {field("confirm", "Confirm password", { type: "password", autoComplete: "new-password" })}
                      <div className="field-row">
                        {field("first", "First name", { autoComplete: "given-name" })}
                        {field("last", "Last name", { autoComplete: "family-name" })}
                      </div>
                      <div className="field-row">
                        {field("dob", "Date of birth", { type: "date" })}
                        {field("phone", "Phone number", { type: "tel", autoComplete: "tel" })}
                      </div>
                      <p className="hint">Password: 8+ characters with a capital letter and a number. We&apos;ll email you a code to verify your account later.</p>
                    </>
                  )}
                </>
              )}
            </fieldset>
          )}

          {sections.includes("delivery") && (
            <fieldset className="panel" data-darwin="checkout-delivery">
              <legend>Delivery address</legend>
              <div className="field-row">
                {field("first", "First name", { autoComplete: "given-name" })}
                {field("last", "Last name", { autoComplete: "family-name" })}
              </div>
              {field("address", "Street address", { autoComplete: "address-line1" })}
              <div className="field-row">
                {field("city", "Town/City", { autoComplete: "address-level2" })}
                {field("postcode", "Postcode", { autoComplete: "postal-code" })}
              </div>
            </fieldset>
          )}

          {sections.includes("payment") && (
            <fieldset className="panel" data-darwin="checkout-payment">
              <legend>Card details</legend>
              <p className="hint">Demo store: no card is charged and nothing is stored. Any numbers work.</p>
              {field("card", "Card number", { inputMode: "numeric", autoComplete: "off" })}
              <div className="field-row">
                {field("expiry", "Expiry (MM/YY)", { autoComplete: "off" })}
                {field("cvc", "Security code", { inputMode: "numeric", autoComplete: "off" })}
              </div>
              {!cart.showShippingUpfront && (
                <div className="shipping-reveal" data-darwin="shipping-reveal">
                  <span>Standard delivery</span>
                  <strong>{shipping === 0 ? "FREE" : gbp(shipping)}</strong>
                </div>
              )}
            </fieldset>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="checkout-actions">
            <button type="submit" className="button button-elevated" data-darwin="checkout-continue" disabled={placing}>
              {last ? `Place order · ${gbp(subtotal + (shippingVisible ? shipping : 0))}` : "Continue"}
            </button>
            <button type="button" className="link-button" onClick={() => setF((prev) => ({ ...DEMO, ...prev }))}>
              Fill in demo details
            </button>
          </div>
        </form>
      </div>

      <aside className="order-summary" data-darwin="order-summary">
        <h2>Order summary</h2>
        <ul>
          {bag.lines.map((l) => {
            const p = getProduct(l.slug)!;
            return (
              <li key={`${l.slug}-${l.colour}-${l.option}`}>
                <span>
                  {p.name}
                  {l.option ? ` ${l.option}` : ""} × {l.qty}
                </span>
                <span>{gbp(lineTotal(l))}</span>
              </li>
            );
          })}
        </ul>
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{gbp(subtotal)}</span>
        </div>
        <div className="summary-row">
          <span>Delivery</span>
          {shippingVisible ? <span>{shipping === 0 ? "FREE" : gbp(shipping)}</span> : <span className="grey">Calculated at final step</span>}
        </div>
        <div className="summary-row total">
          <span>Total</span>
          <span>{gbp(subtotal + (shippingVisible ? shipping : 0))}</span>
        </div>
      </aside>
    </div>
    </>
  );
}
