"use client";

import { useEffect, useState } from "react";
import type { AutonomyLevel, AutonomyResponse, Policy } from "@/lib/contracts/watch";
import { cn } from "@/components/ui/cn";
import { Card, PillButton } from "../ui";

const LEVELS: { id: AutonomyLevel; label: string; blurb: string }[] = [
  { id: "off", label: "Off", blurb: "Watches and logs. Never messages, never acts." },
  { id: "suggest", label: "Suggest", blurb: "Messages you. Nothing runs until you tap." },
  { id: "auto-safe", label: "Auto-safe", blurb: "Does reversible things, then tells you." },
  { id: "autopilot", label: "Autopilot", blurb: "Runs the store. Drastic changes still need a tap or a policy." },
];

export function AutonomyCard({ className }: { className?: string }) {
  const [level, setLevel] = useState<AutonomyLevel>("suggest");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetch("/api/team/autonomy")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { settings?: { autonomy: AutonomyLevel }; policies?: Policy[] } | null) => {
        if (!body?.settings) return;
        setLevel(body.settings.autonomy);
        setPolicies(body.policies ?? []);
      })
      .catch(() => {});
  };
  useEffect(load, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/team/autonomy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as AutonomyResponse;
      if (data.settings) setLevel(data.settings.autonomy);
      if (data.policies) setPolicies(data.policies);
      setNote(data.text ?? "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="olive" shape="experimenter" corner="tr" className={cn("flex flex-col gap-4 p-6 sm:p-7", className)} aria-label="How much Darwin may do alone">
      <div>
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">How much Darwin may do alone</h2>
        <p className="mt-1 max-w-[40rem] text-[14px] leading-snug text-[#2C3318]">Suggest is the default. Even on autopilot, shipping, merging and publishing wait for your tap or a policy you wrote.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {LEVELS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={busy}
            onClick={() => void post({ level: item.id })}
            className={cn("rounded-2xl px-3 py-3 text-left ring-1 ring-transparent", level === item.id ? "bg-dw-ink text-white" : "bg-white/60 hover:bg-white")}
          >
            <span className="block text-[14px] font-semibold">{item.label}</span>
            <span className={cn("mt-1 block text-[12px] leading-snug", level === item.id ? "text-white/70" : "text-[#2C3318]")}>{item.blurb}</span>
          </button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length < 8) return;
          void post({ policy: draft.trim() }).then(() => setDraft(""));
        }}
      >
        <label className="text-[14px] font-semibold" htmlFor="policy">
          A standing policy, in your words
        </label>
        <textarea
          id="policy"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ship winners above 95% with at least 500 real visitors per arm. Never touch checkout on Fridays."
          className="min-h-[72px] rounded-2xl bg-white/70 px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-dw-ink"
        />
        <PillButton type="submit" size="sm" disabled={busy || draft.trim().length < 8} className="self-start">
          Compile it
        </PillButton>
      </form>
      {policies.length > 0 && (
        <ul className="flex flex-col gap-2">
          {policies.map((policy) => (
            <li key={policy.id} className="rounded-2xl bg-white/55 px-3 py-2.5 text-[13.5px] leading-snug">
              <p>{policy.compiled}</p>
              <p className="mt-1 text-[12px] text-[#2C3318]">You wrote: “{policy.text}”</p>
              <div className="mt-2 flex gap-2">
                {!policy.confirmedAt && (
                  <PillButton size="sm" disabled={busy} onClick={() => void post({ confirmPolicy: policy.id })}>
                    Confirm
                  </PillButton>
                )}
                {policy.confirmedAt && <span className="text-[12px] text-dw-ink/60">On · used {policy.uses} time{policy.uses === 1 ? "" : "s"}</span>}
                <PillButton size="sm" tone="white" disabled={busy} onClick={() => void post({ removePolicy: policy.id })}>
                  Remove
                </PillButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-[13.5px] leading-snug">{note}</p>}
    </Card>
  );
}
