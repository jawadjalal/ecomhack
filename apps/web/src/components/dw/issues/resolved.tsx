"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { liftText } from "../overview/model";
import type { ResolvedIssue } from "./model";

const SHOW = 4;

/**
 * Issues Darwin already fixed, greyed under the open ones: one row per shipped generation, from the real
 * loop history. Keeps both sides of the story (people and AI agents) visible at later generations.
 */
export function ResolvedIssues({ items }: { items: ResolvedIssue[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const visible = all ? items : items.slice(0, SHOW);
  const agents = items.filter((r) => r.who === "Agents").length;
  const people = items.filter((r) => r.who === "People").length;
  const split = [agents ? `${agents} for AI agents` : "", people ? `${people} for people` : ""].filter(Boolean).join(", ");
  return (
    <div id="dw-resolved" className="mt-1 flex flex-col gap-1 border-t border-dw-hairline px-1 pt-3">
      <div className="flex items-baseline justify-between gap-3 pb-1">
        <h3 className="text-[15px] font-semibold text-dw-ink/70">Already fixed</h3>
        <span className="text-[12.5px] text-[#8A8478]">{split || `${items.length} shipped`}</span>
      </div>
      <ul className="flex flex-col">
        {visible.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-dw-ink/55">
            <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-dw-ink/[0.06]" aria-hidden>
              <Check className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 text-[13.5px] leading-snug">
              <span className="line-clamp-2 [overflow-wrap:anywhere]" title={`Fix: ${r.fix}`}>
                <span className="font-medium text-dw-ink/65">Fixed · </span>
                {r.problem}
              </span>
              <span className="text-[12px] text-[#8A8478]">{r.who}</span>
            </span>
            <Link
              href={`/console/changes#gen-${r.generation}`}
              className="num shrink-0 text-right text-[13px] font-semibold text-dw-ink/65 underline decoration-dw-ink/20 underline-offset-4 hover:text-dw-ink hover:decoration-dw-ink"
              title={r.audience === "agent" ? "Lift measured on AI shoppers" : r.audience === "human" ? "Lift measured on people" : "Lift measured on everyone"}
            >
              Gen {r.generation}
              {r.lift !== undefined && Number.isFinite(r.lift) ? `, ${liftText(r.lift)}` : ""}
            </Link>
          </li>
        ))}
      </ul>
      {items.length > SHOW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="self-start rounded-full px-2 py-1 text-[13px] font-medium text-dw-ink/65 underline decoration-dw-ink/20 underline-offset-4 hover:text-dw-ink"
        >
          {all ? "Show fewer" : `Show ${items.length - SHOW} more fixed`}
        </button>
      )}
    </div>
  );
}
