"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  GitPullRequest,
  LayoutDashboard,
  LoaderCircle,
  Radio,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import type { DashboardsResponse, GithubStatusResponse, TrackingEvent, TrackingPlan, WebSimulateResponse } from "@/lib/contracts";
import type { PullRequestResult } from "@/lib/github";
import type { WhopConnection, WhopStatus } from "@/lib/whop";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/components/ui/cn";
import { DarwinMark, DarwinWordmark, GithubMark } from "@/components/console/brand";
import { PrBody } from "@/components/console/modals";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";

/* ------------------------------------------------------------------ data */

type Stage = "connect" | "plan" | "install" | "live";

const STAGES: { id: Stage; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "plan", label: "Plan" },
  { id: "install", label: "Install" },
  { id: "live", label: "Live" },
];

const PR_STEPS = ["Reading the repository", "Adding darwin.js and your tracking plan", "Opening a pull request"];

const SUGGESTIONS = ["Also track wishlist adds", "Don't track rage clicks", "Track coupon codes"];

async function http<T>(method: "GET" | "POST" | "PATCH" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `${method} ${path} → ${res.status}`);
  return j;
}

/** Darwin runs on its own onboarding: each step is an event, so the same dashboards (and A/B tests) apply. */
function track(event: string, props: Record<string, unknown> = {}) {
  const w = window as unknown as { darwin?: { capture?: (e: string, p: object) => void } | unknown[] };
  if (w.darwin && !Array.isArray(w.darwin) && w.darwin.capture) w.darwin.capture(event, props);
  else ((w.darwin as unknown[] | undefined) ?? ((w as { darwin?: unknown[] }).darwin = [])).push([event, props]);
}

const REPO_RE = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

interface Message {
  from: "you" | "darwin";
  text: string;
  pending?: boolean;
  /** Shown one by one while Darwin works. */
  steps?: string[];
}

/* ------------------------------------------------------------------ app */

