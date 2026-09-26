"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  FlaskConical,
  Gauge,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  MousePointerClick,
  ScanSearch,
  ShoppingCart,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { GithubStatusResponse } from "@/lib/contracts";
import type { PullRequestResult } from "@/lib/github";
import type { WhopConnection, WhopStatus } from "@/lib/whop";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/components/ui/cn";
import { DarwinMark, DarwinWordmark, GithubMark } from "@/components/console/brand";
import { PrBody } from "@/components/console/modals";

/* ------------------------------------------------------------------ data */

type Stage = "connect" | "analytics" | "dashboards";

const STAGES: { id: Stage; label: string }[] = [
  { id: "connect", label: "Connect" },
  { id: "analytics", label: "Collect" },
  { id: "dashboards", label: "Dashboards" },
];

interface Choice {
  id: string;
  icon: typeof Bot;
  title: string;
  body: string;
  /** Needs a live Whop connection to mean anything. */
  whop?: boolean;
}

const ANALYTICS: Choice[] = [
  { id: "human-funnel", icon: Users, title: "Human shopper funnel", body: "Views, add to bag, checkout and purchase per visitor." },
  { id: "agent-traffic", icon: Bot, title: "AI shopping agents", body: "MCP and A2A tool calls, negotiation, agent checkouts." },
  { id: "checkout", icon: ShoppingCart, title: "Checkout drop-off", body: "Where carts are abandoned, and by whom." },
  { id: "clicks", icon: MousePointerClick, title: "Clicks & scroll depth", body: "What people actually touch on each page." },
  { id: "experiments", icon: FlaskConical, title: "A/B test attribution", body: "Tag every event with its experiment and variant." },
  { id: "whop-revenue", icon: CircleDollarSign, title: "Whop sales & memberships", body: "Payments and members from your Whop business.", whop: true },
];

const DASHBOARDS: (Choice & { from: string[] })[] = [
  { id: "funnel", icon: ListChecks, title: "Conversion funnel", body: "Step-by-step funnel, humans and agents side by side.", from: ["human-funnel", "checkout"] },
  { id: "humans-vs-agents", icon: Bot, title: "Humans vs AI agents", body: "Who is shopping, and who converts better.", from: ["agent-traffic"] },
  { id: "experiments", icon: FlaskConical, title: "Live experiments", body: "Running A/B tests, win probability, shipped winners.", from: ["experiments"] },
  { id: "revenue", icon: CircleDollarSign, title: "Whop revenue", body: "Sales, members and churn from Whop.", from: ["whop-revenue"], whop: true },
  { id: "readiness", icon: Gauge, title: "Agent readiness", body: "How easily AI agents can shop your store.", from: ["agent-traffic"] },
  { id: "heatmap", icon: ScanSearch, title: "Page heatmap", body: "Clicks and scroll depth on every page.", from: ["clicks"] },
];

const PR_STEPS = ["Reading the repository", "Generating the analytics install", "Opening a pull request"];

const STORAGE_KEY = "darwin-onboarding";

async function http<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
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

