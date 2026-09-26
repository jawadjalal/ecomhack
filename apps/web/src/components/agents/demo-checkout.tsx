"use client";

import { useState } from "react";

export function DemoCheckout({ offer, refId }: { offer?: { id: string; title: string; description?: string; price: string }; refId: string }) {
  const [state, setState] = useState<"idle" | "paying" | "paid" | "error">("idle");
  const pay = async () => {
    setState("paying");
    const res = await fetch("/api/store-agent/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer: offer?.id, ref: refId }) });
    setState(res.ok ? "paid" : "error");
  };
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f5f2] p-6 text-[#15171a]">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <div className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-[0.8rem] text-amber-900">Demo checkout: no real payment. Paying here records a simulated sale for the agent that sent you.</div>
        {!offer ? (
          <p>This checkout link isn&apos;t valid.</p>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{offer.title}</h1>
            {offer.description && <p className="mt-1 text-[0.9rem] text-black/60">{offer.description}</p>}
            <div className="mt-4 text-2xl font-semibold">{offer.price}</div>
            {state === "paid" ? (
              <p className="mt-5 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800" role="status">
                Paid (demo). The store agent&apos;s dashboard now shows this sale.
              </p>
            ) : (
              <button onClick={pay} disabled={state === "paying"} className="mt-5 h-11 w-full rounded-xl bg-[#15171a] font-semibold text-white disabled:opacity-50">
                {state === "paying" ? "Paying…" : "Pay (demo)"}
              </button>
            )}
            {state === "error" && <p className="mt-3 text-[0.85rem] text-red-700">That didn&apos;t work: the link may be invalid.</p>}
            <p className="mt-4 text-[0.72rem] text-black/40">Ref {refId}</p>
          </>
        )}
      </div>
    </main>
  );
}
