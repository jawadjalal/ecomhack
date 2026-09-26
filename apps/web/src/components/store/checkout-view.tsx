"use client";

import { Check, ChevronDown, ChevronLeft, CreditCard, Loader2, Lock, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { id } from "@/lib/ids";
import { formatGBP } from "@/lib/money";
import { clearCart, saveOrder } from "@/lib/storefront/cart";
import { priceCart } from "@/lib/storefront/pricing";
import { sizeLabel } from "@/lib/storefront/products";
import { useDisplayLines } from "./cart-view";
import { StoreLink, useFlush, useStore, useStoreHref, useTrack } from "./store-provider";
import { ProductArt } from "./ui";

type Section = "contact" | "delivery" | "payment";

const STEP_LAYOUTS: Record<1 | 2 | 3, Section[][]> = {
  3: [["contact"], ["delivery"], ["payment"]],
  2: [["contact", "delivery"], ["payment"]],
  1: [["contact", "delivery", "payment"]],
};

const STEP_NAMES: Record<string, string> = {
  contact: "Contact",
  delivery: "Delivery",
  payment: "Payment",
  "contact+delivery": "Details",
  "contact+delivery+payment": "Checkout",
};

type Field =
  | "email"
  | "password"
  | "password2"
  | "firstName"
  | "lastName"
  | "address1"
  | "address2"
  | "city"
  | "postcode"
  | "cardNumber"
  | "cardExpiry"
  | "cardCvc"
  | "cardName";

type Form = Record<Field, string>;

const EMPTY_FORM: Form = {
  email: "",
  password: "",
  password2: "",
  firstName: "",
  lastName: "",
  address1: "",
  address2: "",
  city: "",
  postcode: "",
  cardNumber: "",
  cardExpiry: "",
  cardCvc: "",
  cardName: "",
};

const DEMO_FORM: Form = {
  email: "alex.runner@example.com",
  password: "tempo-run-2026",
  password2: "tempo-run-2026",
  firstName: "Alex",
  lastName: "Morgan",
  address1: "12 Canal Walk",
  address2: "Flat 3",
  city: "London",
  postcode: "N1 5SB",
  cardNumber: "4242 4242 4242 4242",
  cardExpiry: "12 / 29",
  cardCvc: "123",
  cardName: "Alex Morgan",
};

function validate(sections: Section[], f: Form, needsAccount: boolean): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (sections.includes("contact")) {
    if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = "Enter a valid email address";
    if (needsAccount) {
      if (f.password.length < 8) e.password = "Use at least 8 characters";
      if (f.password2 !== f.password) e.password2 = "Passwords don't match";
    }
  }
  if (sections.includes("delivery")) {
    if (!f.firstName.trim()) e.firstName = "Required";
    if (!f.lastName.trim()) e.lastName = "Required";
    if (!f.address1.trim()) e.address1 = "Enter your address";
    if (!f.city.trim()) e.city = "Required";
    if (!/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(f.postcode.trim())) e.postcode = "Enter a UK postcode";
  }
  if (sections.includes("payment")) {
    if (f.cardNumber.replace(/\D/g, "").length < 12) e.cardNumber = "Enter a card number (any demo number works)";
    if (!/^\d{2}\s*\/\s*\d{2}$/.test(f.cardExpiry.trim())) e.cardExpiry = "MM / YY";
    if (!/^\d{3,4}$/.test(f.cardCvc.trim())) e.cardCvc = "3 digits";
    if (!f.cardName.trim()) e.cardName = "Required";
  }
  return e;
}

