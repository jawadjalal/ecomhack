"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  CircleStop,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  FlaskConical,
  Globe,
  Flame,
  Hourglass,
  LoaderCircle,
  Pause,
  Play,
  Power,
  Rocket,
  Send,
  Sparkles,
  Trash,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
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
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/switch";
import { cn } from "@/components/ui/cn";
import { DarwinWordmark } from "@/components/console/brand";

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

const EXAMPLES = [
  "Visitors from ChatGPT: banner saying Free UK delivery over £60 · Free 60-day returns · Ships in 24h",
  "Google searchers: put their search in the headline",
  'Instagram and TikTok: add a badge "★ 4.8 from 2,000+ runners" next to Add to cart',
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

  return (
    <div data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex max-w-[110rem] flex-col gap-4 p-4">
        {/* header */}
        <header className="flex flex-wrap items-center gap-3">
          <Link href="/console" className="flex items-center gap-2 rounded-lg pr-2 text-white/60 hover:text-white" title="Back to mission control">
            <ArrowLeft className="size-4" />
            <DarwinWordmark sub="personalize" />
          </Link>
          <div className="h-7 w-px bg-white/10" />
          <label className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[0.82rem] text-white/60">
            <Globe className="size-4 text-white/45" />
            Site
            <select
              value={site}
              onChange={(e) => switchSite(e.target.value)}
              className="bg-transparent font-medium text-white/90 outline-none [&>option]:bg-[#0b0d12]"
              aria-label="Site"
            >
              {[...new Set([site, ...(data?.sites ?? []).map((s) => s.site)])].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-9 items-center gap-1.5 rounded-xl px-2 text-[0.82rem] text-white/50 hover:text-white"
              title="Open the store"
            >
              <ExternalLink className="size-3.5" />
              <span className="max-w-[22rem] truncate">{pageUrl.replace(/^https?:\/\//, "")}</span>
            </a>
          )}
          <div className="flex-1" />
          <p className="hidden text-[0.82rem] text-white/45 2xl:block">Change any page with darwin.js, per traffic source and search query. A/B tested.</p>
          <Button onClick={simulate} disabled={!!busy} size="md" title="500 simulated visitors through this site's live rules. Every event is labelled synthetic.">
            {busy === "simulate" ? <LoaderCircle className="animate-spin" /> : <Bot />}
            +500 test visitors
          </Button>
          <Toggle
            on={trafficOn}
            onChange={setTrafficOn}
            tone="human"
            icon={<Activity />}
            label="Traffic"
            title="Simulated shoppers: 300 every 3 s, mixed sources. Every event is labelled synthetic."
          />
          <Toggle
            on={autopilotOn}
            onChange={setAutopilot}
            icon={<Cpu />}
            label="Autopilot"
            title="Darwin tests one idea per traffic source (biggest gap first), ships winners, stops losers, and tries the next idea"
          />
        </header>

        {loadError && (
          <div className="rounded-xl border border-bad/30 bg-bad/[0.08] px-4 py-2 text-[0.85rem] text-[#ffb4b4]">Couldn&apos;t load rules: {loadError}</div>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
          {/* ---------------- left: preview + traffic */}
          <div className="flex min-w-0 flex-col gap-4">
            <Panel>
              <PanelHeader
                icon={<Eye />}
                title="View the page as"
                right={
                  <>
                    {view.previewRuleId ? (
                      <Badge tone="warn" title="Showing a draft that isn't live yet">
                        Previewing draft
                      </Badge>
                    ) : (
                      <Badge tone="outline">Previews send no events</Badge>
                    )}
                    <Toggle
                      on={heatOn}
                      onChange={setHeatOn}
                      icon={<Flame />}
                      label="Heatmap"
                      title="Where visitors click on this page, for the audience you're viewing as (darwin.js autocapture)"
                    />
                  </>
                }
              />
              <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
                {(["original", ...TRAFFIC_SOURCES] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setView((v) => ({ ...v, source: s }))}
                    title={s === "original" ? "The page without any Darwin changes" : TRAFFIC_SOURCE_LABEL[s]}
                    className={cn(
                      "h-8 rounded-lg border px-3 text-[0.8rem] font-medium transition-colors",
                      view.source === s ? "border-brand/40 bg-brand/15 text-brand" : "border-white/[0.08] bg-white/[0.03] text-white/65 hover:text-white",
                    )}
                  >
                    {s === "original" ? "Original page" : SHORT[s]}
                  </button>
                ))}
                {(view.source === "search" || view.source === "paid") && (
                  <input
                    value={view.query}
                    onChange={(e) => setView((v) => ({ ...v, query: e.target.value }))}
                    placeholder="their search query"
                    aria-label="Search query"
                    className="ml-1 h-8 w-56 rounded-lg border border-white/[0.1] bg-black/30 px-3 text-[0.8rem] text-white outline-none focus:border-brand/40"
                  />
                )}
              </div>
              <div className="relative mx-5 mb-5 h-[min(72vh,52rem)] min-h-[28rem] overflow-hidden rounded-xl border border-white/[0.08] bg-white">
                {src ? (
                  <iframe ref={frame} key={src} src={src} onLoad={paint} title={`${site} preview`} className="absolute inset-0 h-full w-full" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center bg-[#0b0d12] p-8 text-center text-[0.9rem] text-white/50">
                    No page seen for “{site}” yet. Install darwin.js (right) and open the store once.
                  </div>
                )}
              </div>
              {heatOn && <HeatList heat={heat} painted={painted} audience={heatSource ? SHORT[heatSource] : "all visitors"} />}
            </Panel>

            <TrafficPanel data={data} />
          </div>

          {/* ---------------- right: ask, draft, rules */}
          <div className="flex min-w-0 flex-col gap-4">
            <Panel glow={!draft}>
              <PanelHeader icon={<WandSparkles />} title="Ask Darwin to change the page" />
              <div className="flex flex-col gap-3 px-5 pb-5">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) draftFromPrompt();
                  }}
                  rows={3}
                  placeholder="e.g. People coming from ChatGPT should see delivery and returns up front"
                  className="w-full resize-none rounded-xl border border-white/[0.1] bg-black/30 px-3.5 py-3 text-[0.9rem] text-white outline-none placeholder:text-white/30 focus:border-brand/40"
                />
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => {
                        setPrompt(ex);
                        draftFromPrompt(ex);
                      }}
                      className="max-w-full truncate rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-left text-[0.75rem] text-white/55 hover:border-white/20 hover:text-white"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => draftFromPrompt()} disabled={!!busy} className="flex-1">
                    {busy === "draft" ? <LoaderCircle className="animate-spin" /> : <Send />}
                    Draft change
                  </Button>
                  <Button onClick={suggest} disabled={!!busy} title="One idea per traffic source, biggest gap in your data first">
                    {busy === "suggest" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                    Suggest from data
                  </Button>
                </div>
              </div>
            </Panel>

            {suggestions && !draft && (
              <Panel>
                <PanelHeader
                  icon={<Sparkles />}
                  title="Ideas for this site"
                  right={
                    <button onClick={() => setSuggestions(undefined)} className="text-white/40 hover:text-white" aria-label="Close ideas">
                      <X className="size-4" />
                    </button>
                  }
                />
                <ul className="flex flex-col gap-2 px-5 pb-5">
                  {suggestions.map((s) => (
                    <li key={s.name} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[0.88rem] font-medium">{s.name}</div>
                          <div className="mt-0.5 text-[0.78rem] text-white/50">{s.hypothesis}</div>
                        </div>
                        <Button size="sm" onClick={() => setDraft({ rule: s, source: "heuristic" })}>
                          Use
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {draft && (
              <DraftCard
                draft={draft}
                busy={busy}
                onEdit={editDraft}
                onPreview={previewDraft}
                onLaunch={launch}
                onDiscard={discard}
              />
            )}

            {!!data?.autopilot.log.length && <DecisionLog state={data.autopilot} />}

            <Panel>
              <PanelHeader icon={<FlaskConical />} title="Live rules & tests" right={<span className="text-[0.75rem] text-white/40">{data?.rules.length ?? 0} rules</span>} />
              <div className="flex flex-col gap-2 px-5 pb-5">
                {rules.length === 0 && <p className="text-[0.85rem] text-white/45">Nothing yet. Ask Darwin for a change, or get ideas from your data.</p>}
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
            </Panel>

            <InstallPanel site={site} origin={origin} />
          </div>
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[0.86rem] shadow-2xl backdrop-blur",
              toast.tone === "good" ? "border-good/30 bg-[#0d1a12]/95 text-[#a6efbf]" : "border-bad/30 bg-[#1f0d0d]/95 text-[#ffb4b4]",
            )}
          >
            {toast.tone === "good" ? <Check className="size-4" /> : <X className="size-4" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
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
    <Panel glow>
      <PanelHeader
        icon={<WandSparkles />}
        title="Draft"
        right={
          <Badge tone={draft.source === "llm" ? "brand" : "neutral"} title={r.author}>
            {draft.source === "llm" ? "Written by AI" : r.author === "playbook" ? "Playbook" : "Heuristic"}
          </Badge>
        }
      />
      <div className="flex flex-col gap-3 px-5 pb-5">
        <input
          value={r.name}
          onChange={(e) => onEdit((x) => ({ ...x, name: e.target.value }))}
          aria-label="Rule name"
          className="h-9 rounded-lg border border-white/[0.1] bg-black/30 px-3 text-[0.92rem] font-medium text-white outline-none focus:border-brand/40"
        />
        {r.hypothesis && <p className="text-[0.8rem] leading-relaxed text-white/55">{r.hypothesis}</p>}

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-medium tracking-[0.12em] text-white/40 uppercase">
            <Users className="size-3.5" /> Who sees it
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TRAFFIC_SOURCES.map((s) => {
              const on = r.audience.sources?.includes(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSource(s)}
                  className={cn(
                    "h-7 rounded-lg border px-2.5 text-[0.76rem]",
                    on ? "border-human/40 bg-human/15 text-[#9cc5ff]" : "border-white/[0.07] text-white/45 hover:text-white",
                  )}
                >
                  {SHORT[s]}
                </button>
              );
            })}
          </div>
          {!r.audience.sources?.length && <p className="mt-1 text-[0.74rem] text-white/40">No source picked: everyone.</p>}
          {!!r.audience.queryIncludes?.length && <p className="mt-1 text-[0.74rem] text-white/50">Only searches containing “{r.audience.queryIncludes.join("”, “")}”.</p>}
        </div>

        <div>
          <div className="mb-1.5 text-[0.7rem] font-medium tracking-[0.12em] text-white/40 uppercase">What changes</div>
          <ul className="flex flex-col gap-2">
            {r.changes.map((c, i) => (
              <li key={i} className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5">
                <div className="mb-1 flex items-center gap-2 text-[0.72rem] text-white/45">
                  <span className="font-medium text-white/70 capitalize">{c.action}</span>
                  {c.selector && <code className="truncate font-mono text-[0.7rem] text-white/40">{c.selector}</code>}
                </div>
                {c.action !== "hide" && (
                  <input
                    value={c.value ?? ""}
                    onChange={(e) => onEdit((x) => ({ ...x, changes: x.changes.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))}
                    aria-label={`${c.action} text`}
                    className="h-8 w-full rounded-md border border-white/[0.08] bg-black/30 px-2.5 text-[0.84rem] text-white outline-none focus:border-brand/40"
                  />
                )}
              </li>
            ))}
          </ul>
          {r.changes.some((c) => c.value?.includes("{query}")) && (
            <p className="mt-1.5 text-[0.74rem] text-white/45">{"{query}"} becomes the visitor&apos;s search, e.g. “Waterproof Trail Shoes”. Skipped when there&apos;s none.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={onPreview} disabled={!!busy}>
            {busy === "preview" ? <LoaderCircle className="animate-spin" /> : <Eye />}
            Preview
          </Button>
          <Button variant="ghost" onClick={onDiscard} disabled={!!busy}>
            <X />
            Discard
          </Button>
          <Button variant="primary" onClick={() => onLaunch("test")} disabled={!!busy} title="Half the audience sees it; Darwin measures orders against the unchanged page">
            {busy === "test" ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
            Start A/B test
          </Button>
          <Button onClick={() => onLaunch("always")} disabled={!!busy} title="Everyone in the audience sees it (no control group)">
            {busy === "always" ? <LoaderCircle className="animate-spin" /> : <Rocket />}
            Show to all of them
          </Button>
        </div>
      </div>
    </Panel>
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
  const status =
    rule.status === "shipped" ? (
      <Badge tone="good">Shipped</Badge>
    ) : rule.status === "paused" ? (
      <Badge tone="neutral">Paused</Badge>
    ) : rule.status === "draft" ? (
      <Badge tone="outline">Draft</Badge>
    ) : rule.mode === "test" ? (
      <Badge tone="info">A/B testing</Badge>
    ) : (
      <Badge tone="brand">Live</Badge>
    );

  return (
    <div className={cn("rounded-xl border bg-white/[0.025] p-3", verdict === "win" ? "border-good/35" : verdict === "lose" ? "border-bad/30" : "border-white/[0.07]")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.88rem] font-medium">{rule.name}</span>
            {status}
            {rule.author === "autopilot" && (
              <Badge tone="outline" title="Started by autopilot">
                <Cpu /> autopilot
              </Badge>
            )}
            {result?.synthetic && (
              <Badge tone="warn" title="Every visitor counted in this result was simulated">
                <Bot /> synthetic
              </Badge>
            )}
          </div>
          {rule.outcome && (
            <div className={cn("mt-1 text-[0.76rem]", rule.outcome.decision === "shipped" ? "text-[#7ee2a0]" : "text-white/55")}>
              {rule.outcome.decision === "shipped" ? "Shipped" : "Stopped"}
              {rule.outcome.by === "autopilot" ? " by autopilot" : ""}: {rule.outcome.reason}
            </div>
          )}
          <div className="mt-0.5 text-[0.76rem] text-white/45">{audienceLabel(rule)}</div>
          <div className="mt-1 truncate text-[0.76rem] text-white/60" title={rule.changes.map(describeChange).join("\n")}>
            {rule.changes.map(describeChange).join(" · ")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton title="View as this audience" onClick={onView}>
            <Eye />
          </IconButton>
          {rule.status === "running" && (
            <IconButton title="Pause" onClick={onPause} busy={busy === `${rule.id}:paused`}>
              <Pause />
            </IconButton>
          )}
          {(rule.status === "paused" || rule.status === "draft") && (
            <IconButton title={rule.status === "draft" ? "Start" : "Resume"} onClick={onResume} busy={busy === `${rule.id}:running`}>
              <Play />
            </IconButton>
          )}
          {test && rule.status === "running" && (
            <IconButton title="Ship to everyone in the audience" onClick={onShip} busy={busy === `${rule.id}:shipped`}>
              <Rocket />
            </IconButton>
          )}
          <IconButton title="Delete" onClick={onDelete} busy={busy === `${rule.id}:delete`}>
            <Trash />
          </IconButton>
        </div>
      </div>

      {result && n > 0 && (
        <div className="mt-2.5 rounded-lg bg-black/25 p-2.5">
          {test ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-[0.76rem]">
                <div>
                  <div className="text-white/40">Original</div>
                  <div className="font-mono text-white/80 tabular">
                    {pct(result.control.conversionRate)} <span className="text-white/35">of {result.control.visitors}</span>
                  </div>
                </div>
                <div>
                  <div className="text-white/40">With change</div>
                  <div className="font-mono text-white/90 tabular">
                    {pct(result.treatment.conversionRate)} <span className="text-white/35">of {result.treatment.visitors}</span>
                  </div>
                </div>
              </div>
              {p !== undefined && (
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[0.72rem] text-white/50">
                    <span>Chance the change is better</span>
                    <span className={cn("font-mono tabular", verdict === "win" ? "text-[#7ee2a0]" : verdict === "lose" ? "text-[#ff9b9b]" : "text-white/80")}>
                      {pct(p, 0)}
                      {result.lift !== undefined && ` · ${result.lift >= 0 ? "+" : ""}${pct(result.lift, 0)} lift`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className={cn("h-full rounded-full", verdict === "win" ? "bg-good" : verdict === "lose" ? "bg-bad" : "bg-human")} style={{ width: `${Math.round(p * 100)}%` }} />
                  </div>
                  <div className="mt-1.5 text-[0.72rem] text-white/45">
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
            <div className="text-[0.76rem] text-white/60">
              Reached <span className="font-mono text-white/85 tabular">{result.treatment.visitors}</span> visitors ·{" "}
              <span className="font-mono text-white/85 tabular">{pct(result.treatment.conversionRate)}</span> ordered
            </div>
          )}
        </div>
      )}
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
    <div className="mx-5 mb-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.76rem] text-white/50">
        <Flame className="size-3.5 text-[#ffb37a]" />
        <span className="font-medium text-white/75">Most clicked</span>
        <span>
          · {audience} · {heat?.clicks ?? 0} clicks from {heat?.visitors ?? 0} visitors
        </span>
        {!!heat?.rageClicks && <Badge tone="bad">{heat.rageClicks} rage clicks</Badge>}
        {!!heat?.syntheticClicks && (
          <Badge tone="warn" title="Clicks generated by Darwin's simulator (properties.synthetic = true)">
            <Bot /> {heat.syntheticClicks} simulated
          </Badge>
        )}
        {painted === false && <span className="text-white/35">(this store can&apos;t be drawn on from here: list only)</span>}
      </div>
      {!heat?.elements.length ? (
        <p className="text-[0.8rem] text-white/40">No clicks yet for this audience. Turn on Traffic, or click around the store.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2">
          {heat.elements.slice(0, 8).map((e) => (
            <li key={e.selector} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 text-[0.78rem]" title={e.selector}>
              <div className="min-w-0">
                <div className="truncate text-white/80">{e.text || e.selector.split(" > ").pop()}</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#4c94f0] to-[#f05252]" style={{ width: `${Math.max(3, e.share * 100)}%` }} />
                </div>
              </div>
              <span className={cn("text-right font-mono tabular", e.rageClicks ? "text-[#ff9b9b]" : "text-white/55")}>
                {Math.round(e.share * 100)}%{e.rageClicks ? ` · ${e.rageClicks}⚡` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const LOG_ICON: Record<WebAutopilotEntry["kind"], React.ReactNode> = {
  on: <Power className="text-brand" />,
  off: <Power className="text-white/40" />,
  started: <FlaskConical className="text-[#9cc5ff]" />,
  shipped: <Rocket className="text-[#7ee2a0]" />,
  stopped: <CircleStop className="text-[#ff9b9b]" />,
  waiting: <Hourglass className="text-white/40" />,
};

function DecisionLog({ state }: { state: WebAutopilotState }) {
  return (
    <Panel glow={state.on}>
      <PanelHeader
        icon={<Cpu />}
        title="Darwin's decisions"
        right={state.on ? <Badge tone="brand">Autopilot on</Badge> : <Badge tone="outline">Autopilot off</Badge>}
      />
      <ol className="flex max-h-[18rem] flex-col gap-2 overflow-y-auto px-5 pb-5">
        {state.log.slice(0, 25).map((e, i) => (
          <li key={`${e.at}-${i}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2.5 text-[0.78rem] leading-snug [&_svg]:mt-0.5 [&_svg]:size-[0.9rem]">
            {LOG_ICON[e.kind]}
            <div className="min-w-0">
              <span className="mr-1.5 font-mono text-[0.7rem] text-white/35 tabular">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className="text-white/75">{e.message}</span>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function IconButton({ children, title, onClick, busy }: { children: React.ReactNode; title: string; onClick: () => void; busy?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white [&_svg]:size-[0.95rem]"
    >
      {busy ? <LoaderCircle className="animate-spin" /> : children}
    </button>
  );
}

function TrafficPanel({ data }: { data?: WebRulesResponse }) {
  const o = data?.overview;
  const rows = o ? TRAFFIC_SOURCES.map((s) => ({ s, ...o.bySource[s] })).sort((a, b) => b.visitors - a.visitors) : [];
  const max = Math.max(1, ...rows.map((r) => r.visitors));
  return (
    <Panel>
      <PanelHeader
        icon={<Users />}
        title="Visitors by traffic source"
        right={
          o && (
            <>
              <span className="text-[0.75rem] text-white/45">
                {o.visitors} visitors · {pct(o.conversionRate)} ordered
              </span>
              {o.syntheticVisitors > 0 && (
                <Badge tone="warn" title="Visitors generated by Darwin's simulator (properties.synthetic = true)">
                  <Bot /> {o.syntheticVisitors} simulated
                </Badge>
              )}
            </>
          )
        }
      />
      <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 px-5 pb-5 md:grid-cols-2">
        {!o?.visitors && <p className="text-[0.85rem] text-white/45">No visitors yet. Open the store, or send test visitors.</p>}
        {!!o?.visitors &&
          rows.map((r) => {
            const below = r.visitors >= 20 && r.conversionRate < o.conversionRate * 0.75;
            return (
              <div key={r.s} className="grid grid-cols-[6.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-[0.8rem]">
                <span className="text-white/70">{SHORT[r.s]}</span>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-human/70" style={{ width: `${(r.visitors / max) * 100}%` }} />
                </div>
                <span className={cn("text-right font-mono tabular", below ? "text-[#ffb37a]" : "text-white/60")} title={below ? "Converts well below the site average" : undefined}>
                  {r.visitors} · {pct(r.conversionRate)}
                </span>
              </div>
            );
          })}
      </div>
    </Panel>
  );
}

function InstallPanel({ site, origin }: { site: string; origin: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${origin}/api/web/runtime.js?site=${site}"></script>\n<script async src="${origin}/darwin.js" data-darwin-site="${site}"></script>`;
  return (
    <Panel>
      <PanelHeader
        icon={<Globe />}
        title="Install on any store"
        right={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(snippet).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        }
      />
      <div className="px-5 pb-5">
        <pre className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[0.72rem] leading-relaxed whitespace-pre text-white/75">{snippet}</pre>
        <p className="mt-2 text-[0.75rem] text-white/45">
          Paste both in <code className="font-mono">&lt;head&gt;</code>. darwin.js alone works too (it loads the rules itself); the first line stops the page flickering.
          Changes are text and styles only, never scripts.
        </p>
      </div>
    </Panel>
  );
}