export function OnboardingApp() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("connect");
  const [prompt, setPrompt] = useState("");
  const [open, setOpen] = useState<"whop" | "github" | null>(null);

  const [ghStatus, setGhStatus] = useState<(GithubStatusResponse & { dryRun?: boolean }) | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [whopStatus, setWhopStatus] = useState<WhopStatus | null>(null);
  const [whop, setWhop] = useState<WhopConnection | null>(null);

  const [plan, setPlan] = useState<TrackingPlan | null>(null);
  const [chat, setChat] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [pr, setPr] = useState<PullRequestResult | null>(null);

  useEffect(() => {
    http<GithubStatusResponse>("GET", "/api/github/status").then(setGhStatus, () => {});
    http<WhopStatus>("GET", "/api/whop/status").then(setWhopStatus, () => {});
  }, []);

  const connected = !!repo;

  const reply = (text: string) => setChat((c) => [...c.filter((m) => !m.pending), { from: "darwin", text }]);

  const toPlan = async () => {
    if (!connected || busy) return;
    setOpen(null);
    setStage("plan");
    setBusy(true);
    setChat([
      ...(prompt.trim() ? [{ from: "you" as const, text: prompt.trim() }] : []),
      {
        from: "darwin",
        text: "",
        pending: true,
        steps: [`Reading ${repo}`, "Looking for analytics you already run", prompt.trim() ? "Planning from what you said" : "Planning a standard store setup", "Choosing your dashboards"],
      },
    ]);
    track("onboarding_connected", { whop: !!whop, described: !!prompt.trim() });
    try {
      // Keep the steps on screen long enough to read, even when the plan comes back instantly.
      const [res] = await Promise.all([
        http<{ plan: TrackingPlan; reply: string; note?: string }>("POST", "/api/onboarding/plan", {
          prompt: prompt.trim() || undefined,
          repoUrl: `https://github.com/${repo}`,
          whop: whop?.title,
        }),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
      setPlan(res.plan);
      reply(res.note ? `${res.reply}\n\n${res.note}` : res.reply);
      track("plan_ready", { events: res.plan.events.filter((e) => e.enabled).length, goals: res.plan.goals?.length ?? 0 });
    } catch (err) {
      reply(`Something went wrong: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const say = async (text: string) => {
    if (!plan || busy || !text.trim()) return;
    setBusy(true);
    setChat((c) => [...c, { from: "you", text: text.trim() }, { from: "darwin", text: "", pending: true }]);
    try {
      const res = await http<{ plan: TrackingPlan; reply: string }>("PATCH", "/api/onboarding/plan", { site: plan.site, message: text.trim() });
      setPlan(res.plan);
      reply(res.reply);
      track("plan_changed", { via: "chat" });
    } catch (err) {
      reply(`I couldn't change that: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (name: string, on: boolean) => {
    if (!plan) return;
    setPlan({ ...plan, events: plan.events.map((e) => (e.name === name ? { ...e, enabled: on } : e)) });
    try {
      const res = await http<{ plan: TrackingPlan }>("PUT", "/api/onboarding/plan", { site: plan.site, enabled: { [name]: on } });
      setPlan(res.plan);
      track("plan_changed", { via: "toggle" });
    } catch {
      /* keep the optimistic state; the next change re-syncs */
    }
  };

  const wide = stage === "live";

  return (
    <main data-darwin-dark className="relative min-h-screen w-full overflow-clip bg-[#05060a] text-white">
      {/* Blurred mission control behind the composer */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/onboarding/dashboard-backdrop.jpg" alt="" className="size-full scale-105 object-cover object-top opacity-80 blur-[7px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(5,6,10,0.8),rgba(5,6,10,0.45)_75%)]" />
      </div>

      <div className={cn("relative mx-auto flex min-h-screen w-full flex-col px-4 transition-[max-width] duration-500 sm:px-6", wide ? "max-w-[82rem]" : "max-w-[52rem]")}>
        <nav className="flex h-20 shrink-0 items-center justify-between">
          <DarwinWordmark sub="Setup" />
          <Stepper stage={stage} />
        </nav>

        <div className={cn("flex flex-1 flex-col pb-16", stage === "connect" && "justify-center")}>
          <AnimatePresence mode="wait">
            {stage === "connect" && (
              <motion.section key="connect" {...fade} className="flex flex-col gap-6">
                <header className="text-center">
                  <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.035em] sm:text-[2.6rem]">
                    Let&apos;s make your store <span className="text-brand">improve itself</span>
                  </h1>
                  <p className="mt-2 text-[0.95rem] text-white/55">Tell Darwin about your store and connect its code. Darwin plans what to measure, installs it as a pull request, and builds your dashboards.</p>
                </header>

                <Panel glow={connected} className="overflow-visible">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (connected) toPlan();
                        else setOpen("github");
                      }
                    }}
                    rows={3}
                    placeholder="What do you sell, and what worries you? e.g. “trail running shoes; checkout feels slow on mobile and people ask about sizing”"
                    className="w-full resize-none bg-transparent px-5 pt-5 pb-2 text-[1.05rem] leading-relaxed text-white outline-none placeholder:text-white/30"
                  />

                  <AnimatePresence initial={false}>
                    {open === "whop" && (
                      <Drawer key="whop">
                        <WhopConnect
                          status={whopStatus}
                          onConnected={(c) => {
                            setWhop(c);
                            setOpen(repo ? null : "github");
                          }}
                        />
                      </Drawer>
                    )}
                    {open === "github" && (
                      <Drawer key="github">
                        <GithubConnect
                          status={ghStatus}
                          onConnected={(r) => {
                            setRepo(r);
                            setOpen(null);
                          }}
                        />
                      </Drawer>
                    )}
                  </AnimatePresence>

                  {!connected && !open && (
                    <span className="flex items-center gap-1 px-5 pb-1 text-[0.75rem] font-medium text-brand/80">
                      <ArrowDown className="size-3.5 animate-bounce" /> Connect GitHub to start (Whop is optional: it adds your payments)
                    </span>
                  )}
                  <div className="flex items-end justify-between gap-3 px-4 pt-2 pb-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ConnectChip
                        icon={<GithubMark className="size-4" />}
                        label="GitHub"
                        value={repo ?? undefined}
                        active={open === "github"}
                        onClick={() => setOpen(open === "github" ? null : "github")}
                      />
                      <ConnectChip
                        icon={<WhopMark />}
                        label="Whop"
                        value={whop ? whop.title : undefined}
                        hint={whop?.mode === "offline" ? "demo" : whop ? undefined : "optional"}
                        active={open === "whop"}
                        onClick={() => setOpen(open === "whop" ? null : "whop")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={toPlan}
                      disabled={!connected}
                      aria-label="Continue"
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-[#0b1200] shadow-[0_0_0_1px_rgba(182,240,90,0.4),0_8px_30px_-8px_rgba(182,240,90,0.55)] transition-[opacity,transform] hover:bg-[#c8f77c] active:scale-95 disabled:opacity-30 disabled:shadow-none"
                    >
                      <ArrowUp className="size-5" />
                    </button>
                  </div>
                </Panel>
              </motion.section>
            )}

            {stage === "plan" && (
              <motion.section key="plan" {...fade} className="flex flex-col gap-4">
                <Thread messages={chat.slice(0, 2)} />
                {plan && <PlanCard plan={plan} onToggle={toggle} />}
                <Thread messages={chat.slice(2)} />
                {plan && (
                  <>
                    <Composer busy={busy} onSend={say} />
                    <div className="flex items-center justify-between gap-3">
                      <Button variant="ghost" onClick={() => setStage("connect")}>
                        Back
                      </Button>
                      <Button
                        variant="primary"
                        size="lg"
                        disabled={busy}
                        onClick={() => {
                          setStage("install");
                          track("plan_confirmed", { events: plan.events.filter((e) => e.enabled).length });
                        }}
                      >
                        Looks good: install it <ArrowRight />
                      </Button>
                    </div>
                  </>
                )}
              </motion.section>
            )}

            {stage === "install" && plan && (
              <motion.section key="install" {...fade} className="flex flex-col gap-4">
                <AgentBubble>
                  I&apos;ll open one pull request on <b className="font-mono text-white">{plan.repo}</b>: it loads darwin.js (under 5 KB) and commits your plan as{" "}
                  <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-white/80">DARWIN_TRACKING.md</code>, with the one line each event needs. Nothing
                  changes until you merge it.
                </AgentBubble>
                {!pr ? (
                  <InstallPr
                    site={plan.site}
                    onDone={(result) => {
                      setPr(result);
                      track("pr_opened", { dry_run: result.dryRun });
                    }}
                  />
                ) : (
                  <>
                    <Panel glow className="p-5">
                      <PrBody pr={pr} />
                    </Panel>
                    <div className="flex justify-end">
                      <Button variant="primary" size="lg" onClick={() => setStage("live")}>
                        <Radio /> Start recording
                      </Button>
                    </div>
                  </>
                )}
              </motion.section>
            )}

            {stage === "live" && plan && (
              <motion.section key="live" {...fade} className="flex flex-col gap-5">
                <Live
                  plan={plan}
                  onOpen={() => {
                    track("dashboards_opened", { site: plan.site });
                    router.push(`/console/dashboards?site=${encodeURIComponent(plan.site)}`);
                  }}
                />
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25 },
};

/* ------------------------------------------------------------------ plan stage */

function Thread({ messages }: { messages: Message[] }) {
  return (
    <>
      {messages.map((m, i) =>
        m.from === "you" ? (
          <motion.div
            key={`you-${i}-${m.text}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="ml-auto max-w-[80%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.07] px-4 py-3 text-[0.95rem] text-white/90"
          >
            {m.text}
          </motion.div>
        ) : (
          <motion.div key={`darwin-${i}-${m.pending ? "pending" : m.text}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <AgentBubble>{m.pending ? m.steps ? <Working steps={m.steps} /> : <Typing /> : <span className="whitespace-pre-line">{m.text}</span>}</AgentBubble>
          </motion.div>
        ),
      )}
    </>
  );
}

function Working({ steps }: { steps: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(steps.length - 1, n + 1)), 650);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <ol className="flex flex-col gap-1.5 py-0.5" aria-live="polite">
      {steps.slice(0, i + 1).map((s, k) => (
        <motion.li key={s} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-[0.9rem]">
          {k < i ? <Check className="size-4 text-brand" /> : <LoaderCircle className="size-4 animate-spin text-brand" />}
          <span className={k < i ? "text-white/55" : "text-white/85"}>{s}…</span>
        </motion.li>
      ))}
    </ol>
  );
}

function Typing() {
  return (
    <span className="flex h-6 items-center gap-1" aria-label="Darwin is thinking">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="size-1.5 rounded-full bg-white/60" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </span>
  );
}

function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = (t: string) => {
    if (!t.trim() || busy) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0b0d12]/85 p-2 pl-4 backdrop-blur-sm focus-within:border-brand/40"
      >
        <WandSparkles className="size-4 shrink-0 text-brand/80" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anything else to track? Or something to leave out?"
          aria-label="Tell Darwin what to change in the plan"
          className="h-10 min-w-0 flex-1 bg-transparent text-[0.95rem] text-white outline-none placeholder:text-white/30"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-[#0b1200] transition-opacity hover:bg-[#c8f77c] disabled:opacity-30"
        >
          {busy ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[0.78rem] text-white/55 hover:border-white/20 hover:text-white disabled:opacity-40">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, onToggle }: { plan: TrackingPlan; onToggle: (name: string, on: boolean) => void }) {
  const auto = plan.events.filter((e) => e.automatic && e.category !== "revenue");
  const custom = plan.events.filter((e) => !e.automatic);
  const revenue = plan.events.filter((e) => e.category === "revenue");
  return (
    <Panel glow className="overflow-visible">
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap gap-2 text-[0.78rem]" aria-label="What Darwin found">
          {plan.framework && <Fact label="Stack" value={plan.repoRead === false ? `${plan.framework} (assumed)` : plan.framework} />}
          <Fact
            label="Analytics"
            value={plan.repoRead === false ? "not checked yet" : plan.existingAnalytics?.length ? plan.existingAnalytics.join(" · ") : "none found"}
            hint={plan.existingAnalytics?.some((a) => !a.startsWith("Darwin")) ? "darwin.js runs alongside" : undefined}
          />
          {!!plan.goals?.length && <Fact label="Heard" value={plan.goals.join(", ")} brand />}
          {plan.author.startsWith("llm:") && <Fact label="Planned by" value={plan.author.slice(4)} />}
        </div>
        <section>
          <SectionTitle icon={<Sparkles />} title="Recorded automatically" hint="no code: darwin.js does it" />
          <div className="flex flex-wrap gap-2">
            {auto.map((e) => (
              <button
                key={e.name}
                type="button"
                aria-pressed={e.enabled}
                title={e.why}
                onClick={() => onToggle(e.name, !e.enabled)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.82rem] transition-colors",
                  e.enabled ? "border-brand/35 bg-brand/[0.08] text-white/90" : "border-white/[0.08] text-white/35 line-through",
                )}
              >
                {e.enabled && <Check className="size-3.5 text-brand" />}
                {e.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={<Code />} title="Your store sends" hint="one line each, listed in the PR" />
          <ul className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {custom.map((e) => (
                <EventRow key={e.name} e={e} onToggle={onToggle} />
              ))}
            </AnimatePresence>
          </ul>
        </section>

        {revenue.length > 0 && (
          <section>
            <SectionTitle icon={<WhopMark />} title="From Whop" hint="by webhook, no code" />
            <ul className="flex flex-col gap-1.5">
              {revenue.map((e) => (
                <EventRow key={e.name} e={e} onToggle={onToggle} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionTitle icon={<LayoutDashboard />} title="Dashboards Darwin will build" hint="from what you record" />
          <div className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {plan.dashboards.map((d) => (
                <motion.span
                  key={d.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  title={d.why}
                  className="rounded-lg border border-human/25 bg-human/[0.08] px-2.5 py-1 text-[0.8rem] text-[#b9d6ff]"
                >
                  {d.title}
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
        </section>
      </div>
    </Panel>
  );
}

function Fact({ label, value, hint, brand }: { label: string; value: string; hint?: string; brand?: boolean }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded-lg border px-2.5 py-1", brand ? "border-brand/30 bg-brand/[0.07]" : "border-white/[0.08] bg-white/[0.03]")} title={hint}>
      <span className="text-white/40">{label}</span>
      <span className={brand ? "text-brand" : "text-white/85"}>{value}</span>
    </span>
  );
}

function SectionTitle({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[0.72rem] font-medium tracking-[0.12em] text-white/45 uppercase [&_svg]:size-3.5">
      {icon}
      {title}
      <span className="tracking-normal text-white/30 normal-case">· {hint}</span>
    </div>
  );
}

function EventRow({ e, onToggle }: { e: TrackingEvent; onToggle: (name: string, on: boolean) => void }) {
  const [code, setCode] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={cn("rounded-xl border px-3 py-2.5", e.fromPrompt && e.enabled ? "border-brand/30 bg-brand/[0.05]" : "border-white/[0.06] bg-white/[0.02]", !e.enabled && "opacity-50")}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={e.enabled}
          aria-label={`Record ${e.label}`}
          onClick={() => onToggle(e.name, !e.enabled)}
          className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors", e.enabled ? "border-brand bg-brand text-[#0b1200]" : "border-white/25")}
        >
          {e.enabled && <Check className="size-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[0.9rem]">
            <span className="font-medium text-white/90">{e.label}</span>
            <code className="font-mono text-[0.74rem] text-white/40">{e.name}</code>
            {e.fromPrompt && (
              <Badge tone="brand">
                <Sparkles /> from what you said
              </Badge>
            )}
          </div>
          <div className="mt-0.5 text-[0.8rem] leading-snug text-white/50">{e.why}</div>
          {code && e.snippet && <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[0.74rem] text-[#cfe9a8]">{e.snippet}</pre>}
        </div>
        {e.snippet && (
          <button type="button" onClick={() => setCode((c) => !c)} className="flex shrink-0 items-center gap-1 text-[0.74rem] text-white/40 hover:text-white" aria-expanded={code}>
            code <ChevronDown className={cn("size-3.5 transition-transform", code && "rotate-180")} />
          </button>
        )}
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ install */

function InstallPr({ site, onDone }: { site: string; onDone: (pr: PullRequestResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((i) => Math.min(PR_STEPS.length - 1, i + 1)), 700);
    return () => clearInterval(t);
  }, [busy]);

  const run = async () => {
    setBusy(true);
    setStep(0);
    setError(null);
    try {
      onDone(await http<PullRequestResult>("POST", "/api/onboarding/install", { site }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {busy && (
        <ol className="flex flex-col gap-2 px-1">
          {PR_STEPS.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-2 text-[0.88rem]", i <= step ? "text-white/80" : "text-white/30")}>
              {i < step ? <Check className="size-4 text-brand" /> : i === step ? <LoaderCircle className="size-4 animate-spin text-brand" /> : <span className="size-4 rounded-full border border-white/15" />}
              {s}
            </li>
          ))}
        </ol>
      )}
      {error && <ErrorLine error={error} />}
      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={run} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <GitPullRequest />}
          Open pull request
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ live */

function Live({ plan, onOpen }: { plan: TrackingPlan; onOpen: () => void }) {
  const [data, setData] = useState<DashboardsResponse>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);
  const load = useCallback(() => http<DashboardsResponse>("GET", `/api/dashboards?site=${encodeURIComponent(plan.site)}`).then(setData, () => {}), [plan.site]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 2500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const simulate = async () => {
    setSending(true);
    try {
      const goals = plan.events.filter((e) => e.enabled && e.category === "goal").map((e) => e.name);
      const res = await http<WebSimulateResponse>("POST", "/api/web/simulate", { site: plan.site, visitors: 300, events: goals.slice(0, 12) });
      setSent((n) => n + res.visitors);
      await load();
    } finally {
      setSending(false);
    }
  };

  const events = plan.events.filter((e) => e.enabled);
  const seen = data?.seen ?? {};
  const recorded = events.filter((e) => (seen[e.name] ?? 0) > 0).length;
  const firstRef = useRef(false);
  useEffect(() => {
    if (recorded > 0 && !firstRef.current) {
      firstRef.current = true;
      track("first_data", { site: plan.site });
    }
  }, [recorded, plan.site]);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[0.78rem] font-medium tracking-[0.14em] text-brand uppercase">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand/60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
            </span>
            Recording · {plan.site}
          </div>
          <h1 className="mt-1 text-[1.9rem] leading-tight font-semibold tracking-[-0.03em] sm:text-[2.3rem]">Your dashboards are built</h1>
          <p className="mt-1 max-w-[46rem] text-[0.92rem] text-white/55">
            Merge the pull request and deploy: real shoppers show up here within seconds. Want to see it fill now? Send simulated shoppers (they&apos;re labelled, and never mixed into your real numbers).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={simulate} disabled={sending}>
            {sending ? <LoaderCircle className="animate-spin" /> : <Bot />}
            Send 300 simulated shoppers
          </Button>
          <Button variant="primary" size="lg" onClick={onOpen}>
            <LayoutDashboard /> Open my dashboards
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Panel className="self-start">
          <div className="flex flex-col gap-1 p-4">
            <div className="mb-1 flex items-center justify-between text-[0.72rem] font-medium tracking-[0.12em] text-white/45 uppercase">
              Events <span className="tracking-normal text-white/60 normal-case tabular">{recorded}/{events.length} recorded</span>
            </div>
            {events.map((e) => {
              const n = seen[e.name] ?? 0;
              return (
                <div key={e.name} className="flex items-center gap-2 py-1 text-[0.82rem]">
                  {n > 0 ? (
                    <Check className="size-4 shrink-0 text-brand" />
                  ) : (
                    <span className="relative flex size-4 shrink-0 items-center justify-center">
                      <span className="size-1.5 animate-pulse rounded-full bg-white/40" />
                    </span>
                  )}
                  <span className={cn("min-w-0 flex-1 truncate", n > 0 ? "text-white/85" : "text-white/45")}>{e.label}</span>
                  <span className="font-mono text-[0.74rem] text-white/40 tabular">{n > 0 ? n.toLocaleString("en-GB") : "waiting"}</span>
                </div>
              );
            })}
            {!!data && data.totalEvents - data.syntheticEvents > 0 && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-good/30 bg-good/[0.08] px-2.5 py-1.5 text-[0.76rem] text-[#a6efbf]">
                <Radio className="size-3.5" /> Real visitors are arriving: {(data.totalEvents - data.syntheticEvents).toLocaleString("en-GB")} real {data.totalEvents - data.syntheticEvents === 1 ? "event" : "events"} so far.
              </div>
            )}
            {!!data?.syntheticEvents && (
              <div className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-2.5 py-1.5 text-[0.74rem] text-[#ffd27a]">
                {data.syntheticEvents.toLocaleString("en-GB")} of {data.totalEvents.toLocaleString("en-GB")} events are simulated{sent ? ` (${sent} shoppers sent)` : ""}.
              </div>
            )}
            <Link href={`/console/personalize?site=${encodeURIComponent(plan.site)}`} className="mt-3 flex items-center gap-1 text-[0.8rem] text-white/50 hover:text-white">
              Personalize pages by traffic source <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </Panel>
        <DashboardGrid dashboards={data?.dashboards ?? []} compact />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

function Stepper({ stage }: { stage: Stage }) {
  const idx = STAGES.findIndex((s) => s.id === stage);
  return (
    <ol className="flex items-center gap-1 text-[0.8rem]">
      {STAGES.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              i === idx ? "bg-brand/12 text-brand" : i < idx ? "text-white/70" : "text-white/30",
            )}
          >
            {i < idx ? <Check className="size-3.5 text-brand" /> : <span className="tabular">{i + 1}</span>}
            <span className="hidden sm:inline">{s.label}</span>
          </span>
          {i < STAGES.length - 1 && <ChevronRight className="size-3.5 text-white/20" />}
        </li>
      ))}
    </ol>
  );
}

function WhopMark() {
  return (
    <span aria-hidden className="grid size-4 place-items-center rounded-[0.3rem] bg-[#ff6243] text-[0.6rem] leading-none font-bold text-white">
      W
    </span>
  );
}

function ConnectChip({
  icon,
  label,
  value,
  hint,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  const done = !!value;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={cn(
        "flex h-9 max-w-[16rem] items-center gap-2 rounded-full border px-3 text-[0.85rem] font-medium transition-colors",
        done
          ? "border-brand/30 bg-brand/[0.08] text-white/90 hover:bg-brand/[0.12]"
          : "border-dashed border-white/20 bg-white/[0.03] text-white/70 hover:border-white/35 hover:text-white",
        active && "border-solid border-brand/50",
      )}
    >
      {icon}
      <span className="truncate">{done ? value : `Connect ${label}`}</span>
      {hint && <span className="text-white/40">({hint})</span>}
      {done && <Check className="size-3.5 shrink-0 text-brand" />}
    </button>
  );
}

function Drawer({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="mx-4 mb-1 rounded-xl border border-white/[0.08] bg-black/30 p-4">{children}</div>
    </motion.div>
  );
}

function ErrorLine({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/[0.08] px-3 py-2 text-[0.85rem] text-[#ffb4b4]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
    </div>
  );
}

const inputCls =
  "h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 font-mono text-[0.88rem] text-white outline-none placeholder:text-white/25 focus:border-brand/50 focus:bg-white/[0.06]";

function WhopConnect({ status, onConnected }: { status: WhopStatus | null; onConnected: (c: WhopConnection) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const connect = async (apiKey?: string) => {
    setBusy(true);
    setError(null);
    try {
      onConnected(await http<WhopConnection>("POST", "/api/whop/connect", { apiKey }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        connect(key.trim() || undefined);
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-[0.85rem] text-white/55">
        Paste a Whop API key (Developer → API keys). It stays on the server. Same key the Whop CLI uses:{" "}
        <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.78rem] text-white/75">whop login --method api-key</code>
      </p>
      <div className="flex gap-2">
        <input ref={input} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="whop_…" autoComplete="off" className={inputCls} />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
          {key.trim() ? "Connect" : status?.configured ? "Use server key" : "Try demo"}
        </Button>
      </div>
      {!key.trim() && !status?.configured && <span className="text-[0.75rem] text-white/35">No key and no WHOP_API_KEY on the server: connects a labelled demo business.</span>}
      {error && <ErrorLine error={error} />}
    </form>
  );
}

function GithubConnect({ status, onConnected }: { status: (GithubStatusResponse & { dryRun?: boolean }) | null; onConnected: (repo: string) => void }) {
  const [url, setUrl] = useState(status?.repo ? `https://github.com/${status.repo}` : "");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const dryRun = status ? (status.dryRun ?? !status.configured) : false;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const m = url.trim().match(REPO_RE);
        if (!m) return setError("Use a GitHub repo URL like https://github.com/acme/storefront");
        setError(null);
        onConnected(`${m[1]}/${m[2]}`);
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-[0.85rem] text-white/55">Your storefront&apos;s repository. Darwin only ever changes it through pull requests you review.</p>
      <div className="flex gap-2">
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/acme/storefront" className={inputCls} />
        <Button type="submit" variant="primary" disabled={!url.trim()}>
          <Check /> Connect
        </Button>
      </div>
      {dryRun && <span className="text-[0.75rem] text-white/35">No GITHUB_TOKEN on the server: the PR runs as a dry run and shows the would-be changes.</span>}
      {error && <ErrorLine error={error} />}
    </form>
  );
}

function AgentBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-brand/25 bg-brand/[0.07]">
        <DarwinMark className="size-5" />
      </span>
      <div className="rounded-2xl rounded-tl-md border border-white/[0.08] bg-[#0b0d12]/85 px-4 py-3 text-[0.95rem] leading-relaxed text-white/70 backdrop-blur-sm">
        {children}
      </div>
    </div>
  );
}

