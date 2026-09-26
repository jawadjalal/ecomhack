"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Copy, ExternalLink, Eye, FlaskConical, Link2, LoaderCircle, Mail, Megaphone, MousePointerClick, Pause, Play, RefreshCw, Rocket, Search, Send, Sparkles, Trash, Users, X } from "lucide-react";
import type {
  HeatmapElement,
  TrafficSource,
  WebHeatmap,
  WebAutopilotEntry,
  WebAutopilotState,
  WebChange,
  WebDraftResponse,
  WebRule,
  WebRuleDraft,
  WebRuleResult,
  WebRulesResponse,
  WebSimulateResponse,
} from "@/lib/contracts";
import { TRAFFIC_SOURCES, TRAFFIC_SOURCE_LABEL } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { Card, Empty, LegendKey, PageHead, PillBar, PillButton, Segmented, Tag } from "@/components/dw/ui";
import { Overflow } from "@/components/dw/overflow";
import { BrowserFrame, CardHead, DwSwitch, DwToast, FieldLabel, IconBtn, SiteSelect } from "@/components/dw/personalize/kit";

/* ------------------------------------------------------------------ helpers */

const SHORT: Record<TrafficSource, string> = {
  ai: "AI assistants",
  search: "Search",
  social: "Social",
  paid: "Paid ads",
  email: "Email",
  referral: "Referral",
  direct: "Direct",
};

/** Example prompts. No made-up facts: Darwin fills copy from the page's own words, or asks the merchant (lib/web/claims.ts). */
const EXAMPLES = [
  "Visitors from ChatGPT: a banner with our delivery and returns terms",
  "Google searchers: put their search in the headline",
  'Instagram and TikTok: add a badge "Free 60-day returns" next to Add to cart',
  "Direct visitors: hide the newsletter popup",
];

const pct = (x: number | undefined, digits = 1) => (x === undefined ? "–" : `${(x * 100).toFixed(digits)}%`);

async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

interface View {
  source: TrafficSource | "original";
  query: string;
  previewRuleId?: string;
}

function previewSrc(base: string, v: View, version = ""): string {
  const u = new URL(base, window.location.origin);
  if (version) u.searchParams.set("darwin_v", version);
  if (v.source === "original") u.searchParams.set("darwin_variant", "control");
  else {
    u.searchParams.set("darwin_source", v.source);
    if (v.query && (v.source === "search" || v.source === "paid")) u.searchParams.set("darwin_q", v.query);
    u.searchParams.set("darwin_variant", "treatment");
  }
  if (v.previewRuleId) u.searchParams.set("darwin_preview", v.previewRuleId);
  return u.toString();
}

function describeChange(c: WebChange): string {
  switch (c.action) {
    case "banner":
      return `Banner: “${c.value}”`;
    case "text":
      return `Text of ${c.selector}: “${c.value}”`;
    case "badge":
      return `Badge after ${c.selector}: “${c.value}”`;
    case "hide":
      return `Hide ${c.selector}`;
    case "style":
      return `Style ${c.selector}: ${c.value}`;
  }
}

function audienceLabel(r: Pick<WebRule, "audience">): string {
  const who = r.audience.sources?.length ? r.audience.sources.map((s) => SHORT[s]).join(", ") : "Everyone";
  return r.audience.queryIncludes?.length ? `${who} · searching “${r.audience.queryIncludes.join("”, “")}”` : who;
}

const SOURCE_ICON: Record<Exclude<TrafficSource, "ai">, React.ReactNode> = {
  search: <Search aria-hidden />,
  social: <Users aria-hidden />,
  paid: <Megaphone aria-hidden />,
  email: <Mail aria-hidden />,
  referral: <Link2 aria-hidden />,
  direct: <MousePointerClick aria-hidden />,
};

/** The AI assistants behind the "AI assistants" source, shown with their official marks. */
const AI_BRANDS = ["ChatGPT", "Perplexity", "Claude", "Gemini"].map((n) => agentBrand(n));

