"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Check, FlaskConical, LoaderCircle, TrendingUp, Truck, Undo2, User, Users } from "lucide-react";
import type { ResearchCompetitor, ResearchReport, ResearchSuggestion, WebChange, WebDraftResponse } from "@/lib/contracts";
import { friendlyError } from "@/lib/friendly";
import { Card, hostOf, PASTELS, Pastel, Pill, Sources, T } from "./ui";

export function ReportView({ report, site }: { report: ResearchReport; site: string }) {
  return (
    <div className="flex flex-col gap-4">
      {report.competitors.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {report.competitors.map((c, i) => (
            <CompetitorCard key={`${c.url}-${i}`} c={c} i={i} />
          ))}
        </div>
      )}
      {report.competitors.length > 1 && <Comparison competitors={report.competitors} />}
      {report.trends.length > 0 && (
        <Card>
          <h2 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            <TrendingUp className="size-5" /> What the market is doing
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {report.trends.map((t, i) => (
              <li key={i} className="rounded-[22px] px-4 py-3 text-[14px] leading-snug" style={{ background: T.sand }}>
                {t.text}
                <Sources urls={t.sources} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      {report.suggestions.length > 0 && <Suggestions items={report.suggestions} site={site} demo={report.demo} />}
    </div>
  );
}

function CompetitorCard({ c, i }: { c: ResearchCompetitor; i: number }) {
  const [fill, shape] = PASTELS[i % PASTELS.length];
  return (
    <Pastel fill={fill} shape={shape}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[20px] font-semibold tracking-tight">{c.name}</h3>
          <a href={/^https?:/.test(c.url) ? c.url : undefined} target="_blank" rel="noopener noreferrer nofollow" className="font-mono text-[12px] text-black/60 hover:underline">
            {hostOf(c.url)}
          </a>
        </div>
        {c.priceRange && <span className="shrink-0 font-mono text-[18px] font-medium tabular-nums">{c.priceRange}</span>}
      </div>
      {c.positioning && <p className="mt-2 text-[14px] leading-snug text-black/75">{c.positioning}</p>}
      <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
        {c.shipping && (
          <span className="flex items-start gap-2">
            <Truck className="mt-0.5 size-4 shrink-0" /> {c.shipping}
          </span>
        )}
        {c.returns && (
          <span className="flex items-start gap-2">
            <Undo2 className="mt-0.5 size-4 shrink-0" /> {c.returns}
          </span>
        )}
        <span className="flex items-start gap-2">
          <Bot className="mt-0.5 size-4 shrink-0" />
          {c.agentReadiness.llmsTxt === true ? "Has llms.txt" : c.agentReadiness.llmsTxt === false ? "No llms.txt" : "llms.txt unknown"}
          {c.agentReadiness.notes.filter((n) => !/llms\.txt/i.test(n)).map((n) => ` · ${n}`)}
        </span>
      </div>
      {(c.strengths.length > 0 || c.weaknesses.length > 0) && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <div className="font-semibold">Strong at</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-black/75">
              {c.strengths.map((s) => (
                <li key={s}>+ {s}</li>
              ))}
              {!c.strengths.length && <li className="text-black/45">Nothing stood out</li>}
            </ul>
          </div>
          <div>
            <div className="font-semibold">Weak at</div>
            <ul className="mt-1 flex flex-col gap-0.5 text-black/75">
              {c.weaknesses.map((s) => (
                <li key={s}>− {s}</li>
              ))}
              {!c.weaknesses.length && <li className="text-black/45">Nothing found</li>}
            </ul>
          </div>
        </div>
      )}
      {c.tactics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.tactics.map((t) => (
            <span key={t} className="rounded-full bg-white/55 px-2.5 py-0.5 text-[12px]">
              {t}
            </span>
          ))}
        </div>
      )}
      <Sources urls={c.sources} />
    </Pastel>
  );
}

function Comparison({ competitors }: { competitors: ResearchCompetitor[] }) {
  const rows: [string, (c: ResearchCompetitor) => string][] = [
    ["Price", (c) => c.priceRange ?? "—"],
    ["Delivery", (c) => c.shipping ?? "—"],
    ["Returns", (c) => c.returns ?? "—"],
    ["llms.txt", (c) => (c.agentReadiness.llmsTxt === true ? "Yes" : c.agentReadiness.llmsTxt === false ? "No" : "?")],
    ["Tactics", (c) => (c.tactics.length ? c.tactics.slice(0, 3).join(", ") : "—")],
  ];
  return (
    <Card>
      <h2 className="text-[22px] font-semibold tracking-tight">Side by side</h2>
      <div className="mt-3 -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 w-24 py-2 pr-3 text-left font-medium text-black/50" style={{ background: T.surface }} />
              {competitors.map((c, i) => (
                <th key={i} className="py-2 pr-3 text-left font-semibold">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get]) => (
              <tr key={label}>
                <td className="sticky left-0 border-t py-2 pr-3 align-top font-medium text-black/55" style={{ background: T.surface, borderColor: T.hairline }}>
                  {label}
                </td>
                {competitors.map((c, i) => (
                  <td key={i} className={`border-t py-2 pr-3 align-top ${label === "Price" ? "font-mono tabular-nums" : ""}`} style={{ borderColor: T.hairline }}>
                    {get(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const AUDIENCE = { humans: { icon: User, label: "People" }, agents: { icon: Bot, label: "Agents" }, both: { icon: Users, label: "Everyone" } };

function Suggestions({ items, site, demo }: { items: ResearchSuggestion[]; site: string; demo: boolean }) {
  return (
    <section className="rounded-[26px] p-5 text-white" style={{ background: T.ink }}>
      <h2 className="text-[22px] font-semibold tracking-tight">What Darwin would test</h2>
      <p className="mt-1 text-[14px] text-white/60">One change each. Draft one and review it before it goes live.</p>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((s, i) => (
          <SuggestionRow key={i} n={i + 1} s={s} site={site} demo={demo} />
        ))}
      </ul>
    </section>
  );
}

/** A drafted page change in plain English (the CSS selector stays in the tooltip). */
function changeLabel(c: WebChange): string {
  const v = c.value ? `“${c.value.slice(0, 80)}”` : "";
  switch (c.action) {
    case "banner":
      return `Add a banner: ${v}`;
    case "text":
      return `Change the wording to ${v}`;
    case "badge":
      return `Add a badge: ${v}`;
    case "hide":
      return "Hide an element";
    case "style":
      return "Restyle an element";
  }
}

function SuggestionRow({ n, s, site, demo }: { n: number; s: ResearchSuggestion; site: string; demo: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [draft, setDraft] = useState<WebDraftResponse>();
  const [err, setErr] = useState<string>();
  const A = AUDIENCE[s.audience];

  const draftTest = async () => {
    setState("busy");
    setErr(undefined);
    try {
      const res = await fetch("/api/web/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site, prompt: s.testIdea }),
      });
      const j = (await res.json().catch(() => ({}))) as WebDraftResponse & { error?: string };
      if (!res.ok) throw Object.assign(new Error(j.error ?? ""), { status: res.status });
      setDraft(j);
      setState("done");
    } catch (e) {
      setErr(friendlyError(e, "Please try again."));
      setState("error");
    }
  };

  return (
    <li className="rounded-[22px] bg-white/[0.07] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-black" style={{ background: T.pink }}>
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">{s.title}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/75">
              <A.icon className="size-3" /> {A.label}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-white/65">{s.why}</p>
          <p className="mt-2 rounded-xl bg-white/[0.06] px-3 py-2 font-mono text-[12px] text-white/85">{s.testIdea}</p>
          <Sources urls={s.sources} dark />
        </div>
        <button
          onClick={draftTest}
          disabled={state === "busy"}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 text-[14px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          title={demo ? "Drafts a real test from this sample idea" : "Draft an A/B test for this idea (nothing goes live until you launch it)"}
        >
          {state === "busy" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : state === "done" ? <Check className="size-4" /> : <FlaskConical className="size-4" />}
          {state === "done" ? "Drafted" : "Draft A/B test"}
        </button>
      </div>
      {err && <p className="mt-3 text-[13px] text-[#F3B5D5]">Couldn&apos;t draft that test. {err}</p>}
      {draft && (
        <div className="mt-3 rounded-2xl p-3 text-[13px] text-black" style={{ background: T.surface }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{draft.rule.name}</span>
            <Pill tone={draft.source === "llm" ? "win" : "sand"}>{draft.source === "llm" ? "Drafted by Darwin AI" : "Drafted from Darwin's playbook"}</Pill>
          </div>
          {draft.rule.hypothesis && <p className="mt-1 text-black/70">{draft.rule.hypothesis}</p>}
          <ul className="mt-2 flex flex-col gap-1 text-[12px]">
            {draft.rule.changes.map((c, i) => (
              <li key={i} className="truncate" title={c.selector}>
                {changeLabel(c)}
              </li>
            ))}
          </ul>
          <Link href={`/console/personalize?site=${encodeURIComponent(site)}`} className="mt-2 inline-block font-medium underline">
            Review and launch it in Personalize
          </Link>
        </div>
      )}
    </li>
  );
}
