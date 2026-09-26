"use client";

import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { pct, signedPct } from "@/lib/console/format";
import { fmtImpact, plural, type FixRow, type IssueRow } from "./model";
import { issueRefs, liftText } from "./fix-parts";
import { Panel } from "./panel";

/** The loop ships a winner once P(B beats A) reaches this (optimizer default config). */
export const SHIP_AT = 0.975;

const EASE = [0.2, 0.8, 0.2, 1] as const;

function Big({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="num text-[30px] leading-none font-semibold tracking-[-0.02em]">{value}</span>
      <span className="text-[12px] tracking-[0.02em] uppercase" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

export function InTestCard({ fix, rows, hasDraft }: { fix?: FixRow; rows: IssueRow[]; hasDraft?: boolean }) {
  const testing = fix?.status === "test";
  const refs = fix ? issueRefs(fix, rows) : undefined;
  const p = fix?.probability;
  return (
    <Panel tone="pink" shape="experimenter" corner="tr" silhouette={240} href={testing ? "/console/experiments" : undefined} label={testing ? "In test now: see the test" : "In test now"}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[22px] leading-tight font-semibold tracking-[-0.02em]">
          In test now
          {testing && <ArrowUpRight className="size-4 opacity-0 transition-opacity group-hover:opacity-60 [.dw-card:hover_&]:opacity-60" aria-hidden />}
        </h2>
        {refs?.text && <span className="shrink-0 text-[14px] text-[#5A2744]">fixes {refs.text}</span>}
      </div>
      <p className="mt-2.5 max-w-[30rem] text-[20px] leading-[1.3] font-medium text-balance">
        {testing ? fix.title : hasDraft ? "Nothing yet. The fix Darwin just drafted goes into test B next." : "Nothing right now. Darwin starts a test as soon as it has a fix."}
      </p>
      {testing && (
        <div className="mt-5 flex items-end gap-7">
          <Big value={fix.lift !== undefined ? signedPct(fix.lift) : "–"} label={fix.lift !== undefined ? "so far" : "waiting for data"} color="#5A2744" />
          <div className="flex flex-1 flex-col gap-1.5 pb-1">
            <div className="flex justify-between gap-2 text-[12px] text-[#5A2744]">
              <span>
                <span className="num font-semibold text-dw-ink">{p !== undefined ? pct(p, 0) : "–"}</span> chance it wins
              </span>
              <span>ships at {pct(SHIP_AT)}</span>
            </div>
            <div className="relative h-2 rounded-full bg-dw-ink/12">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-dw-ink"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, (p ?? 0) * 100)}%` }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
              />
              <span className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-dw-ink/60" style={{ left: `${SHIP_AT * 100}%` }} aria-hidden />
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function UpNextCard({ drafted, next, testing }: { drafted?: FixRow; next?: IssueRow; testing: boolean }) {
  let body: { text: string; value?: string; label?: string };
  if (drafted) {
    body = { text: drafted.title, value: liftText(drafted), label: `expected${drafted.insightIds.length ? "" : " · creative bet"}` };
  } else if (next && testing) {
    body = { text: `Issue ${next.n}: ${next.insight.title}`, value: `−${fmtImpact(next.insight.impactScore)}`, label: "buyers lost / 1,000 · no fix yet" };
  } else if (next) {
    body = { text: `Darwin will draft a fix, most likely for issue ${next.n}: ${next.insight.title}` };
  } else {
    body = { text: "Darwin is looking for the next thing that stops shoppers buying." };
  }
  return (
    <Panel tone="yellow" shape="designer" corner="br" silhouette={210} label="Up next">
      <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Up next</h2>
      <p className="mt-2.5 line-clamp-3 text-[18px] leading-[1.35]">{body.text}</p>
      {body.value && (
        <div className="mt-4">
          <Big value={body.value} label={body.label ?? ""} color="#4F4417" />
        </div>
      )}
    </Panel>
  );
}

export function ThrownAwayCard({ thrown, shipped }: { thrown?: FixRow; shipped: number }) {
  return (
    <Panel tone="olive" shape="shipper" corner="br" silhouette={200} label="Thrown away">
      <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Thrown away</h2>
      <p className="mt-2.5 line-clamp-3 text-[18px] leading-[1.35]">{thrown ? thrown.title : "Nothing yet. Fixes that lose their test end up here."}</p>
      <div className="mt-4">
        {thrown ? (
          <Big value={liftText(thrown)} label={thrown.status === "rejected" ? "lost its test · never retried" : "no clear signal · shelved"} color="#2F3517" />
        ) : shipped > 0 ? (
          <Big value={String(shipped)} label={`${plural(shipped, "fix", "fixes").replace(/^\d+ /, "")} shipped, none lost`} color="#2F3517" />
        ) : null}
      </div>
    </Panel>
  );
}