function AiStack({ size = 18 }: { size?: number }) {
  return (
    <span className="flex shrink-0 -space-x-1">
      {AI_BRANDS.map((b) => (
        <AgentTile key={b.key} brand={b} size={size} className="ring-2 ring-white/80" />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ app */

export function PersonalizeApp({ initialSite, origin }: { initialSite: string; origin: string }) {
  const [site, setSite] = useState(initialSite);
  const [data, setData] = useState<WebRulesResponse>();
  const [loadError, setLoadError] = useState<string>();
  const [view, setView] = useState<View>({ source: "ai", query: "waterproof trail shoes" });
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<{ rule: WebRuleDraft; source: WebDraftResponse["source"]; savedId?: string }>();
  const [suggestions, setSuggestions] = useState<WebRuleDraft[]>();
  const [busy, setBusy] = useState<string>();
  const [toast, setToast] = useState<{ text: string; tone: "good" | "bad" }>();
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api<WebRulesResponse>(`/api/web/rules?site=${encodeURIComponent(site)}`));
      setLoadError(undefined);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [site]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const pageUrl = data?.overview.url ?? (site === "north-trail" ? `${origin}/demo/north-trail` : undefined);
  // Reload the preview whenever a rule changes (someone launched, shipped or stopped something).
  const rulesVersion = data?.rules.reduce((v, r) => (r.updatedAt > v ? r.updatedAt : v), "") ?? "";
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    const t = setTimeout(() => setSrc(pageUrl ? previewSrc(pageUrl, view, rulesVersion) : undefined), 0);
    return () => clearTimeout(t);
  }, [pageUrl, view, reload, rulesVersion]);

  /* ---------------- click heatmap over the preview */

  const [heatOn, setHeatOn] = useState(false);
  const [heat, setHeat] = useState<WebHeatmap>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [painted, setPainted] = useState<boolean>();
  const heatSource = view.source === "original" ? undefined : view.source;
  const pagePath = useMemo(() => {
    try {
      return pageUrl ? new URL(pageUrl, origin).pathname : undefined;
    } catch {
      return undefined;
    }
  }, [pageUrl, origin]);

  useEffect(() => {
    if (!heatOn) return;
    const q = new URLSearchParams({ site, ...(pagePath ? { path: pagePath } : {}), ...(heatSource ? { source: heatSource } : {}) });
    const get = () => api<WebHeatmap>(`/api/web/heatmap?${q}`).then(setHeat, () => {});
    const first = setTimeout(get, 0);
    const t = setInterval(get, 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [heatOn, site, pagePath, heatSource]);

  const paint = useCallback(() => {
    const ok = paintHeatmap(frame.current, heatOn ? (heat?.elements ?? []) : []);
    setPainted(ok);
  }, [heat, heatOn]);
  useEffect(() => {
    const t = setTimeout(paint, 0);
    return () => clearTimeout(t);
  }, [paint]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setToast({ text: (e as Error).message, tone: "bad" });
    } finally {
      setBusy(undefined);
    }
  };

  const switchSite = (next: string) => {
    setSite(next);
    setData(undefined);
    setDraft(undefined);
    setSuggestions(undefined);
    window.history.replaceState(null, "", `?site=${encodeURIComponent(next)}`);
  };

  /* ---------------- drafting */

  const draftFromPrompt = (text = prompt) =>
    run("draft", async () => {
      if (text.trim().length < 3) throw new Error("Tell Darwin what to change first.");
      const res = await api<WebDraftResponse>("/api/web/draft", { body: { site, prompt: text } });
      setDraft({ rule: res.rule, source: res.source });
      setSuggestions(undefined);
    });

  const suggest = () =>
    run("suggest", async () => {
      const res = await api<{ rules: WebRuleDraft[] }>("/api/web/suggest", { body: { site } });
      setSuggestions(res.rules);
    });

  const editDraft = (fn: (r: WebRuleDraft) => WebRuleDraft) => setDraft((d) => d && { ...d, rule: fn(d.rule) });

  /** Save (or update) the draft without launching it. Returns its id. */
  const saveDraft = async (extra: Partial<WebRuleDraft> = {}, status: "draft" | "running" = "draft"): Promise<WebRule> => {
    if (!draft) throw new Error("Nothing to save");
    const rule = { ...draft.rule, ...extra };
    if (draft.savedId) {
      const { name, hypothesis, audience, changes, mode } = rule;
      const res = await api<{ rule: WebRule }>(`/api/web/rules/${draft.savedId}`, { method: "PATCH", body: { name, hypothesis, audience, changes, mode, status } });
      return res.rule;
    }
    const res = await api<{ rule: WebRule }>("/api/web/rules", { body: { rule, status } });
    setDraft((d) => d && { ...d, savedId: res.rule.id });
    return res.rule;
  };

  const previewDraft = () =>
    run("preview", async () => {
      const saved = await saveDraft();
      setView((v) => ({ ...v, source: saved.audience.sources?.[0] ?? (v.source === "original" ? "direct" : v.source), previewRuleId: saved.id }));
      setReload((n) => n + 1);
    });

  const launch = (mode: "test" | "always") =>
    run(mode, async () => {
      const saved = await saveDraft({ mode }, "running");
      setDraft(undefined);
      setPrompt("");
      setView((v) => ({ ...v, source: saved.audience.sources?.[0] ?? (v.source === "original" ? "direct" : v.source), previewRuleId: undefined }));
      setToast({
        tone: "good",
        text:
          mode === "test"
            ? `A/B test live: ${audienceLabel(saved)} split ${Math.round(saved.allocation * 100)}/${100 - Math.round(saved.allocation * 100)}.`
            : `Live for ${audienceLabel(saved)}.`,
      });
      await load();
    });

  const discard = () =>
    run("discard", async () => {
      if (draft?.savedId) await api(`/api/web/rules/${draft.savedId}`, { method: "DELETE" });
      setDraft(undefined);
      setView((v) => ({ ...v, previewRuleId: undefined }));
      await load();
    });

  /* ---------------- rules */

  const patch = (rule: WebRule, body: Record<string, unknown>, done: string) =>
    run(`${rule.id}:${String(body.status)}`, async () => {
      await api(`/api/web/rules/${rule.id}`, { method: "PATCH", body });
      setToast({ tone: "good", text: done });
      await load();
    });

  const remove = (rule: WebRule) =>
    run(`${rule.id}:delete`, async () => {
      await api(`/api/web/rules/${rule.id}`, { method: "DELETE" });
      await load();
    });

  const simulate = () =>
    run("simulate", async () => {
      const res = await api<WebSimulateResponse>("/api/web/simulate", { body: { site, visitors: 500 } });
      setToast({ tone: "good", text: `${res.visitors} simulated visitors sent (${res.orders} orders). Labelled synthetic.` });
      await load();
    });

  /* ---------------- the loop: synthetic traffic and autopilot, driven from here while on */

  const [trafficOn, setTrafficOn] = useState(false);
  const autopilotOn = !!data?.autopilot.on;
  const ticking = useRef(false);

  const setAutopilot = (on: boolean) =>
    run("autopilot", async () => {
      await api<WebAutopilotState>("/api/web/autopilot", { body: { site, on } });
      if (on && !data?.overview.visitors) setTrafficOn(true); // nothing to learn from yet
      await load();
    });

  useEffect(() => {
    if (!trafficOn && !autopilotOn) return;
    const tick = async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        if (trafficOn) await api<WebSimulateResponse>("/api/web/simulate", { body: { site, visitors: 300 } });
        if (autopilotOn) {
          const { actions } = await api<{ actions: WebAutopilotEntry[] }>("/api/web/autopilot/step", { body: { site } });
          const shipped = actions.find((a) => a.kind === "shipped");
          if (shipped) setToast({ tone: "good", text: shipped.message });
        }
        await load();
      } catch (e) {
        setToast({ tone: "bad", text: (e as Error).message });
        setTrafficOn(false);
      } finally {
        ticking.current = false;
      }
    };
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [trafficOn, autopilotOn, site, load]);

  const rules = useMemo(() => [...(data?.rules ?? [])].filter((r) => r.id !== draft?.savedId).reverse(), [data, draft?.savedId]);
  const resultOf = (id: string) => data?.results.find((r) => r.ruleId === id);

  const siteOptions = [...new Set([site, ...(data?.sites ?? []).map((s) => s.site)])].map((s) => ({ value: s, label: s }));
  const viewOptions = (["original", ...TRAFFIC_SOURCES] as const).map((s) => ({
    value: s,
    label: (
      <span title={s === "original" ? "The page without any Darwin changes" : TRAFFIC_SOURCE_LABEL[s]} className="flex items-center gap-1.5 whitespace-nowrap">
        {s === "original" ? "Original page" : SHORT[s]}
      </span>
    ),
  }));

  return (
    <>
      <PageHead
        mascot={<Mascot kind="designer" size={50} active />}
        title="Personalize"
        lede="Change any store page for each traffic source and search, then let an A/B test decide."
        right={
          <div className="flex items-center gap-2">
            <SiteSelect value={site} options={siteOptions} onChange={switchSite} />
            <Overflow label="Personalize tools">
              <PillButton tone="white" onClick={simulate} disabled={!!busy} title="500 simulated visitors through this site's live rules. Every event is labelled synthetic.">
                {busy === "simulate" ? <LoaderCircle className="animate-spin" /> : <Bot />}
                Send 500 test visitors
              </PillButton>
              <DwSwitch on={trafficOn} onChange={setTrafficOn} label="Traffic" title="Simulated shoppers: 300 every 3 s, mixed sources. Every event is labelled synthetic." />
              <DwSwitch
                on={autopilotOn}
                onChange={setAutopilot}
                busy={busy === "autopilot"}
                label="Autopilot"
                title="Darwin tests one idea per traffic source (biggest gap first), ships winners, stops losers, and tries the next idea"
              />
            </Overflow>
          </div>
        }
      />

      {loadError && <div className="rounded-[22px] bg-dw-warn-bg px-5 py-3 text-[14px] text-dw-warn">Couldn&apos;t load rules: {loadError}</div>}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* ---------------- left: preview + traffic */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card tone="white" hover={false} className="p-4 sm:p-6">
            <CardHead
              right={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {view.previewRuleId ? (
                    <span title="Showing a draft that isn't live yet">
                      <Tag tone="yellow">Previewing draft</Tag>
                    </span>
                  ) : (
                    <Tag tone="sand" className="max-sm:hidden">
                      Previews send no events
                    </Tag>
                  )}
                  <DwSwitch
                    on={heatOn}
                    onChange={setHeatOn}
                    label="Heatmap"
                    title="Where visitors click on this page, for the audience you're viewing as (darwin.js autocapture)"
                    className="h-9"
                  />
                </div>
              }
            >
              View the page as
            </CardHead>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
                <Segmented value={view.source} options={viewOptions} onChange={(s) => setView((v) => ({ ...v, source: s }))} />
              </div>
              {(view.source === "search" || view.source === "paid") && (
                <input
                  value={view.query}
                  onChange={(e) => setView((v) => ({ ...v, query: e.target.value }))}
                  placeholder="their search query"
                  aria-label="Search query"
                  className="h-10 w-full rounded-full border border-dw-hairline bg-white px-4 text-[14px] outline-none placeholder:text-dw-ink/35 focus:border-dw-ink/40 sm:w-64"
                />
              )}
            </div>

            <BrowserFrame
              className="mt-4"
              address={pageUrl ? pageUrl.replace(/^https?:\/\//, "") : `${site} · no page yet`}
              badge={
                view.source === "original" ? (
                  <Tag tone="outline" className="h-5 px-2 text-[11px]">
                    no changes
                  </Tag>
                ) : (
                  <Tag tone="ink" className="h-5 gap-1.5 px-2 text-[11px]">
                    as {SHORT[view.source]}
                  </Tag>
                )
              }
              actions={
                <>
                  <IconBtn title="Reload the preview" onClick={() => setReload((n) => n + 1)}>
                    <RefreshCw />
                  </IconBtn>
                  {pageUrl && (
                    <a
                      href={pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the store"
                      aria-label="Open the store"
                      className="grid size-9 place-items-center rounded-full text-dw-ink/60 transition-colors hover:bg-white/70 hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-dw-ink"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  )}
                </>
              }
            >
              <div className="relative h-[min(72vh,52rem)] min-h-[28rem] bg-white">
                {src ? (
                  <iframe ref={frame} key={src} src={src} onLoad={paint} title={`${site} preview`} className="absolute inset-0 h-full w-full" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-dw-bg">
                    <Empty mascot={<Mascot kind="observer" size={64} frame />}>
                      No page seen for “{site}” yet. Install darwin.js (below) and open the store once.
                    </Empty>
                  </div>
                )}
              </div>
            </BrowserFrame>

            {heatOn && <HeatList heat={heat} painted={painted} audience={heatSource ? SHORT[heatSource] : "all visitors"} />}
          </Card>

          <TrafficPanel data={data} site={site} />
        </div>

        {/* ---------------- right: ask, draft, rules */}
        <div className="flex min-w-0 flex-col gap-4">
          <Card tone="yellow" shape="designer" corner="tr" hover={false}>
            <CardHead>Ask Darwin to change the page</CardHead>
            <div className="mt-4 flex flex-col gap-3">
              <div className="rounded-[20px] bg-white/85 p-1.5 shadow-[0_1px_0_rgba(20,20,19,0.05)] focus-within:ring-2 focus-within:ring-dw-ink/80">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) draftFromPrompt();
                  }}
                  rows={3}
                  aria-label="Ask Darwin to change the page"
                  placeholder="e.g. People coming from ChatGPT should see delivery and returns up front"
                  className="block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[15px] leading-snug outline-none placeholder:text-dw-ink/40"
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-1">
                  <span className="text-[12px] text-dw-ink/45 max-sm:hidden">Ctrl + Enter to draft</span>
                  <PillButton size="sm" onClick={() => draftFromPrompt()} disabled={!!busy} className="ml-auto">
                    {busy === "draft" ? <LoaderCircle className="animate-spin" /> : <Send />}
                    Draft change
                  </PillButton>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setPrompt(ex);
                      draftFromPrompt(ex);
                    }}
                    className="dw-row group flex min-h-9 items-center gap-2 rounded-full bg-white/45 px-3.5 py-1.5 text-left text-[13px] text-dw-ink/75 hover:bg-white/80 hover:text-dw-ink focus-visible:outline-2 focus-visible:outline-dw-ink"
                  >
                    <Sparkles className="dw-tilt size-3.5 shrink-0 text-dw-ink/40 group-hover:text-dw-ink" aria-hidden />
                    <span className="min-w-0 truncate">{ex}</span>
                  </button>
                ))}
              </div>
              <PillButton tone="ink" onClick={suggest} disabled={!!busy} title="One idea per traffic source, biggest gap in your data first" className="self-start">
                {busy === "suggest" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                Suggest from data
              </PillButton>
            </div>
          </Card>

          {suggestions && !draft && (
            <Card tone="white" hover={false}>
              <CardHead
                right={
                  <IconBtn title="Close ideas" onClick={() => setSuggestions(undefined)}>
                    <X />
                  </IconBtn>
                }
              >
                Ideas for this site
              </CardHead>
              <ul className="mt-4 flex flex-col gap-2">
                {suggestions.map((s) => (
                  <li key={s.name} className="dw-row flex items-center gap-3 rounded-[22px] bg-dw-sand p-3.5">
                    <span className="dw-tilt shrink-0">
                      <Mascot kind="designer" size={34} active={false} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] leading-snug font-medium">{s.name}</div>
                      {s.hypothesis && <div className="mt-0.5 text-[13px] leading-snug text-dw-ink/60">{s.hypothesis}</div>}
                      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-dw-ink/55">
                        {s.audience.sources?.includes("ai") && <AiStack size={18} />}
                        {audienceLabel(s)}
                      </div>
                    </div>
                    <PillButton size="sm" tone="white" onClick={() => setDraft({ rule: s, source: "heuristic" })}>
                      Use
                    </PillButton>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {draft && <DraftCard draft={draft} busy={busy} onEdit={editDraft} onPreview={previewDraft} onLaunch={launch} onDiscard={discard} />}

          {!!data?.autopilot.log.length && <DecisionLog state={data.autopilot} />}
          <InstallPanel site={site} origin={origin} />
        </div>
      </div>

      <Card tone="white" hover={false}>
        <CardHead
          right={
            <span className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
              <LegendKey dashed>Original</LegendKey>
              <LegendKey>With change</LegendKey>
              <span className="num">{data?.rules.length ?? 0} rules</span>
            </span>
          }
        >
          Live rules &amp; tests
        </CardHead>
        <div className="mt-4 grid grid-cols-1 items-start gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
          {!data &&
            [0, 1, 2].map((i) => <div key={i} className={cn("h-44 animate-pulse rounded-[22px] bg-dw-sand", i > 0 && "max-lg:hidden", i > 1 && "max-2xl:hidden")} />)}
          {data && rules.length === 0 && (
            <div className="lg:col-span-2 2xl:col-span-3">
              <Empty mascot={<Mascot kind="experimenter" size={56} frame />}>Nothing yet. Ask Darwin for a change, or get ideas from your data.</Empty>
            </div>
          )}
          {rules.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              result={resultOf(r.id)}
              busy={busy}
              onView={() => setView((v) => ({ ...v, source: r.audience.sources?.[0] ?? "direct", previewRuleId: r.status === "running" || r.status === "shipped" ? undefined : r.id }))}
              onPause={() => patch(r, { status: "paused" }, `Paused “${r.name}”.`)}
              onResume={() => patch(r, { status: "running" }, `Resumed “${r.name}”.`)}
              onShip={() => patch(r, { status: "shipped" }, `Shipped “${r.name}” to everyone in its audience.`)}
              onDelete={() => remove(r)}
            />
          ))}
        </div>
      </Card>

      <DwToast toast={toast} />
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function DraftCard({
  draft,
  busy,
  onEdit,
  onPreview,
  onLaunch,
  onDiscard,
}: {
  draft: { rule: WebRuleDraft; source: WebDraftResponse["source"]; savedId?: string };
  busy?: string;
  onEdit: (fn: (r: WebRuleDraft) => WebRuleDraft) => void;
  onPreview: () => void;
  onLaunch: (mode: "test" | "always") => void;
  onDiscard: () => void;
}) {
  const r = draft.rule;
  const toggleSource = (s: TrafficSource) =>
    onEdit((x) => {
      const cur = x.audience.sources ?? [];
      const sources = cur.includes(s) ? cur.filter((y) => y !== s) : [...cur, s];
      return { ...x, audience: { ...x.audience, sources } };
    });
  return (
    <Card tone="pink" shape="experimenter" corner="br" hover={false}>
      <CardHead
        right={
          <span title={r.author}>
            <Tag tone={draft.source === "llm" ? "ink" : "white"}>{draft.source === "llm" ? "Written by AI" : r.author === "playbook" ? "Playbook" : "Heuristic"}</Tag>
          </span>
        }
      >
        <span className="flex items-center gap-3">
          <Mascot kind="designer" size={34} active />
          Draft
        </span>
      </CardHead>
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <input
            value={r.name}
            onChange={(e) => onEdit((x) => ({ ...x, name: e.target.value }))}
            aria-label="Rule name"
            className="h-11 w-full rounded-full bg-white/90 px-4 text-[15px] font-semibold outline-none focus:ring-2 focus:ring-dw-ink/80"
          />
          {r.hypothesis && <p className="mt-2 px-1 text-[14px] leading-snug text-dw-ink/70">{r.hypothesis}</p>}
        </div>

        <div>
          <FieldLabel>Who sees it</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {TRAFFIC_SOURCES.map((s) => {
              const on = r.audience.sources?.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={!!on}
                  onClick={() => toggleSource(s)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-dw-ink",
                    on ? "bg-dw-ink text-white" : "bg-white/55 text-dw-ink/65 hover:bg-white/85 hover:text-dw-ink",
                  )}
                >
                  {on && <Check className="size-3.5" aria-hidden />}
                  {SHORT[s]}
                </button>
              );
            })}
          </div>
          {!r.audience.sources?.length && <p className="mt-1.5 text-[12.5px] text-dw-ink/55">No source picked: everyone.</p>}
          {!!r.audience.queryIncludes?.length && <p className="mt-1.5 text-[12.5px] text-dw-ink/60">Only searches containing “{r.audience.queryIncludes.join("”, “")}”.</p>}
        </div>

        <div>
          <FieldLabel>What changes</FieldLabel>
          <ul className="flex flex-col gap-2">
            {r.changes.map((c, i) => (
              <li key={i} className="rounded-[18px] bg-white/80 p-3">
                <div className="mb-1.5 flex min-w-0 items-center gap-2">
                  <Tag tone="ink" className="h-5 px-2 text-[11px] capitalize">
                    {c.action}
                  </Tag>
                  {c.selector && <code className="min-w-0 truncate font-dwmono text-[12px] text-dw-ink/55">{c.selector}</code>}
                </div>
                {c.action !== "hide" && (
                  <input
                    value={c.value ?? ""}
                    onChange={(e) => onEdit((x) => ({ ...x, changes: x.changes.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))}
                    aria-label={`${c.action} text`}
                    className="h-9 w-full rounded-xl border border-dw-hairline bg-white px-3 text-[14px] outline-none focus:border-dw-ink/40"
                  />
                )}
              </li>
            ))}
          </ul>
          {r.changes.some((c) => c.value?.includes("{query}")) && (
            <p className="mt-2 text-[12.5px] text-dw-ink/60">{"{query}"} becomes the visitor&apos;s search, e.g. “Waterproof Trail Shoes”. Skipped when there&apos;s none.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PillButton tone="ink" onClick={() => onLaunch("test")} disabled={!!busy} title="Half the audience sees it; Darwin measures orders against the unchanged page">
            {busy === "test" ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
            Start A/B test
          </PillButton>
          <PillButton tone="white" onClick={() => onLaunch("always")} disabled={!!busy} title="Everyone in the audience sees it (no control group)">
            {busy === "always" ? <LoaderCircle className="animate-spin" /> : <Rocket />}
            Show to all of them
          </PillButton>
          <PillButton tone="white" onClick={onPreview} disabled={!!busy}>
            {busy === "preview" ? <LoaderCircle className="animate-spin" /> : <Eye />}
            Preview
          </PillButton>
          <PillButton tone="ghost" onClick={onDiscard} disabled={!!busy}>
            <X />
            Discard
          </PillButton>
        </div>
      </div>
    </Card>
  );
}

function RuleRow({
  rule,
  result,
  busy,
  onView,
  onPause,
  onResume,
  onShip,
  onDelete,
}: {
  rule: WebRule;
  result?: WebRuleResult;
  busy?: string;
  onView: () => void;
  onPause: () => void;
  onResume: () => void;
  onShip: () => void;
  onDelete: () => void;
}) {
  const test = rule.mode === "test" && rule.status !== "shipped";
  const n = (result?.control.visitors ?? 0) + (result?.treatment.visitors ?? 0);
  const p = result?.probabilityToBeat;
  const enough = (result?.control.visitors ?? 0) >= 100 && (result?.treatment.visitors ?? 0) >= 100;
  const verdict = !test || p === undefined || !enough ? undefined : p >= 0.95 ? "win" : p <= 0.05 ? "lose" : undefined;
  const T = "h-[22px] px-2 text-[11.5px]";
  const status =
    rule.status === "shipped" ? (
      <Tag tone="win" className={T}>
        Shipped
      </Tag>
    ) : rule.status === "paused" ? (
      <Tag tone="white" className={T}>
        Paused
      </Tag>
    ) : rule.status === "draft" ? (
      <Tag tone="outline" className={T}>
        Draft
      </Tag>
    ) : rule.mode === "test" ? (
      <Tag tone="ink" className={T}>
        A/B testing
      </Tag>
    ) : (
      <Tag tone="yellow" className={T}>
        Live
      </Tag>
    );
  const mascot: MascotKind = rule.status === "shipped" ? "shipper" : rule.status === "draft" ? "designer" : "experimenter";
  const maxRate = Math.max(result?.control.conversionRate ?? 0, result?.treatment.conversionRate ?? 0, 0.0001);

  return (
    <div
      className={cn(
        "rounded-[22px] p-4 transition-colors",
        verdict === "win" ? "bg-dw-win-bg" : verdict === "lose" ? "bg-dw-warn-bg" : rule.status === "paused" ? "bg-dw-sand/60" : "bg-dw-sand",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Mascot kind={mascot} size={40} frame active={rule.status === "running"} className="max-sm:hidden" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-snug font-semibold">{rule.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {status}
            {rule.author === "autopilot" && (
              <span title="Started by autopilot">
                <Tag tone="outline" className={T}>
                  autopilot
                </Tag>
              </span>
            )}
            {result?.synthetic && (
              <span title="Every visitor counted in this result was simulated">
                <Tag tone="warn" className={T}>
                  <Bot className="size-3" aria-hidden /> simulated
                </Tag>
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-dw-ink/60">
            {rule.audience.sources?.includes("ai") && <AiStack size={18} />}
            {audienceLabel(rule)}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-dw-ink/75" title={rule.changes.map(describeChange).join("\n")}>
            {rule.changes.map(describeChange).join(" · ")}
          </div>
          {rule.outcome && (
            <div className={cn("mt-1.5 text-[13px] leading-snug", rule.outcome.decision === "shipped" ? "text-dw-win" : "text-dw-ink/60")}>
              {rule.outcome.decision === "shipped" ? "Shipped" : "Stopped"}
              {rule.outcome.by === "autopilot" ? " by autopilot" : ""}: {rule.outcome.reason}
            </div>
          )}
        </div>
        <div className="-mt-1 -mr-1 flex shrink-0 items-center max-sm:order-last max-sm:-ml-2 max-sm:basis-full">
          <IconBtn title="View as this audience" onClick={onView}>
            <Eye />
          </IconBtn>
          {rule.status === "running" && (
            <IconBtn title="Pause" onClick={onPause} busy={busy === `${rule.id}:paused`}>
              <Pause />
            </IconBtn>
          )}
          {(rule.status === "paused" || rule.status === "draft") && (
            <IconBtn title={rule.status === "draft" ? "Start" : "Resume"} onClick={onResume} busy={busy === `${rule.id}:running`}>
              <Play />
            </IconBtn>
          )}
          {test && rule.status === "running" && (
            <IconBtn title="Ship to everyone in the audience" onClick={onShip} busy={busy === `${rule.id}:shipped`}>
              <Rocket />
            </IconBtn>
          )}
          <IconBtn title="Delete" onClick={onDelete} busy={busy === `${rule.id}:delete`}>
            <Trash />
          </IconBtn>
        </div>
      </div>

      {result && n > 0 && (
        <div className="mt-3 rounded-[18px] bg-white/75 p-3.5">
          {test ? (
            <>
              <div className="flex flex-col gap-2">
                <ArmBar label="Original" rate={result.control.conversionRate} visitors={result.control.visitors} max={maxRate} dashed />
                <ArmBar label="With change" rate={result.treatment.conversionRate} visitors={result.treatment.visitors} max={maxRate} />
              </div>
              {p !== undefined && (
                <div className="mt-3.5">
                  <div className="flex items-end justify-between gap-2">
                    <span className="text-[13px] text-dw-ink/65">Chance the change is better</span>
                    <span className="num text-[13px]">
                      <span className="text-[20px] leading-none font-semibold tracking-[-0.02em]">{pct(p, 0)}</span>
                      {result.lift !== undefined && <span className="ml-1.5 text-dw-ink/60">{`${result.lift >= 0 ? "+" : ""}${pct(result.lift, 0)} lift`}</span>}
                    </span>
                  </div>
                  <div className="relative mt-2 h-2.5 rounded-full bg-dw-ink/10" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label="Chance the change is better">
                    <div className="h-full rounded-full bg-dw-ink transition-[width] duration-700" style={{ width: `${Math.max(2, Math.round(p * 100))}%` }} />
                    <span className="absolute -top-1 h-[18px] w-[2px] rounded-full bg-dw-ink" style={{ left: "95%" }} title="Winning at 95%" />
                  </div>
                  <div className={cn("mt-2 text-[12.5px]", verdict === "win" ? "font-medium text-dw-win" : verdict === "lose" ? "font-medium text-dw-warn" : "text-dw-ink/55")}>
                    {verdict === "win"
                      ? "Winning. Ship it to everyone in this audience."
                      : verdict === "lose"
                        ? "Losing. Pause it and try another idea."
                        : enough
                          ? "Not decisive yet. Keep it running."
                          : "Collecting data: needs 100+ visitors in each group."}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-[13px] text-dw-ink/65">
              Reached <span className="num font-semibold text-dw-ink">{result.treatment.visitors}</span> visitors ·{" "}
              <span className="num font-semibold text-dw-ink">{pct(result.treatment.conversionRate)}</span> ordered
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One arm of a test: a horizontal pill (dashed = original, solid = with the change). */
function ArmBar({ label, rate, visitors, max, dashed }: { label: string; rate: number; visitors: number; max: number; dashed?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_7rem] items-center gap-3 text-[13px] max-sm:grid-cols-[5.75rem_minmax(0,1fr)_5.5rem] max-sm:gap-2">
      <span className="flex items-center gap-1.5 whitespace-nowrap text-dw-ink/70">
        <span className={cn("size-2.5 shrink-0 rounded-[3px]", dashed ? "border border-dashed border-dw-ink" : "bg-dw-ink")} aria-hidden />
        {label}
      </span>
      <span className="relative block h-3">
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", dashed ? "border-[1.5px] border-dashed border-dw-ink/80" : "bg-dw-ink")}
          style={{ width: `${Math.max(4, (rate / max) * 100)}%` }}
        />
      </span>
      <span className="num text-right">
        <span className="font-semibold">{pct(rate)}</span> <span className="text-dw-ink/50">of {visitors.toLocaleString()}</span>
      </span>
    </div>
  );
}

/**
 * Paint click heat over the elements in the preview iframe (same-origin pages only; a cross-origin
 * store can't be drawn on, so the list below the preview is the fallback). Returns whether it painted.
 */
function paintHeatmap(iframe: HTMLIFrameElement | null, elements: HeatmapElement[]): boolean {
  let doc: Document | null = null;
  try {
    doc = iframe?.contentDocument ?? null;
  } catch {
    return false;
  }
  if (!doc?.body) return false;
  doc.querySelector("[data-darwin-heatmap]")?.remove();
  if (!elements.length) return true;
  const win = doc.defaultView!;
  // Clicks per DOM element (several product buttons share one selector: split between them).
  const heat = new Map<Element, { clicks: number; rage: number }>();
  for (const e of elements) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = doc.querySelectorAll(e.selector);
    } catch {
      continue;
    }
    nodes.forEach((n) => {
      const h = heat.get(n) ?? { clicks: 0, rage: 0 };
      h.clicks += e.clicks / nodes.length;
      h.rage += e.rageClicks / nodes.length;
      heat.set(n, h);
    });
  }
  const total = elements.reduce((a, e) => a + e.clicks, 0) || 1;
  const max = Math.max(1, ...[...heat.values()].map((h) => h.clicks));
  const layer = doc.createElement("div");
  layer.setAttribute("data-darwin-heatmap", "");
  layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646";
  heat.forEach((h, n) => {
    const r = n.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const t = h.clicks / max;
    const size = Math.max(r.width, r.height) * 0.9 + 60;
    const cx = r.left + win.scrollX + r.width / 2;
    const cy = r.top + win.scrollY + r.height / 2;
    const hue = Math.round((1 - t) * 210); // blue (few) → red (most)
    const spot = doc.createElement("div");
    spot.style.cssText = `position:absolute;left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle,hsla(${hue},95%,55%,${0.35 + 0.4 * t}) 0%,hsla(${hue},95%,55%,0.18) 45%,transparent 70%);mix-blend-mode:multiply`;
    layer.appendChild(spot);
    const tag = doc.createElement("div");
    tag.textContent = `${Math.round((h.clicks / total) * 100)}% · ${Math.round(h.clicks)} clicks${h.rage >= 0.5 ? ` · ${Math.round(h.rage)} rage` : ""}`;
    // Keep the label inside the page (elements at the top or right edge would clip it).
    const left = Math.max(win.scrollX + 4, Math.min(r.left + win.scrollX, win.scrollX + doc.documentElement.clientWidth - 170));
    const top = Math.max(win.scrollY + 4, r.top + win.scrollY - 22);
    tag.style.cssText = `position:absolute;left:${left}px;top:${top}px;padding:2px 7px;border-radius:999px;background:${h.rage >= 0.5 ? "#b42318" : "#111"};color:#fff;font:600 11px/16px system-ui,sans-serif;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25)`;
    layer.appendChild(tag);
  });
  doc.body.appendChild(layer);
  return true;
}

function HeatList({ heat, painted, audience }: { heat?: WebHeatmap; painted?: boolean; audience: string }) {
  return (
    <div className="mt-4 rounded-[22px] bg-dw-sand p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-dw-ink/60">
        <span className="text-[15px] font-semibold text-dw-ink">Most clicked</span>
        <span className="num">
          {audience} · {heat?.clicks ?? 0} clicks from {heat?.visitors ?? 0} visitors
        </span>
        {!!heat?.rageClicks && <Tag tone="warn">{heat.rageClicks} rage clicks</Tag>}
        {!!heat?.syntheticClicks && (
          <span title="Clicks generated by Darwin's simulator (properties.synthetic = true)">
            <Tag tone="white">
              <Bot className="size-3" aria-hidden /> {heat.syntheticClicks} simulated
            </Tag>
          </span>
        )}
        {painted === false && <span className="text-dw-ink/45">(this store can&apos;t be drawn on from here: list only)</span>}
      </div>
      {!heat?.elements.length ? (
        <p className="text-[14px] text-dw-ink/55">No clicks yet for this audience. Turn on Traffic, or click around the store.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 gap-y-2.5 md:grid-cols-2">
          {heat.elements.slice(0, 8).map((e) => (
            <li key={e.selector} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 text-[13px]" title={e.selector}>
              <div className="min-w-0">
                <div className="truncate text-dw-ink/85">{e.text || e.selector.split(" > ").pop()}</div>
                <span className="relative mt-1 block h-2">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-dw-ink" style={{ width: `${Math.max(3, e.share * 100)}%` }} />
                </span>
              </div>
              <span className={cn("num text-right", e.rageClicks ? "font-medium text-dw-warn" : "text-dw-ink/60")}>
                {Math.round(e.share * 100)}%{e.rageClicks ? ` · ${e.rageClicks} rage` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Which crew member speaks for each autopilot decision. */
const LOG_ACTOR: Record<WebAutopilotEntry["kind"], { mascot: MascotKind; who: string }> = {
  on: { mascot: "analyst", who: "Darwin" },
  off: { mascot: "analyst", who: "Darwin" },
  started: { mascot: "experimenter", who: "Experimenter" },
  shipped: { mascot: "shipper", who: "Shipper" },
  stopped: { mascot: "experimenter", who: "Experimenter" },
  waiting: { mascot: "observer", who: "Observer" },
};

function DecisionLog({ state }: { state: WebAutopilotState }) {
  const entries = state.log.slice(0, 25);
  return (
    <Card tone="lilac" shape="analyst" corner="tr" hover={false}>
      <CardHead
        right={
          state.on ? (
            <Tag tone="ink">
              <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" aria-hidden /> Autopilot on
            </Tag>
          ) : (
            <Tag tone="outline">Autopilot off</Tag>
          )
        }
      >
        Darwin&apos;s decisions
      </CardHead>
      <ol className="mt-4 flex max-h-[22rem] flex-col overflow-y-auto pr-1">
        {entries.map((e, i) => {
          const actor = LOG_ACTOR[e.kind];
          return (
            <li key={`${e.at}-${i}`} className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-3.5 last:pb-0">
              {i < entries.length - 1 && <span className="absolute top-9 bottom-0 left-[1.1rem] w-px bg-dw-ink/15" aria-hidden />}
              <Mascot kind={actor.mascot} size={36} frame active={i === 0 && state.on} title={actor.who} />
              <div className="min-w-0 pt-0.5">
                <div className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="font-semibold">{actor.who}</span>
                  <span className="font-dwmono text-[11.5px] text-dw-ink/50 tabular-nums">
                    {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  {e.source && <span className="text-dw-ink/55">· {SHORT[e.source]}</span>}
                </div>
                <p className={cn("mt-0.5 text-[13.5px] leading-snug", e.kind === "shipped" ? "font-medium text-dw-win" : "text-dw-ink/80")}>{e.message}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function TrafficPanel({ data, site }: { data?: WebRulesResponse; site: string }) {
  const o = data?.overview;
  const rows = o ? TRAFFIC_SOURCES.map((s) => ({ s, ...o.bySource[s] })).sort((a, b) => b.visitors - a.visitors) : [];
  const maxRate = Math.max(0.0001, ...rows.map((r) => r.conversionRate), o?.conversionRate ?? 0);
  const H = 120;
  const avgY = o ? Math.round((o.conversionRate / maxRate) * H) : 0;
  return (
    <Card tone="olive" shape="observer" corner="br" hover={false}>
      <CardHead
        right={
          o && (
            <span className="flex flex-wrap items-center justify-end gap-2">
              <span className="num">
                {o.visitors.toLocaleString()} visitors · {pct(o.conversionRate)} ordered
              </span>
              {o.syntheticVisitors > 0 && (
                <span title="Visitors generated by Darwin's simulator (properties.synthetic = true)">
                  <Tag tone="white">
                    <Bot className="size-3" aria-hidden /> {o.syntheticVisitors.toLocaleString()} simulated
                  </Tag>
                </span>
              )}
            </span>
          )
        }
      >
        Who orders, by where they came from
      </CardHead>
      {!data ? (
        <div className="mt-6 grid h-[196px] animate-pulse grid-cols-7 items-end gap-2" aria-label="Loading">
          {[40, 70, 55, 90, 30, 60, 45].map((h, i) => (
            <span key={i} className="mx-auto w-[26px] rounded-full bg-dw-ink/10" style={{ height: h }} />
          ))}
        </div>
      ) : !o?.visitors ? (
        <Empty mascot={<Mascot kind="observer" size={56} frame />}>No visitors on {site} yet. Open the store, or send test visitors.</Empty>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-4">
            <LegendKey>Share who ordered</LegendKey>
            <LegendKey dashed>Site average</LegendKey>
          </div>
          <div className="-mx-2 overflow-x-auto px-2">
            <div className="mt-3 min-w-[34rem]">
              <div className="relative grid grid-cols-7 gap-2">
                <span className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-dw-ink/55" style={{ bottom: avgY }} aria-hidden />
                {rows.map((r) => (
                  <PillBar
                    key={r.s}
                    value={r.conversionRate}
                    max={maxRate}
                    height={H}
                    width={26}
                    dashed={r.visitors === 0}
                    label={r.visitors ? pct(r.conversionRate) : "–"}
                    title={`${TRAFFIC_SOURCE_LABEL[r.s]}: ${r.visitors} visitors, ${r.conversions} orders`}
                    className="relative [&>span:first-child]:rounded-full [&>span:first-child]:bg-dw-olive [&>span:first-child]:px-1.5"
                  />
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-2">
                {rows.map((r) => {
                  const below = r.visitors >= 20 && r.conversionRate < o.conversionRate * 0.75;
                  return (
                    <div key={r.s} className="flex flex-col items-center text-center" title={below ? "Converts well below the site average" : undefined}>
                      <div className="mb-1 flex h-6 items-center">
                        {r.s === "ai" ? (
                          <AiStack size={20} />
                        ) : (
                          <span className="grid size-6 place-items-center rounded-full bg-white/55 text-dw-ink/75 [&>svg]:size-3.5">{SOURCE_ICON[r.s]}</span>
                        )}
                      </div>
                      <div className="text-[13px] leading-tight font-medium whitespace-nowrap">{SHORT[r.s]}</div>
                      <div className={cn("num text-[12px]", below ? "font-semibold text-dw-ink" : "text-dw-ink/60")}>
                        {r.visitors.toLocaleString()} {below ? "· below avg" : "visitors"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function InstallPanel({ site, origin }: { site: string; origin: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${origin}/api/web/runtime.js?site=${site}"></script>\n<script async src="${origin}/darwin.js" data-darwin-site="${site}"></script>`;
  return (
    <Card tone="white" hover={false}>
      <CardHead
        right={
          <PillButton
            size="sm"
            tone="sand"
            onClick={() => {
              navigator.clipboard?.writeText(snippet).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </PillButton>
        }
      >
        Install on any store
      </CardHead>
      <pre className="mt-4 overflow-x-auto rounded-[18px] bg-dw-ink p-4 font-dwmono text-[12px] leading-relaxed whitespace-pre text-[#EDE6D6]">{snippet}</pre>
      <p className="mt-3 text-[13px] leading-snug text-dw-ink/60">
        Paste both in <code className="font-dwmono">&lt;head&gt;</code>. darwin.js alone works too (it loads the rules itself); the first line stops the page flickering. Changes are
        text and styles only, never scripts.
      </p>
    </Card>
  );
}