export function CheckoutView({ deliveryDates }: { deliveryDates: Record<number, string> }) {
  const { spec, preview } = useStore();
  const { checkout, cart } = spec;
  const track = useTrack();
  const flush = useFlush();
  const href = useStoreHref();
  const router = useRouter();
  const { lines, hydrated, sample } = useDisplayLines();
  const totals = priceCart(lines, spec);
  const layout = STEP_LAYOUTS[checkout.steps];
  const needsAccount = !checkout.guestCheckout;

  const [stepIdx, setStepIdx] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [placing, setPlacing] = useState<null | "card" | "express">(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const isFinal = stepIdx === layout.length - 1;
  const shippingVisible = cart.showShippingUpfront || isFinal;
  const current = layout[stepIdx];
  const stepName = STEP_NAMES[current.join("+")];
  const maxDays = Math.max(1, ...totals.lines.map((l) => l.product.deliveryDays));
  const deliveryDate = deliveryDates[maxDays] ?? deliveryDates[2];

  // Live values for event handlers that outlive renders.
  const live = useRef({ done: false, abandoned: false, step: 1, stepName, value: 0, items: 0 });
  useEffect(() => {
    live.current.step = stepIdx + 1;
    live.current.stepName = stepName;
    live.current.value = totals.subtotal;
    live.current.items = totals.itemCount;
  });

  // checkout_started — once, when the cart is known.
  const started = useRef(false);
  useEffect(() => {
    if (!hydrated || started.current || totals.itemCount === 0) return;
    started.current = true;
    track("checkout_started", {
      value: totals.subtotal,
      item_count: totals.itemCount,
      steps: checkout.steps,
      guest_checkout: checkout.guestCheckout,
      express_pay: checkout.expressPay,
    });
  }, [hydrated, totals.itemCount, totals.subtotal, track, checkout]);

  // shipping_cost_revealed — the first time the shipping amount is on screen.
  const revealed = useRef(false);
  useEffect(() => {
    if (!hydrated || revealed.current || !shippingVisible || totals.itemCount === 0) return;
    revealed.current = true;
    track("shipping_cost_revealed", {
      shipping: totals.shipping,
      value: totals.subtotal,
      step: stepIdx + 1,
      upfront: cart.showShippingUpfront,
    });
  }, [hydrated, shippingVisible, totals.itemCount, totals.shipping, totals.subtotal, stepIdx, track, cart.showShippingUpfront]);

  // checkout_abandoned — leaving the checkout (tab close / navigation) without ordering.
  useEffect(() => {
    const abandon = () => {
      const s = live.current;
      if (s.done || s.abandoned || s.items === 0) return;
      s.abandoned = true;
      track("checkout_abandoned", { step: s.step, step_name: s.stepName, value: s.value, item_count: s.items });
      flush();
    };
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      // Client-side navigation away from the checkout (ignores StrictMode's dev remount).
      setTimeout(() => {
        if (!window.location.pathname.startsWith("/store/checkout")) abandon();
      }, 0);
    };
  }, [track, flush]);

  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const placeOrder = (express: boolean) => {
    const order = {
      id: id("ord"),
      createdAt: new Date().toISOString(),
      email: express ? form.email || "express@example.com" : form.email,
      firstName: form.firstName || "runner",
      lines: totals.lines.map(({ productId, color, size, quantity }) => ({ productId, color, size, quantity })),
      subtotal: totals.subtotal,
      shipping: totals.shipping,
      total: totals.total,
      deliveryDate,
      express,
    };
    live.current.done = true;
    saveOrder(order);
    clearCart();
    router.push(href(`/store/checkout/success?order=${order.id}`));
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(current, form, needsAccount);
    if (Object.keys(errs).length) {
      setErrors(errs);
      const first = Object.keys(errs)[0];
      document.getElementById(`co-${first}`)?.focus();
      return;
    }
    track("checkout_step_completed", { step: stepIdx + 1, step_name: stepName, steps_total: layout.length });
    if (!isFinal) {
      setStepIdx((i) => i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (preview) return; // previews never place orders
    setPlacing("card");
    setTimeout(() => placeOrder(false), 900);
  };

  const express = () => {
    if (preview) return;
    if (!shippingVisible && !revealed.current) {
      revealed.current = true;
      track("shipping_cost_revealed", { shipping: totals.shipping, value: totals.subtotal, step: 0, upfront: false, express: true });
    }
    track("checkout_step_completed", { step: 0, step_name: "express", steps_total: layout.length, express: true });
    setPlacing("express");
    setTimeout(() => placeOrder(true), 1100);
  };

  if (!hydrated) return <div className="min-h-[60vh]" aria-busy="true" />;

  if (totals.lines.length === 0) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <h1 className="pace-display text-4xl font-bold">Your bag is empty</h1>
        <p className="mt-3 text-(--muted)">Add something to your bag to check out.</p>
        <StoreLink href="/store#collection" className="pace-btn pace-btn-primary mt-8 min-h-[52px] px-8">
          Shop the collection
        </StoreLink>
      </div>
    );
  }

  const input = (k: Field, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, className = "") => (
    <div className={className}>
      <label htmlFor={`co-${k}`} className="mb-1.5 block text-[13px] font-medium">
        {label}
      </label>
      <input
        id={`co-${k}`}
        name={k}
        className="pace-input"
        value={form[k]}
        onChange={set(k)}
        aria-invalid={errors[k] ? true : undefined}
        aria-describedby={errors[k] ? `co-${k}-err` : undefined}
        {...props}
      />
      {errors[k] && (
        <p id={`co-${k}-err`} className="mt-1 text-xs font-medium text-[#b91c1c]">
          {errors[k]}
        </p>
      )}
    </div>
  );

  const payLabel = `Pay ${formatGBP(totals.total)}`;

  const summary = (
    <OrderSummary
      totals={totals}
      shippingVisible={shippingVisible}
      stepsLeft={layout.length - 1 - stepIdx}
      deliveryDate={deliveryDate}
    />
  );

  return (
    <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      {/* Mobile summary toggle */}
      <div className="border-b border-(--line) bg-(--surface) lg:hidden">
        <button
          type="button"
          onClick={() => setSummaryOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-4 text-sm sm:px-6"
          aria-expanded={summaryOpen}
        >
          <span className="flex items-center gap-1.5 font-medium">
            {summaryOpen ? "Hide" : "Show"} order summary <ChevronDown className={`size-4 transition ${summaryOpen ? "rotate-180" : ""}`} />
          </span>
          <span className="font-semibold">{formatGBP(shippingVisible ? totals.total : totals.subtotal)}</span>
        </button>
        {summaryOpen && <div className="px-4 pb-6 sm:px-6">{summary}</div>}
      </div>

      <div className="px-4 py-8 sm:px-6 lg:py-12 lg:pl-10 lg:pr-14 xl:pl-[max(2.5rem,calc((100vw-1200px)/2))]">
        <div className="mx-auto max-w-[560px] lg:mx-0 lg:ml-auto">
          {sample && (
            <p className="pace-card mb-6 bg-[#fef3c7] px-4 py-2.5 text-xs font-medium text-[#92400e]">Preview mode — sample basket, orders are disabled.</p>
          )}

          {checkout.expressPay && (
            <section className="mb-8" data-darwin="express-pay">
              <p className="text-center text-[13px] font-medium text-(--muted)">Express checkout</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={express}
                  disabled={placing !== null}
                  className="pace-btn min-h-12 bg-black text-white hover:bg-[#1f1f1f]"
                  data-darwin="express-pay-apple"
                  aria-label="Pay with Apple Pay (demo)"
                >
                  <span className="text-[16px] font-semibold tracking-tight">Apple Pay</span>
                </button>
                <button
                  type="button"
                  onClick={express}
                  disabled={placing !== null}
                  className="pace-btn min-h-12 border border-[#d6d3d1] bg-white text-[#1f1f1f] hover:border-black"
                  data-darwin="express-pay-google"
                  aria-label="Pay with Google Pay (demo)"
                >
                  <span className="text-[16px] font-semibold tracking-tight">
                    <span className="text-[#4285f4]">G</span>
                    <span className="text-[#ea4335]">o</span>
                    <span className="text-[#fbbc05]">o</span>
                    <span className="text-[#4285f4]">g</span>
                    <span className="text-[#34a853]">l</span>
                    <span className="text-[#ea4335]">e</span> Pay
                  </span>
                </button>
              </div>
              <div className="mt-6 flex items-center gap-3 text-xs text-(--muted)">
                <span className="h-px flex-1 bg-(--line)" />
                or pay with card
                <span className="h-px flex-1 bg-(--line)" />
              </div>
            </section>
          )}

          {layout.length > 1 && (
            <ol className="mb-8 flex items-center gap-2 text-[13px]" aria-label="Checkout steps">
              {layout.map((secs, i) => {
                const name = STEP_NAMES[secs.join("+")];
                const done = i < stepIdx;
                const on = i === stepIdx;
                return (
                  <li key={name} className="flex items-center gap-2">
                    {i > 0 && <span className="h-px w-5 bg-[#d6d3d1] sm:w-8" aria-hidden />}
                    <button
                      type="button"
                      disabled={!done}
                      onClick={() => setStepIdx(i)}
                      className={`flex items-center gap-1.5 ${on ? "font-semibold text-(--ink)" : done ? "text-(--ink) hover:underline" : "text-[#a8a29e]"}`}
                      aria-current={on ? "step" : undefined}
                    >
                      <span
                        className={`flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                          done ? "bg-(--ink) text-white" : on ? "bg-(--accent) text-(--accent-fg)" : "border border-[#d6d3d1]"
                        }`}
                      >
                        {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                      </span>
                      {name}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          <form onSubmit={next} noValidate className="space-y-10" data-darwin="checkout-form" data-step={stepIdx + 1}>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setForm(DEMO_FORM);
                  setErrors({});
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-(--muted) hover:text-(--ink)"
                data-darwin="checkout-autofill"
              >
                <Wand2 className="size-3.5" aria-hidden /> Autofill demo details
              </button>
            </div>

            {current.includes("contact") && (
              <FormSection
                title={needsAccount ? "Create an account to continue" : "Contact"}
                subtitle={
                  needsAccount
                    ? "You need a PACE account to place an order."
                    : "Checking out as a guest — no account needed."
                }
                dataDarwin={needsAccount ? "account-required" : "guest-checkout"}
              >
                {input("email", "Email", { type: "email", autoComplete: "email", placeholder: "you@example.com" })}
                {needsAccount && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {input("password", "Password", { type: "password", autoComplete: "new-password", placeholder: "8+ characters" })}
                    {input("password2", "Confirm password", { type: "password", autoComplete: "new-password" })}
                  </div>
                )}
                {needsAccount ? (
                  <p className="text-xs text-(--muted)">
                    Already have an account? <span className="pace-link cursor-pointer text-(--ink)">Sign in</span>
                  </p>
                ) : (
                  <label className="flex items-center gap-2 text-sm text-(--muted)">
                    <input type="checkbox" className="size-4 accent-(--accent)" defaultChecked /> Email me about new drops and races
                  </label>
                )}
              </FormSection>
            )}

            {current.includes("delivery") && (
              <FormSection title="Delivery address">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {input("firstName", "First name", { autoComplete: "given-name" })}
                  {input("lastName", "Last name", { autoComplete: "family-name" })}
                </div>
                {input("address1", "Address", { autoComplete: "address-line1", placeholder: "House number and street" })}
                {input("address2", "Apartment, suite, etc. (optional)", { autoComplete: "address-line2" })}
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {input("city", "City", { autoComplete: "address-level2" })}
                  {input("postcode", "Postcode", { autoComplete: "postal-code", placeholder: "N1 5SB" })}
                </div>
                <div className="pace-card flex items-center justify-between gap-4 border-2 border-(--ink) px-4 py-3.5 text-sm">
                  <span>
                    <span className="block font-semibold">Standard tracked delivery</span>
                    <span className="text-(--muted)">Arrives {deliveryDate}</span>
                  </span>
                  <span className="shrink-0 text-right font-semibold">
                    {shippingVisible ? (
                      totals.shipping === 0 ? (
                        <span className="text-emerald-700">Free</span>
                      ) : (
                        formatGBP(totals.shipping)
                      )
                    ) : (
                      <span className="font-normal text-(--muted)">Calculated at payment</span>
                    )}
                  </span>
                </div>
              </FormSection>
            )}

            {current.includes("payment") && (
              <FormSection
                title="Payment"
                subtitle="All transactions are secure and encrypted."
                badge={<span className="pace-chip bg-[#fef3c7] px-2 py-0.5 text-[11px] font-semibold text-[#92400e]">DEMO — no real payment</span>}
              >
                <div className="pace-card space-y-4 border border-(--line) bg-(--surface-2) p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <CreditCard className="size-4" aria-hidden /> Card
                  </p>
                  {input("cardNumber", "Card number", { inputMode: "numeric", autoComplete: "cc-number", placeholder: "4242 4242 4242 4242" })}
                  <div className="grid grid-cols-2 gap-4">
                    {input("cardExpiry", "Expiry", { autoComplete: "cc-exp", placeholder: "MM / YY" })}
                    {input("cardCvc", "Security code", { inputMode: "numeric", autoComplete: "cc-csc", placeholder: "123" })}
                  </div>
                  {input("cardName", "Name on card", { autoComplete: "cc-name" })}
                </div>
              </FormSection>
            )}

            {isFinal && (
              <div className="pace-card border border-(--line) p-4 text-sm" data-darwin="final-totals">
                <div className="flex justify-between">
                  <span className="text-(--muted)">Subtotal</span>
                  <span>{formatGBP(totals.subtotal)}</span>
                </div>
                <div className="mt-1.5 flex justify-between">
                  <span className="text-(--muted)">Delivery</span>
                  <span className="font-medium">{totals.shipping === 0 ? "Free" : formatGBP(totals.shipping)}</span>
                </div>
                <div className="mt-3 flex justify-between border-t border-(--line) pt-3 text-base font-semibold">
                  <span>Total</span>
                  <span>{formatGBP(totals.total)}</span>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
              {stepIdx > 0 ? (
                <button type="button" onClick={() => setStepIdx((i) => i - 1)} className="inline-flex items-center justify-center gap-1 text-sm font-medium text-(--muted) hover:text-(--ink)">
                  <ChevronLeft className="size-4" aria-hidden /> Back
                </button>
              ) : (
                <StoreLink href="/store/cart" className="inline-flex items-center justify-center gap-1 text-sm font-medium text-(--muted) hover:text-(--ink)">
                  <ChevronLeft className="size-4" aria-hidden /> Return to bag
                </StoreLink>
              )}
              <button
                type="submit"
                disabled={placing !== null}
                className="pace-btn pace-btn-primary min-h-14 px-10 text-base sm:min-w-[260px]"
                data-darwin={isFinal ? "checkout-pay" : "checkout-next"}
              >
                {placing === "card" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Processing…
                  </>
                ) : isFinal ? (
                  <>
                    <Lock className="size-4" aria-hidden /> {payLabel}
                  </>
                ) : (
                  `Continue to ${STEP_NAMES[layout[stepIdx + 1].join("+")].toLowerCase()}`
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <aside className="hidden border-l border-(--line) bg-(--surface) lg:block">
        <div className="sticky top-0 px-10 py-12 xl:pr-[max(2.5rem,calc((100vw-1200px)/2))]">
          <div className="max-w-[380px]">{summary}</div>
        </div>
      </aside>

      {placing === "express" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" role="alertdialog" aria-label="Processing payment">
          <div className="pace-rise pace-card w-[min(92vw,360px)] bg-white p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto size-8 animate-spin" aria-hidden />
            <p className="mt-4 font-semibold">Confirming with your wallet…</p>
            <p className="mt-1 text-sm text-(--muted)">
              {formatGBP(totals.total)} incl. {totals.shipping === 0 ? "free delivery" : `${formatGBP(totals.shipping)} delivery`} · demo
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function FormSection({
  title,
  subtitle,
  badge,
  children,
  dataDarwin,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  dataDarwin?: string;
}) {
  return (
    <section className="space-y-4" data-darwin={dataDarwin}>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-sm text-(--muted)">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function OrderSummary({
  totals,
  shippingVisible,
  stepsLeft,
  deliveryDate,
}: {
  totals: ReturnType<typeof priceCart>;
  shippingVisible: boolean;
  stepsLeft: number;
  deliveryDate: string;
}) {
  return (
    <div>
      <ul className="space-y-4">
        {totals.lines.map((l) => (
          <li key={l.key} className="flex items-center gap-4">
            <div className="relative shrink-0">
              <ProductArt product={l.product} color={l.color} className="size-16 border border-(--line) bg-white" />
              <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-[#57534e] text-[11px] font-semibold text-white">
                {l.quantity}
              </span>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{l.product.name}</p>
              <p className="text-(--muted)">
                {l.color} · {sizeLabel(l.size)}
              </p>
            </div>
            <p className="text-sm font-medium">{formatGBP(l.lineTotal)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex gap-2">
        <label htmlFor="co-discount" className="sr-only">
          Discount code
        </label>
        <input id="co-discount" className="pace-input min-h-11 bg-white text-sm" placeholder="Discount code" />
        <button type="button" className="pace-btn pace-btn-secondary min-h-11 px-5 text-sm">
          Apply
        </button>
      </div>
      <dl className="mt-6 space-y-2.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-(--muted)">Subtotal</dt>
          <dd>{formatGBP(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between" data-darwin="summary-shipping">
          <dt className="text-(--muted)">Delivery</dt>
          <dd>
            {shippingVisible ? (
              totals.shipping === 0 ? (
                <span className="font-medium text-emerald-700">Free</span>
              ) : (
                formatGBP(totals.shipping)
              )
            ) : (
              <span className="text-(--muted)">{stepsLeft > 1 ? "Calculated at payment" : "Calculated at next step"}</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between border-t border-[#d6d3d1] pt-4">
          <dt className="text-base font-semibold">Total</dt>
          <dd className="text-xl font-semibold">
            <span className="mr-1.5 text-xs font-normal text-(--muted)">GBP</span>
            {formatGBP(shippingVisible ? totals.total : totals.subtotal)}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-(--muted)">Arrives {deliveryDate} · Free 60-day returns</p>
    </div>
  );
}