const REPO_RE = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

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

  const [analytics, setAnalytics] = useState<string[]>(["human-funnel", "agent-traffic", "experiments"]);
  const [pr, setPr] = useState<PullRequestResult | null>(null);
  const [dashboards, setDashboards] = useState<string[]>([]);

  useEffect(() => {
    http<GithubStatusResponse>("GET", "/api/github/status").then(setGhStatus, () => {});
    http<WhopStatus>("GET", "/api/whop/status").then(setWhopStatus, () => {});
  }, []);

  const connected = !!repo && !!whop;
  const whopLive = whop?.mode === "live";

  const toAnalytics = () => {
    if (!connected) return;
    setOpen(null);
    setStage("analytics");
  };

  const toDashboards = () => {
    setDashboards(DASHBOARDS.filter((d) => d.from.some((f) => analytics.includes(f)) && (!d.whop || whopLive)).map((d) => d.id));
    setStage("dashboards");
  };

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ repo, whop: whop?.title, analytics, dashboards }));
    } catch {
      /* storage blocked: the console still works */
    }
    router.push("/console");
  };

  return (
    <main data-darwin-dark className="relative min-h-screen w-full overflow-clip bg-[#05060a] text-white">
      {/* Blurred mission control behind the composer */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/onboarding/dashboard-backdrop.jpg" alt="" className="size-full scale-105 object-cover object-top opacity-80 blur-[7px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(5,6,10,0.72),rgba(5,6,10,0.35)_75%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[52rem] flex-col px-4 sm:px-6">
        <nav className="flex h-20 shrink-0 items-center justify-between">
          <DarwinWordmark sub="Setup" />
          <Stepper stage={stage} />
        </nav>

        <div className="flex flex-1 flex-col justify-center pb-16">
          <AnimatePresence mode="wait">
            {stage === "connect" && (
              <motion.section key="connect" {...fade} className="flex flex-col gap-6">
                <header className="text-center">
                  <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.035em] sm:text-[2.6rem]">
                    Let&apos;s make your store <span className="text-brand">improve itself</span>
                  </h1>
                  <p className="mt-2 text-[0.95rem] text-white/50">Connect where you sell and where your code lives. Darwin does the rest as pull requests.</p>
                </header>

                <Panel glow={connected} className="overflow-visible">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        toAnalytics();
                      }
                    }}
                    rows={3}
                    placeholder="Tell Darwin about your store, e.g. “we sell running shoes and checkout feels slow on mobile”"
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
                            setOpen(whop ? null : "whop");
                          }}
                        />
                      </Drawer>
                    )}
                  </AnimatePresence>

                  {!connected && !open && (
                    <span className="flex items-center gap-1 px-5 pb-1 text-[0.75rem] font-medium text-brand/80">
                      <ArrowDown className="size-3.5 animate-bounce" /> Connect both to start
                    </span>
                  )}
                  <div className="flex items-end justify-between gap-3 px-4 pt-2 pb-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ConnectChip
                        icon={<WhopMark />}
                        label="Whop"
                        value={whop ? whop.title : undefined}
                        hint={whop?.mode === "offline" ? "demo" : undefined}
                        active={open === "whop"}
                        onClick={() => setOpen(open === "whop" ? null : "whop")}
                      />
                      <ConnectChip
                        icon={<GithubMark className="size-4" />}
                        label="GitHub"
                        value={repo ?? undefined}
                        active={open === "github"}
                        onClick={() => setOpen(open === "github" ? null : "github")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={toAnalytics}
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

            {stage === "analytics" && (
              <motion.section key="analytics" {...fade} className="flex flex-col gap-4">
                {prompt.trim() && (
                  <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md border border-white/10 bg-white/[0.06] px-4 py-3 text-[0.95rem] text-white/85">
                    {prompt.trim()}
                  </div>
                )}
                <AgentBubble>
                  Connected to <b className="text-white">{whop?.title}</b> on Whop and <b className="font-mono text-white">{repo}</b> on GitHub.
                  <br />
                  Darwin wants to open a pull request that installs analytics. <b className="text-white">What would you like to collect?</b>
                </AgentBubble>

                <Panel className="p-4">
                  <ChoiceGrid choices={ANALYTICS} selected={analytics} onChange={setAnalytics} disabled={!!pr} whopLive={whopLive} />
                </Panel>

                {!pr ? (
                  <InstallPr repo={repo!} disabled={analytics.length === 0} onDone={setPr} />
                ) : (
                  <>
                    <Panel glow className="p-5">
                      <PrBody pr={pr} />
                    </Panel>
                    <div className="flex justify-end">
                      <Button variant="primary" size="lg" onClick={toDashboards}>
                        Choose dashboards <ArrowRight />
                      </Button>
                    </div>
                  </>
                )}
              </motion.section>
            )}

            {stage === "dashboards" && (
              <motion.section key="dashboards" {...fade} className="flex flex-col gap-5">
                <header className="text-center">
                  <h1 className="text-[2rem] leading-tight font-semibold tracking-[-0.035em] sm:text-[2.4rem]">What dashboards would you like today?</h1>
                  <p className="mt-2 text-[0.95rem] text-white/50">Picked from what you chose to collect. Change them any time.</p>
                </header>
                <Panel className="p-4">
                  <ChoiceGrid choices={DASHBOARDS} selected={dashboards} onChange={setDashboards} whopLive={whopLive} />
                </Panel>
                <div className="flex items-center justify-between gap-3">
                  <Button variant="ghost" onClick={() => setStage("analytics")}>
                    Back
                  </Button>
                  <Button variant="primary" size="lg" disabled={dashboards.length === 0} onClick={finish}>
                    <LayoutDashboard /> Open mission control
                  </Button>
                </div>
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

function ChoiceGrid({
  choices,
  selected,
  onChange,
  disabled,
  whopLive,
}: {
  choices: Choice[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  whopLive: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {choices.map((c) => {
        const on = selected.includes(c.id);
        const Icon = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? selected.filter((s) => s !== c.id) : [...selected, c.id])}
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-default",
              on ? "border-brand/35 bg-brand/[0.06]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
            )}
          >
            <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-brand/15 text-brand" : "bg-white/[0.05] text-white/50")}>
              <Icon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[0.92rem] font-medium text-white/90">
                {c.title}
                {c.whop && !whopLive && <Badge tone="warn">needs live Whop</Badge>}
              </span>
              <span className="text-[0.8rem] leading-snug text-white/45">{c.body}</span>
            </span>
            <span className={cn("mt-1 grid size-4 shrink-0 place-items-center rounded-[0.3rem] border", on ? "border-brand bg-brand text-[#0b1200]" : "border-white/20")}>
              {on && <Check className="size-3" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function InstallPr({ repo, disabled, onDone }: { repo: string; disabled: boolean; onDone: (pr: PullRequestResult) => void }) {
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
      onDone(await http<PullRequestResult>("POST", "/api/github/connect", { repoUrl: `https://github.com/${repo}` }));
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
              {i < step ? (
                <Check className="size-4 text-brand" />
              ) : i === step ? (
                <LoaderCircle className="size-4 animate-spin text-brand" />
              ) : (
                <span className="size-4 rounded-full border border-white/15" />
              )}
              {s}
            </li>
          ))}
        </ol>
      )}
      {error && <ErrorLine error={error} />}
      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={run} disabled={busy || disabled}>
          {busy ? <LoaderCircle className="animate-spin" /> : <GitPullRequest />}
          Open pull request
        </Button>
      </div>
    </div>
  );
}
