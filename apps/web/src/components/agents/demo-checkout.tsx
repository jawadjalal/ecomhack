"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Mascot } from "@/components/dw/mascot";
import { PillButton, Tag } from "@/components/dw/ui";

/** Cream "dw" checkout for the store agent's demo links. Paying records a labelled, simulated sale (unchanged API). */
export function DemoCheckout({ offer, refId, alreadyPaid = false }: { offer?: { id: string; title: string; description?: string; price: string }; refId: string; alreadyPaid?: boolean }) {
  const [state, setState] = useState<"idle" | "paying" | "paid" | "already" | "error">(alreadyPaid ? "already" : "idle");
  const pay = async () => {
    setState("paying");
    const res = await fetch("/api/store-agent/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer: offer?.id, ref: refId }) });
    const body = (await res.json().catch(() => ({}))) as { alreadyPaid?: boolean };
    setState(!res.ok ? "error" : body.alreadyPaid ? "already" : "paid");
  };
  const done = state === "paid" || state === "already";
  return (
    <main data-dw className="grid min-h-screen w-full place-items-center bg-dw-bg px-4 py-10 font-dw text-dw-ink">
      <div className="flex w-full max-w-[440px] flex-col gap-4">
        <Link href="/console/agents" className="flex items-center gap-2.5 self-start rounded-full text-[15px] font-semibold tracking-[-0.01em]">
          <Mascot kind="analyst" size={30} frame active={false} />
          darwin
        </Link>

        <section aria-label="Demo checkout" className="dw-card flex flex-col gap-5 rounded-[26px] border border-dw-hairline bg-dw-surface p-6 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tag tone="yellow">Demo checkout · no real payment</Tag>
            <span className="text-[12.5px] text-dw-ink/55">From Mika, your store agent</span>
          </div>

          {!offer ? (
            <p className="text-[15px] text-dw-ink/75">This checkout link isn&apos;t valid.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">{offer.title}</h1>
                {offer.description && <p className="text-[15px] leading-snug text-dw-ink/65">{offer.description}</p>}
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-dw-hairline pt-4">
                <span className="text-[14px] text-dw-ink/60">Total</span>
                <span className="num text-[30px] leading-none font-semibold tracking-[-0.02em]">{offer.price}</span>
              </div>

              {state === "paid" ? (
                <p className="flex items-center gap-2.5 rounded-2xl bg-dw-win-bg px-4 py-3 text-[14.5px] text-dw-win" role="status">
                  <Check className="size-4 shrink-0" aria-hidden />
                  Paid (demo). The store agent&apos;s dashboard now shows this sale.
                </p>
              ) : state === "already" ? (
                <>
                  <PillButton size="lg" disabled className="w-full">
                    Already paid
                  </PillButton>
                  <p className="-mt-2 text-[13.5px] text-dw-ink/60" role="status">
                    This checkout is already paid. Each checkout link can be paid once.
                  </p>
                </>
              ) : (
                <PillButton size="lg" onClick={pay} disabled={state === "paying"} className="w-full">
                  {state === "paying" ? "Paying…" : "Pay (demo)"}
                </PillButton>
              )}
              {state === "error" && <p className="text-[13.5px] text-dw-warn">That didn&apos;t work: the link may be invalid.</p>}

              {done && (
                <PillButton href="/console/agents" size="lg" className="w-full">
                  See it counted in Darwin
                  <ArrowRight aria-hidden />
                </PillButton>
              )}
              <p className="text-[12px] text-dw-ink/45">
                Simulated sale, labelled as such in Darwin. <span className="num">Ref {refId}</span>
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
