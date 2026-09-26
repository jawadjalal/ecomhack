"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  FlaskConical,
  Flame,
  Gauge,
  GitPullRequest,
  Globe,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Radio,
  Smartphone,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { DashboardKind, DashboardsResponse, GithubStatusResponse, TrackingEvent, TrackingPlan, WebSimulateResponse } from "@/lib/contracts";
import type { PullRequestResult } from "@/lib/github";
import type { WhopConnection, WhopStatus } from "@/lib/whop";
import { cn } from "@/components/ui/cn";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { Mascot } from "@/components/dw/mascot";
import { Card, Empty, LiveDot, PillButton, Tag, Typing } from "@/components/dw/ui";
import { BrandGlyph, WhopLogo } from "@/components/dw/brand-logos";
import {
  AgentBubble,
  Backdrop,
  BrainChip,
  CheckPop,
  Drawer,
  EASE,
  ErrorLine,
  StageHead,
  StepList,
  Stepper,
  YouBubble,
  brainOf,
  inputCls,
  linkCls,
} from "@/components/dw/onboarding/bits";
import { AskChat, answerChips, composePrompt, type Answers } from "@/components/dw/onboarding/ask";
import { PrCard } from "@/components/dw/onboarding/pr-card";
import { RepoPicker } from "@/components/dw/onboarding/repo-picker";
import { clearProgress, loadProgress, saveProgress, type SavedProgress } from "@/components/dw/onboarding/persist";

/* ------------------------------------------------------------------ data */

/** connect → ask (Darwin's two questions) → plan → install → live. The stepper shows ask as part of Plan. */
type Stage = "connect" | "ask" | "plan" | "install" | "live";

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

const DRAFT_KEY = "darwin-onboarding-draft";

interface AuthSession {
  providers: { github: boolean };
  github?: { login: string; name?: string; avatarUrl?: string };
}

interface Message {
  from: "you" | "darwin";
  text: string;
  /** The merchant's answers, shown as chips in their bubble. */
  chips?: string[];
  pending?: boolean;
  /** Shown one by one while Darwin works. */
  steps?: string[];
}

const WIDTH: Record<Stage, string> = {
  connect: "max-w-[48rem]",
  ask: "max-w-[44rem]",
  plan: "max-w-[84rem]",
  install: "max-w-[72rem]",
  live: "max-w-[100rem]",
};

/* ------------------------------------------------------------------ app */

export function OnboardingApp() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("connect");
  const [prompt, setPrompt] = useState("");
  const [open, setOpen] = useState<"whop" | "github" | null>(null);

  const [ghStatus, setGhStatus] = useState<(GithubStatusResponse & { dryRun?: boolean }) | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  /** No GitHub: the store's address; darwin.js goes in with one script tag. */
  const [website, setWebsite] = useState<string | null>(null);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [whopStatus, setWhopStatus] = useState<WhopStatus | null>(null);
  const [whop, setWhop] = useState<WhopConnection | null>(null);
  /** Which brain Darwin plans with (GET /api/loop → designer). */
  const [designer, setDesigner] = useState<string | undefined>();
  const [answers, setAnswers] = useState<Answers | undefined>();

  const [plan, setPlan] = useState<TrackingPlan | null>(null);
  const [chat, setChat] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [pr, setPr] = useState<PullRequestResult | null>(null);

  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  /** Progress is only written after it has been read back, so a reload never overwrites it with blanks. */
  const [hydrated, setHydrated] = useState(false);
  /** Re-fetching the saved plan after a reload. */
  const [restoring, setRestoring] = useState(false);

  function restore(saved: SavedProgress) {
    setPrompt(saved.prompt);
    setAnswers(saved.answers);
    setRepo(saved.repo);
    setWebsite(saved.website);
    setWhop(saved.whop ? { ...saved.whop, products: [], notes: [] } : null);
    setSnippet(saved.snippet);
    setPr(saved.pr);
    setChat(saved.chat);
    const reconnected = !!saved.repo || !!saved.website;
    if (!reconnected || saved.stage === "connect") return setStage("connect");
    if (saved.stage === "ask") return setStage("ask");
    const ctx = { prompt: saved.prompt, repo: saved.repo, website: saved.website, whop: saved.whop?.title };
    // Plan, install or live: the plan is re-fetched so it's fresh. Gone server-side → plan again.
    const replan = () => (saved.answers ? void runPlan(saved.answers, ctx) : setStage("ask"));
    if (!saved.site) return replan();
    setStage(saved.stage);
    setRestoring(true);
    http<{ plan: TrackingPlan | null }>("GET", `/api/onboarding/plan?site=${encodeURIComponent(saved.site)}`)
      .then(
        (r) => {
          if (r.plan) setPlan(r.plan);
          else replan();
        },
        () => replan(),
      )
      .finally(() => setRestoring(false));
  }

  // Save progress on every change (this tab only).
  useEffect(() => {
    if (!hydrated) return;
    saveProgress({
      v: 1,
      stage,
      prompt,
      answers,
      repo,
      website,
      whop: whop ? { mode: whop.mode, title: whop.title, accountId: whop.accountId, connectedAt: whop.connectedAt } : null,
      site: plan?.site ?? null,
      snippet,
      pr,
      chat: chat.filter((m) => !m.pending).map(({ from, text, chips }) => ({ from, text, ...(chips ? { chips } : {}) })),
    });
  }, [hydrated, stage, prompt, answers, repo, website, whop, plan?.site, snippet, pr, chat]);

  const startOver = () => {
    clearProgress(DRAFT_KEY);
    setStage("connect");
    setPrompt("");
    setOpen(null);
    setRepo(null);
    setWebsite(null);
    setWhop(null);
    setAnswers(undefined);
    setPlan(null);
    setChat([]);
    setSnippet(null);
    setPr(null);
    track("onboarding_restarted");
  };

  const connected = !!repo || !!website;
  const brain = brainOf(designer);

  const reply = (text: string) => setChat((c) => [...c.filter((m) => !m.pending), { from: "darwin", text }]);

  /** Screen 1 → 2: connected, now Darwin asks. */
  const toAsk = () => {
    if (!connected) return;
    setOpen(null);
    setStage("ask");
    track("onboarding_connected", { whop: !!whop, described: !!prompt.trim(), via: website ? "script_tag" : "github" });
  };

  const toPlan = (a: Answers) => {
    if (!connected || busy) return;
    void runPlan(a, { prompt, repo, website, whop: whop?.title });
  };

  /** POST the plan. Takes its inputs explicitly so a restore can re-plan before state has settled. */
  async function runPlan(a: Answers, ctx: { prompt: string; repo: string | null; website: string | null; whop?: string }) {
    const full = composePrompt(ctx.prompt, a);
    setAnswers(a);
    setPlan(null);
    setStage("plan");
    setBusy(true);
    setChat([
      { from: "you", text: ctx.prompt.trim(), chips: answerChips(a) },
      {
        from: "darwin",
        text: "",
        pending: true,
        steps: [
          ...(ctx.website ? [`Setting up ${hostOf(ctx.website)} (no GitHub needed)`] : [`Reading ${ctx.repo}`, "Looking for analytics you already run"]),
          full ? "Planning from what you said" : "Planning a standard store setup",
          "Choosing your dashboards",
        ],
      },
    ]);
    track("questions_answered", { track: a.track.length + (a.note.trim() ? 1 : 0), where: a.where.join(",") });
    try {
      // Keep the steps on screen long enough to read, even when the plan comes back instantly.
      const [res] = await Promise.all([
        http<{ plan: TrackingPlan; reply: string; note?: string; snippet?: string }>("POST", "/api/onboarding/plan", {
          prompt: full || undefined,
          ...(ctx.website ? { siteUrl: ctx.website } : { repoUrl: `https://github.com/${ctx.repo}` }),
          whop: ctx.whop,
        }),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
      setPlan(res.plan);
      setSnippet(res.snippet ?? null);
      reply(res.note ? `${res.reply}\n\n${res.note}` : res.reply);
      track("plan_ready", { events: res.plan.events.filter((e) => e.enabled).length, goals: res.plan.goals?.length ?? 0 });
    } catch (err) {
      reply(`Something went wrong: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    http<GithubStatusResponse>("GET", "/api/github/status").then(setGhStatus, () => {});
    http<WhopStatus>("GET", "/api/whop/status").then(setWhopStatus, () => {});
    http<AuthSession>("GET", "/api/auth/session").then(setAuth, () => {});
    http<{ designer?: string }>("GET", "/api/loop").then((l) => setDesigner(l.designer ?? "heuristic"), () => {});
    const params = new URLSearchParams(window.location.search);
    const t = setTimeout(() => {
      // 1. Pick up where the merchant left off (a reload lands on the same stage).
      const saved = loadProgress();
      if (saved) restore(saved);
      // 2. Back from GitHub's sign-in: restore what was typed, and reopen the GitHub drawer on the repo picker.
      if (params.has("github") || params.has("github_error")) {
        try {
          const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as { prompt?: string };
          if (draft.prompt) setPrompt(draft.prompt);
        } catch {
          /* nothing saved */
        }
        setStage("connect");
        setAuthError(params.get("github_error"));
        setOpen("github");
        window.history.replaceState(null, "", window.location.pathname);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
    // Runs once on mount; restore() only calls setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const connectedTo = repo ?? (website ? hostOf(website) : "");

  return (
    <MotionConfig reducedMotion="user">
      <main data-dw className="relative min-h-screen w-full overflow-clip bg-dw-bg font-dw text-dw-ink">
        <Backdrop stage={stage} />

        <div className="relative flex min-h-screen w-full flex-col">
          {/* Screen 1 is the composer and nothing else; the nav arrives with the next step. */}
          <AnimatePresence>
            {stage !== "connect" && (
              <motion.nav
                key="nav"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="mx-auto grid w-full max-w-[1600px] grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 px-4 pt-5 sm:px-7 md:grid-cols-[1fr_auto_1fr]"
              >
                <Link href="/console" aria-label="Darwin console" className="flex items-center gap-2.5 justify-self-start rounded-full focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none">
                  <Mascot kind="analyst" size={32} active />
                  <span className="text-[22px] font-semibold tracking-[-0.02em]">darwin</span>
                </Link>
                <Stepper step={stage === "ask" ? "plan" : stage} className="col-span-2 justify-self-center max-md:order-last md:col-span-1" />
                <span className="flex h-10 max-w-[12rem] min-w-0 items-center gap-2 justify-self-end rounded-full bg-dw-sand px-3.5 text-[13.5px] font-medium sm:max-w-[18rem]" title={connectedTo}>
                  <LiveDot />
                  {website ? <Globe className="size-4 shrink-0" /> : <BrandGlyph brand="github" size={15} className="shrink-0" />}
                  <span className="truncate">{connectedTo}</span>
                  {whop && (
                    <span aria-hidden className="shrink-0">
                      <WhopLogo size={15} />
                    </span>
                  )}
                </span>
              </motion.nav>
            )}
          </AnimatePresence>

          <div className={cn("mx-auto flex w-full flex-1 flex-col px-4 pb-20 transition-[max-width] duration-500 sm:px-7", WIDTH[stage], stage === "connect" ? "justify-center py-10" : "pt-8 sm:pt-10")}>
            <AnimatePresence mode="wait">
              {stage === "connect" && (
                <motion.section key="connect" {...fade} className="flex flex-col items-center gap-8 sm:gap-10">
                  <h1 className="isolate text-center text-[34px] leading-[1.06] font-semibold tracking-[-0.03em] text-balance sm:text-[46px]">
                    Let&apos;s make your store{" "}
                    <span className="relative inline-block whitespace-nowrap">
                      <motion.span
                        aria-hidden
                        className="absolute inset-x-[-0.12em] bottom-[0.04em] -z-10 h-[0.42em] rounded-full bg-dw-yellow"
                        style={{ originX: 0 }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ delay: 0.35, duration: 0.7, ease: EASE }}
                      />
                      improve itself
                    </span>
                  </h1>

                  <div
                    className={cn(
                      "w-full rounded-[30px] border bg-dw-surface transition-[border-color,box-shadow] duration-500 focus-within:border-dw-ink/25",
                      connected
                        ? "border-dw-live/45 shadow-[0_0_0_5px_rgba(31,181,122,0.10),0_30px_70px_-34px_rgba(20,20,19,0.40)]"
                        : "border-dw-hairline shadow-[0_30px_70px_-34px_rgba(20,20,19,0.35)]",
                    )}
                  >
                    <div className="flex items-start gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
                      <motion.span key={connected ? "yes" : "no"} className="mt-0.5 inline-grid" animate={connected ? { y: [0, -12, 0, -4, 0], rotate: [0, -10, 6, 0, 0] } : undefined} transition={{ duration: 0.8 }}>
                        <Mascot kind="analyst" frame size={44} active title="Darwin" />
                      </motion.span>
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (connected) toAsk();
                            else setOpen("github");
                          }
                        }}
                        rows={3}
                        placeholder="What do you sell, and what worries you? e.g. “trail running shoes; checkout feels slow on mobile and people ask about sizing”"
                        aria-label="Tell Darwin about your store"
                        className="min-h-[5.6rem] w-full resize-none bg-transparent pt-2.5 text-[16.5px] leading-relaxed text-dw-ink outline-none placeholder:text-dw-ink/35"
                      />
                    </div>

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
                            current={repo}
                            status={ghStatus}
                            auth={auth}
                            authError={authError}
                            onSignIn={() => {
                              try {
                                sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt }));
                              } catch {
                                /* storage blocked: the prompt is retyped */
                              }
                              track("github_sign_in_started");
                              // A full-page navigation (not the router): the API route redirects to github.com.
                              window.location.assign(new URL("/api/auth/github/start?return=/onboarding", window.location.origin).href);
                            }}
                            onConnected={(r) => {
                              setRepo(r);
                              setWebsite(null);
                              setOpen(null);
                            }}
                            onWebsite={(url) => {
                              setWebsite(url);
                              setRepo(null);
                              setOpen(null);
                              track("script_tag_chosen");
                            }}
                          />
                        </Drawer>
                      )}
                    </AnimatePresence>

                    {!connected && !open && prompt.trim() && (
                      <p className="flex items-center gap-1.5 px-5 pt-1 text-[13px] text-dw-ink/60 sm:px-6">
                        <ArrowDown className="size-3.5 motion-safe:animate-bounce" /> Connect GitHub (or add one script tag) to continue. Whop is optional: it adds your payments.
                      </p>
                    )}
                    <div className="flex items-end justify-between gap-3 px-3 pt-3 pb-3 sm:px-4 sm:pb-4">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ConnectButton
                          icon={website ? <Globe className="size-[18px]" /> : <BrandGlyph brand="github" size={18} />}
                          label="Connect your GitHub"
                          value={repo ?? (website ? hostOf(website) : undefined)}
                          active={open === "github"}
                          onClick={() => setOpen(open === "github" ? null : "github")}
                        />
                        <ConnectButton
                          icon={<WhopLogo size={18} />}
                          label="Connect your Whop"
                          title="Optional: brings your Whop sales and refunds in"
                          value={whop ? whop.title : undefined}
                          hint={whop?.mode === "offline" ? "demo" : undefined}
                          active={open === "whop"}
                          onClick={() => setOpen(open === "whop" ? null : "whop")}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={toAsk}
                        disabled={!connected}
                        aria-label="Continue"
                        className="relative grid size-12 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-[opacity,transform,background-color] hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-dw-surface focus-visible:outline-none active:scale-95 disabled:opacity-25"
                      >
                        {connected && (
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 rounded-full bg-dw-ink"
                            initial={{ scale: 1, opacity: 0.35 }}
                            animate={{ scale: 1.6, opacity: 0 }}
                            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
                          />
                        )}
                        <ArrowUp className="relative size-5" />
                      </button>
                    </div>
                  </div>
                </motion.section>
              )}

              {stage === "ask" && (
                <motion.section key="ask" {...fade}>
                  <AskChat
                    prompt={prompt}
                    connectedTo={connectedTo}
                    whop={whop?.title}
                    brain={brain}
                    initial={answers}
                    onBack={() => setStage("connect")}
                    onDone={(a) => void toPlan(a)}
                  />
                </motion.section>
              )}

              {stage === "plan" && (
                <motion.section key="plan" {...fade} className="flex flex-col gap-7">
                  <StageHead
                    mascot={plan ? "designer" : "observer"}
                    title={plan ? "Here's what Darwin will record" : "Darwin is reading your store"}
                    lede={plan ? "Turn anything off, or tell Darwin what else to track." : "Checking what's there, then planning what to measure."}
                    right={<BrainChip brain={brain} />}
                  />
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)] lg:grid-rows-[auto_1fr] lg:gap-x-7">
                    <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
                      <Thread messages={chat.slice(0, 2)} />
                    </div>
                    <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                      <AnimatePresence mode="wait" initial={false}>
                        {plan ? (
                          <motion.div key="plan" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}>
                            <PlanCard plan={plan} onToggle={toggle} />
                          </motion.div>
                        ) : (
                          <motion.div key="skeleton" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}>
                            <PlanSkeleton />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:col-start-1 lg:row-start-2 lg:self-start">
                      <Thread messages={chat.slice(2)} />
                      {plan && (
                        <>
                          <Composer busy={busy} onSend={say} />
                          <div className="flex items-center justify-between gap-3 pt-1">
                            <PillButton tone="ghost" onClick={() => setStage("ask")}>
                              Back
                            </PillButton>
                            <PillButton
                              size="lg"
                              disabled={busy}
                              onClick={() => {
                                setStage("install");
                                track("plan_confirmed", { events: plan.events.filter((e) => e.enabled).length });
                              }}
                            >
                              Looks good: install it <ArrowRight />
                            </PillButton>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </motion.section>
              )}

              {stage === "install" && plan?.siteUrl && (
                <motion.section key="install" {...fade} className="flex flex-col gap-7">
                  <StageHead mascot="shipper" title="Add one line to your site" lede={`No pull request needed: darwin.js goes on ${hostOf(plan.siteUrl)} with one script tag.`} />
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                    <div className="flex min-w-0 flex-col gap-4">
                      <InstallSnippet
                        plan={plan}
                        snippet={snippet ?? `<script src="${window.location.origin}/darwin.js" data-darwin-site="${plan.site}" defer></script>`}
                        onDone={() => {
                          track("script_tag_installed");
                          setStage("live");
                        }}
                      />
                    </div>
                    <NextSteps
                      steps={[
                        "Paste the line into your site's <head>",
                        plan.events.some((e) => e.enabled && !e.automatic) ? "Add the one-line call for each event you send" : "Publish your site as usual",
                        "Shoppers and AI agents show up within seconds",
                      ]}
                    />
                  </div>
                </motion.section>
              )}

              {stage === "install" && plan && !plan.siteUrl && (
                <motion.section key="install" {...fade} className="flex flex-col gap-7">
                  <StageHead mascot="shipper" title="One pull request, and you're set" lede="Darwin only ever changes your code through pull requests you review." />
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                    <div className="flex min-w-0 flex-col gap-4">
                      <AgentBubble working={false}>
                        I&apos;ll open one pull request on <b className="font-dwmono font-medium text-dw-ink">{plan.repo}</b>: it loads darwin.js (under 5 KB) and commits your plan as{" "}
                        <code className="rounded-md bg-dw-sand px-1.5 py-0.5 font-dwmono text-[0.85em] text-dw-ink">DARWIN_TRACKING.md</code>, with the one line each event needs. Nothing
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
                          <PrCard pr={pr} />
                          <div className="flex justify-end">
                            <PillButton size="lg" onClick={() => setStage("live")}>
                              <Radio /> Start recording
                            </PillButton>
                          </div>
                        </>
                      )}
                    </div>
                    <NextSteps steps={["Review and merge the pull request", "Deploy as usual", "Shoppers and AI agents show up within seconds"]} />
                  </div>
                </motion.section>
              )}

              {restoring && !plan && (stage === "install" || stage === "live") && (
                <motion.section key="restoring" {...fade} className="flex flex-col items-center gap-4 py-24 text-center">
                  <Mascot kind="analyst" frame size={64} active />
                  <p className="text-[17px] text-dw-ink/70">Picking up where you left off…</p>
                </motion.section>
              )}

              {stage === "live" && plan && (
                <motion.section key="live" {...fade} className="flex flex-col gap-7">
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
            {hydrated && (stage !== "connect" || connected || !!whop) && (
              <div className={cn("flex justify-center", stage === "connect" ? "mt-5" : "mt-14")}>
                <button type="button" onClick={startOver} className="h-8 rounded-full px-3 text-[13px] text-dw-ink/50 transition-colors hover:bg-dw-sand hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none">
                  {stage === "connect" ? "Start over" : "Not the right store? Start over"}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </MotionConfig>
  );
}

const fade = {
  initial: { opacity: 0, y: 16, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -12, filter: "blur(4px)" },
  transition: { duration: 0.35, ease: EASE },
};

/* ------------------------------------------------------------------ plan stage */

function Thread({ messages }: { messages: Message[] }) {
  return (
    <>
      {messages.map((m, i) =>
        m.from === "you" ? (
          <YouBubble key={`you-${i}-${m.text}`} text={m.text} chips={m.chips} />
        ) : (
          <motion.div key={`darwin-${i}-${m.pending ? "pending" : m.text}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <AgentBubble working={!!m.pending}>{m.pending ? m.steps ? <Working steps={m.steps} /> : <Typing /> : <span className="whitespace-pre-line">{m.text}</span>}</AgentBubble>
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
  return <StepList steps={steps} current={i} reveal className="py-0.5" />;
}

function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = (t: string) => {
    if (!t.trim() || busy) return;
    onSend(t);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-center gap-2 rounded-full border border-dw-hairline bg-dw-surface py-1.5 pr-1.5 pl-2 shadow-[0_18px_40px_-26px_rgba(20,20,19,0.4)] focus-within:border-dw-ink/30"
      >
        <Mascot kind="analyst" size={30} active={busy} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anything else to track? Or something to leave out?"
          aria-label="Tell Darwin what to change in the plan"
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-dw-ink outline-none placeholder:text-dw-ink/35"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-[opacity,transform] hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink/40 focus-visible:outline-none active:scale-95 disabled:opacity-25"
        >
          {busy ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            disabled={busy}
            className="h-8 rounded-full bg-dw-sand px-3 text-[13px] text-dw-ink/70 transition-colors hover:bg-[#e4dccb] hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <Card tone="white" hover={false} className="p-6 sm:p-7" aria-busy="true" aria-label="Drafting your plan">
      <div className="flex items-center gap-4">
        <Mascot kind="designer" frame size={60} active />
        <div>
          <div className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Drafting your plan</div>
          <div className="mt-0.5 text-[14px] text-dw-ink/60">What to record, and the dashboards to build from it.</div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {[92, 70, 110, 84, 128].map((w, i) => (
          <motion.span key={i} className="h-9 rounded-full bg-dw-yellow/60" style={{ width: w }} animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }} />
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <motion.div key={i} className="h-[62px] rounded-[18px] bg-dw-sand" animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.3 + i * 0.12 }} />
        ))}
      </div>
    </Card>
  );
}

const DASH_ICON: Record<DashboardKind, ReactNode> = {
  kpis: <Gauge />,
  funnel: <ListChecks />,
  sources: <Globe />,
  "humans-agents": <Bot />,
  heatmap: <Flame />,
  experiments: <FlaskConical />,
  revenue: <TrendingUp />,
  events: <Sparkles />,
  devices: <Smartphone />,
};

function PlanCard({ plan, onToggle }: { plan: TrackingPlan; onToggle: (name: string, on: boolean) => void }) {
  const auto = plan.events.filter((e) => e.automatic && e.category !== "revenue");
  const custom = plan.events.filter((e) => !e.automatic);
  const revenue = plan.events.filter((e) => e.category === "revenue");
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-2" aria-label="What Darwin found">
        {plan.framework && <Fact label="Stack" value={plan.repoRead === false ? `${plan.framework} (assumed)` : plan.framework} />}
        <Fact
          label="Analytics"
          value={plan.siteUrl ? "not checked (no repo)" : plan.repoRead === false ? "not checked yet" : plan.existingAnalytics?.length ? plan.existingAnalytics.join(" · ") : "none found"}
          hint={plan.existingAnalytics?.some((a) => !a.startsWith("Darwin")) ? "darwin.js runs alongside" : undefined}
        />
        {!!plan.goals?.length && <Fact label="Heard" value={plan.goals.join(", ")} brand />}
        {plan.author.startsWith("llm:") && <Fact label="Planned by" value={plan.author.slice(4)} />}
      </div>

      <Card tone="yellow" shape="observer" corner="tr" className="p-5 sm:p-6">
        <SectionTitle title="Recorded automatically" hint="No code: darwin.js does it" />
        <div className="mt-4 flex flex-wrap gap-2">
          {auto.map((e) => (
            <button
              key={e.name}
              type="button"
              aria-pressed={e.enabled}
              title={e.why}
              onClick={() => onToggle(e.name, !e.enabled)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-[background-color,color,transform] focus-visible:ring-2 focus-visible:ring-dw-ink/40 focus-visible:outline-none active:scale-[0.97]",
                e.enabled ? "bg-dw-ink text-white" : "bg-white/45 text-dw-ink/45 line-through hover:bg-white/70",
              )}
            >
              {e.enabled && <MiniCheck />}
              {e.label}
            </button>
          ))}
        </div>
      </Card>

      <Card tone="white" hover={false} className="p-5 sm:p-6">
        <SectionTitle title="Your store sends" hint={plan.siteUrl ? "One line each, where it happens" : "One line each, listed in the PR"} />
        <ul className="mt-4 flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {custom.map((e) => (
              <EventRow key={e.name} e={e} onToggle={onToggle} />
            ))}
          </AnimatePresence>
        </ul>
      </Card>

      {revenue.length > 0 && (
        <Card tone="pink" shape="shipper" corner="br" hover={false} className="p-5 sm:p-6">
          <SectionTitle
            title={
              <span className="flex items-center gap-2">
                <span aria-hidden>
                  <WhopLogo size={20} />
                </span>
                From Whop
              </span>
            }
            hint="By webhook, no code"
          />
          <ul className="mt-4 flex flex-col gap-2">
            {revenue.map((e) => (
              <EventRow key={e.name} e={e} onToggle={onToggle} tone="pink" />
            ))}
          </ul>
        </Card>
      )}

      <Card tone="blue" shape="analyst" corner="br" className="p-5 sm:p-6">
        <SectionTitle title="Dashboards Darwin will build" hint="From what you record" />
        <div className="mt-4 flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {plan.dashboards.map((d) => (
              <motion.span
                key={d.id}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                title={d.why}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white/75 px-3.5 text-[14px] font-medium text-dw-ink shadow-[0_1px_0_rgba(20,20,19,0.05)] [&_svg]:size-4 [&_svg]:text-dw-ink/60"
              >
                {DASH_ICON[d.kind] ?? <LayoutDashboard />}
                {d.title}
                {d.custom && <Tag tone="ink" className="h-5 px-2 text-[11px]">you asked</Tag>}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </Card>
    </div>
  );
}

function MiniCheck() {
  return (
    <motion.svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 520, damping: 18 }}>
      <motion.path d="M3.6 8.4l2.9 2.9 5.9-6.4" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.08 }} />
    </motion.svg>
  );
}

function Fact({ label, value, hint, brand }: { label: string; value: string; hint?: string; brand?: boolean }) {
  return (
    <span className={cn("inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px]", brand ? "bg-dw-ink text-white" : "border border-dw-hairline bg-dw-surface")} title={hint}>
      <span className={brand ? "text-white/60" : "text-dw-ink/55"}>{label}</span>
      <span className="truncate font-medium">{value}</span>
    </span>
  );
}

function SectionTitle({ title, hint }: { title: ReactNode; hint: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</h2>
      <span className="text-[13px] text-dw-ink/65">{hint}</span>
    </div>
  );
}

function EventRow({ e, onToggle, tone = "sand" }: { e: TrackingEvent; onToggle: (name: string, on: boolean) => void; tone?: "sand" | "pink" }) {
  const [code, setCode] = useState(false);
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        "rounded-[18px] px-3.5 py-3 transition-[background-color,opacity]",
        tone === "pink" ? "bg-white/55" : e.fromPrompt && e.enabled ? "bg-dw-pink/45" : "bg-dw-sand/75",
        !e.enabled && "opacity-55",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={e.enabled}
          aria-label={`Record ${e.label}`}
          onClick={() => onToggle(e.name, !e.enabled)}
          className={cn(
            "mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-[7px] transition-colors focus-visible:ring-2 focus-visible:ring-dw-ink/40 focus-visible:ring-offset-1 focus-visible:outline-none",
            e.enabled ? "bg-dw-ink text-white" : "border-[1.5px] border-dw-ink/30 bg-white",
          )}
        >
          {e.enabled && <MiniCheck />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-medium">{e.label}</span>
            <code className="font-dwmono text-[12px] text-dw-ink/50">{e.name}</code>
            {e.fromPrompt && (
              <Tag tone="white" className="h-5 px-2 text-[11.5px]">
                <Sparkles className="size-3" /> from what you said
              </Tag>
            )}
          </div>
          <div className="mt-0.5 text-[13.5px] leading-snug text-dw-ink/65">{e.why}</div>
          <AnimatePresence initial={false}>
            {code && e.snippet && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 overflow-x-auto rounded-[14px] bg-dw-ink px-3.5 py-2.5 font-dwmono text-[12.5px] text-[#9EE6B8]"
              >
                {e.snippet}
              </motion.pre>
            )}
          </AnimatePresence>
        </div>
        {e.snippet && (
          <button
            type="button"
            onClick={() => setCode((c) => !c)}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 font-dwmono text-[12px] text-dw-ink/55 hover:bg-white/60 hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
            aria-expanded={code}
          >
            code <ChevronDown className={cn("size-3.5 transition-transform", code && "rotate-180")} />
          </button>
        )}
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ install */

function NextSteps({ steps }: { steps: string[] }) {
  return (
    <Card tone="olive" shape="shipper" corner="br" className="self-start p-5 sm:p-6">
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">What happens next</h2>
      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s} className="flex items-start gap-3 text-[15px] leading-snug">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-dw-ink text-[12px] font-semibold text-white">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

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
    <Card tone="white" hover={false} className="p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Mascot kind={busy ? "shipper" : "shipper"} frame size={48} active={busy} />
        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{busy ? "Opening your pull request" : "Ready when you are"}</h2>
          <p className="text-[14px] text-dw-ink/60">Three steps, a few seconds.</p>
        </div>
      </div>
      {busy ? (
        <StepList steps={PR_STEPS} current={step} className="mt-5" />
      ) : (
        <ol className="mt-5 flex flex-col gap-2">
          {PR_STEPS.map((s) => (
            <li key={s} className="flex min-h-7 items-center gap-2.5 text-[14.5px] text-dw-ink/55">
              <span className="grid size-7 place-items-center">
                <span className="size-[18px] rounded-full border-[1.5px] border-dashed border-dw-ink/25" />
              </span>
              {s}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <div className="mt-4">
          <ErrorLine error={error} />
        </div>
      )}
      <div className="mt-5 flex justify-end">
        <PillButton size="lg" onClick={run} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <GitPullRequest />}
          Open pull request
        </PillButton>
      </div>
    </Card>
  );
}

/** The install step without GitHub: copy one script tag, then start recording. */
function InstallSnippet({ plan, snippet, onDone }: { plan: TrackingPlan; snippet: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const custom = plan.events.filter((e) => e.enabled && !e.automatic).length;
  return (
    <>
      <AgentBubble working={false}>
        No pull request needed. Paste this one line into your site&apos;s <code className="rounded-md bg-dw-sand px-1.5 py-0.5 font-dwmono text-[0.85em] text-dw-ink">&lt;head&gt;</code> so it
        loads on every page
        {custom ? `, then add the one-line call for each of your ${custom} events where it happens (they're in the plan)` : ""}. darwin.js is under 5 KB and never reads form fields.
      </AgentBubble>
      <Card tone="white" hover={false} className="p-5 sm:p-6">
        <div className="relative overflow-hidden rounded-[18px] bg-dw-ink">
          <div className="flex items-center gap-1.5 border-b border-white/[0.08] px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="size-2.5 rounded-full bg-white/20" />
            <span className="ml-2 font-dwmono text-[12px] text-white/45">&lt;head&gt;</span>
          </div>
          <pre className="px-4 py-4 font-dwmono text-[13px] leading-relaxed break-all whitespace-pre-wrap text-[#9EE6B8]">{snippet}</pre>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1 basis-64 text-[13px] leading-snug text-dw-ink/60">
            Shopify: Online Store → Themes → Edit code → theme.liquid · Webflow: Site settings → Custom code → Head · WordPress: a header-scripts plugin
          </span>
          <PillButton
            tone={copied ? "white" : "sand"}
            onClick={() => {
              navigator.clipboard?.writeText(snippet).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? <CheckPop size={18} tone="live" burst /> : <Copy />} {copied ? "Copied" : "Copy"}
          </PillButton>
        </div>
      </Card>
      <div className="flex justify-end">
        <PillButton size="lg" onClick={onDone}>
          <Radio /> Start recording
        </PillButton>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ live */

const fmt = (v: number) => Math.round(v).toLocaleString("en-GB");

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
  const all = events.length > 0 && recorded === events.length;
  const firstRef = useRef(false);
  useEffect(() => {
    if (recorded > 0 && !firstRef.current) {
      firstRef.current = true;
      track("first_data", { site: plan.site });
    }
  }, [recorded, plan.site]);
  const real = data ? data.totalEvents - data.syntheticEvents : 0;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <LiveMascot celebrate={all} />
          <div className="min-w-0">
            <h1 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[46px]">Your dashboards are built</h1>
            <p className="mt-2 max-w-[48rem] text-[15.5px] leading-snug text-dw-ink/70 sm:text-[17px]">
              {plan.siteUrl ? "Publish the script tag" : "Merge the pull request and deploy"}: real shoppers show up here within seconds. Want to see it fill now? Send simulated shoppers (they&apos;re labelled, and never mixed into your real numbers).
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <PillButton tone="white" size="lg" onClick={simulate} disabled={sending}>
            {sending ? <LoaderCircle className="animate-spin" /> : <Bot />}
            Send 300 simulated shoppers
          </PillButton>
          <PillButton size="lg" onClick={onOpen}>
            <LayoutDashboard /> Open my dashboards
          </PillButton>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <Card tone="yellow" shape="experimenter" corner="br" hover={false} className="self-start p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Events</h2>
            <span className="num text-[13px] font-medium text-dw-ink/70">
              {recorded}/{events.length} recorded
            </span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-dw-ink/10" role="progressbar" aria-valuemin={0} aria-valuemax={events.length} aria-valuenow={recorded} aria-label="Events recorded">
            <motion.div className="h-full rounded-full bg-dw-ink" initial={{ width: 0 }} animate={{ width: `${events.length ? (recorded / events.length) * 100 : 0}%` }} transition={{ duration: 0.8, ease: EASE }} />
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-2 text-[13px] text-dw-ink/75">
            <LiveDot /> Recording <span className="truncate font-dwmono text-[12.5px]">{plan.site}</span>
          </div>
          <ul className="mt-3 flex flex-col">
            {events.map((e, i) => {
              const n = seen[e.name] ?? 0;
              return (
                <li key={e.name} className="flex items-center gap-2.5 border-t border-dw-ink/[0.07] py-2 text-[14px] first:border-t-0">
                  <span className="grid size-5 shrink-0 place-items-center">
                    {n > 0 ? <CheckPop size={18} burst delay={i * 0.05} /> : <span className="size-2 rounded-full bg-dw-ink/30 motion-safe:animate-pulse" />}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", n > 0 ? "font-medium text-dw-ink" : "text-dw-ink/55")}>{e.label}</span>
                  <span className="num font-dwmono text-[12.5px] text-dw-ink/65">{n > 0 ? <AnimatedNumber value={n} format={fmt} /> : "waiting"}</span>
                </li>
              );
            })}
          </ul>
          {real > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-[16px] bg-dw-win-bg px-3 py-2 text-[13px] text-dw-win">
              <Radio className="mt-0.5 size-3.5 shrink-0" /> Real visitors are arriving: {real.toLocaleString("en-GB")} real {real === 1 ? "event" : "events"} so far.
            </div>
          )}
          {!!data?.syntheticEvents && (
            <div className="mt-3 rounded-[16px] bg-dw-warn-bg px-3 py-2 text-[13px] text-dw-warn">
              {data.syntheticEvents.toLocaleString("en-GB")} of {data.totalEvents.toLocaleString("en-GB")} events are simulated{sent ? ` (${sent} shoppers sent)` : ""}.
            </div>
          )}
          <Link
            href={`/console/personalize?site=${encodeURIComponent(plan.site)}`}
            className="mt-4 flex items-center gap-1 rounded text-[13.5px] font-medium text-dw-ink/70 hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
          >
            Personalize pages by traffic source <ChevronRight className="size-3.5" />
          </Link>
        </Card>
        <div className="min-w-0 rounded-[28px] bg-dw-sand/55 p-2.5 sm:p-3">
          {data?.dashboards.length ? (
            <DashboardGrid dashboards={data.dashboards} compact />
          ) : (
            <Empty mascot={<Mascot kind="experimenter" frame size={64} active />}>{data ? "Your dashboards appear here as soon as the first events arrive." : "Building your dashboards…"}</Empty>
          )}
        </div>
      </div>
    </>
  );
}

/** The experimenter bobs while Darwin listens, and hops when every event has arrived. */
function LiveMascot({ celebrate }: { celebrate: boolean }) {
  return (
    <motion.span
      key={celebrate ? "all" : "some"}
      className="inline-grid shrink-0"
      animate={celebrate ? { y: [0, -18, 0, -8, 0], rotate: [0, -12, 8, -3, 0] } : undefined}
      transition={{ duration: 0.9, ease: "easeOut" }}
    >
      <Mascot kind="experimenter" frame size={64} active />
    </motion.span>
  );
}

/* ------------------------------------------------------------------ connect pieces */

function ConnectButton({
  icon,
  label,
  value,
  hint,
  title,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  hint?: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  const done = !!value;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      title={title}
      className={cn(
        "flex h-10 max-w-[16rem] items-center gap-2 rounded-full pr-3.5 pl-3 text-[14px] font-medium transition-[background-color,color,transform,box-shadow] focus-visible:ring-2 focus-visible:ring-dw-ink/35 focus-visible:outline-none active:scale-[0.97] sm:max-w-[19rem]",
        active ? "bg-dw-ink text-white" : done ? "bg-dw-win-bg text-dw-ink hover:bg-[#cfeedd]" : "bg-dw-sand text-dw-ink hover:bg-[#e4dccb]",
      )}
    >
      <span aria-hidden className="grid size-5 shrink-0 place-items-center">
        {icon}
      </span>
      <span className="truncate">{done ? value : label}</span>
      {hint && <span className={active ? "text-white/60" : "text-dw-ink/50"}>({hint})</span>}
      {done && <CheckPop size={18} tone="live" burst />}
    </button>
  );
}

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
      <p className="text-[14px] leading-snug text-dw-ink/70">
        Paste a Whop API key (Developer → API keys). It stays on the server. Same key the Whop CLI uses:{" "}
        <code className="rounded-md bg-white px-1.5 py-0.5 font-dwmono text-[12.5px] text-dw-ink">whop login --method api-key</code>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input ref={input} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="whop_…" autoComplete="off" aria-label="Whop API key" className={inputCls} />
        <PillButton type="submit" disabled={busy} className="h-11">
          {busy ? <LoaderCircle className="animate-spin" /> : <WhopMarkInline />}
          {key.trim() ? "Connect" : status?.configured ? "Use server key" : "Try demo"}
        </PillButton>
      </div>
      {!key.trim() && !status?.configured && <span className="text-[12.5px] text-dw-ink/50">No key and no WHOP_API_KEY on the server: connects a labelled demo business.</span>}
      {error && <ErrorLine error={error} />}
    </form>
  );
}

function WhopMarkInline() {
  return (
    <span aria-hidden className="grid size-4 place-items-center">
      <WhopLogo size={16} />
    </span>
  );
}

function GithubConnect({
  current,
  status,
  auth,
  authError,
  onSignIn,
  onConnected,
  onWebsite,
}: {
  current: string | null;
  status: (GithubStatusResponse & { dryRun?: boolean }) | null;
  auth: AuthSession | null;
  authError: string | null;
  onSignIn: () => void;
  onConnected: (repo: string) => void;
  onWebsite: (url: string) => void;
}) {
  const [url, setUrl] = useState(status?.repo ? `https://github.com/${status.repo}` : "");
  const [error, setError] = useState<string | null>(authError);
  const [paste, setPaste] = useState(false);
  const [noGithub, setNoGithub] = useState(false);
  /** The repos API said 401: the sign-in expired, so offer it again. */
  const [expired, setExpired] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const signedIn = !!auth?.github && !expired;
  const oauth = !!auth?.providers.github;
  const onUnauthorized = useCallback(() => setExpired(true), []);

  useEffect(() => input.current?.focus(), [paste, signedIn]);

  const dryRun = !signedIn && (status ? (status.dryRun ?? !status.configured) : false);

  if (noGithub) return <WebsiteConnect onWebsite={onWebsite} onGithub={() => setNoGithub(false)} />;
  const other = <NoGithub onChoose={() => setNoGithub(true)} />;

  // 1. Not signed in, and sign-in is available: the button is the main path.
  if (oauth && !signedIn && !paste) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-snug text-dw-ink/70">
          {expired ? "Your GitHub sign-in has expired. Sign in again to pick your repository." : "Sign in so Darwin can see your repositories and open the install pull request as you. It only ever changes code through pull requests you review."}
        </p>
        <PillButton size="lg" onClick={onSignIn} className="w-full">
          <BrandGlyph brand="github" size={18} /> Sign in with GitHub
        </PillButton>
        <button type="button" onClick={() => setPaste(true)} className={linkCls}>
          or paste a repository URL
        </button>
        {error && <ErrorLine error={error} />}
        {other}
      </div>
    );
  }

  // 2. Signed in: pick one of your repositories from the dropdown.
  if (signedIn && !paste) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[14px] text-dw-ink/70">
          {auth!.github!.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={auth!.github!.avatarUrl} alt="" className="size-7 rounded-full ring-2 ring-white" />
          )}
          <span className="min-w-0 flex-1">
            Signed in as <b className="font-semibold text-dw-ink">{auth!.github!.login}</b>. Which repository is your store?
          </span>
          <button
            type="button"
            onClick={() => {
              fetch("/api/auth/logout", { method: "POST" }).finally(() => window.location.reload());
            }}
            className="h-8 rounded-full px-3 text-[13px] font-medium text-dw-ink/60 transition-colors hover:bg-white hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
          >
            Sign out
          </button>
        </div>
        <RepoPicker login={auth!.github!.login} selected={current} onPick={onConnected} onUnauthorized={onUnauthorized} />
        <button type="button" onClick={() => setPaste(true)} className={linkCls}>
          or paste a repository URL
        </button>
        {error && <ErrorLine error={error} />}
        {other}
      </div>
    );
  }

  // 3. Paste a URL (no sign-in configured, or chosen).
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
      <p className="text-[14px] leading-snug text-dw-ink/70">Your storefront&apos;s repository. Darwin only ever changes it through pull requests you review.</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/acme/storefront" aria-label="Repository URL" className={inputCls} />
        <PillButton type="submit" disabled={!url.trim()} className="h-11">
          <BrandGlyph brand="github" size={16} /> Connect
        </PillButton>
      </div>
      {oauth && (
        <button type="button" onClick={() => (signedIn ? setPaste(false) : onSignIn())} className={linkCls}>
          {signedIn ? "or pick from your repositories" : "or sign in with GitHub"}
        </button>
      )}
      {dryRun && <span className="text-[12.5px] text-dw-ink/50">No GitHub access on the server: the PR runs as a preview and shows the would-be changes.</span>}
      {error && <ErrorLine error={error} />}
      {other}
    </form>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** The ways in that don't need GitHub. */
function NoGithub({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-dw-ink/[0.08] pt-3 text-[13.5px] leading-snug text-dw-ink/65">
      <span>
        No GitHub?{" "}
        <button type="button" onClick={onChoose} className="rounded font-semibold text-dw-ink underline decoration-dw-ink/30 underline-offset-[3px] hover:decoration-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none">
          Add one script tag instead
        </button>{" "}
        (Shopify, Webflow, WordPress, any site you can edit).
      </span>
      <span>
        Only sell on Whop?{" "}
        <Link href="/console/agents" className="rounded font-semibold text-dw-ink underline decoration-dw-ink/30 underline-offset-[3px] hover:decoration-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none">
          Your store agent needs no code
        </Link>
        : AI shoppers buy your Whop plans through it.
      </span>
    </div>
  );
}

/** No GitHub: the store's address; darwin.js is installed with one script tag after the plan. */
function WebsiteConnect({ onWebsite, onGithub }: { onWebsite: (url: string) => void; onGithub: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const raw = url.trim();
        const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        try {
          const u = new URL(full);
          if (!u.hostname.includes(".")) throw new Error();
          setError(null);
          onWebsite(u.origin);
        } catch {
          setError("Use your store's address, like https://shop.example.com");
        }
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-[14px] leading-snug text-dw-ink/70">
        Your store&apos;s address. After the plan, Darwin gives you one line to paste into your site&apos;s <code className="rounded-md bg-white px-1.5 py-0.5 font-dwmono text-[12.5px] text-dw-ink">&lt;head&gt;</code>: no GitHub, no pull request.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example.com" aria-label="Your store's address" className={inputCls} />
        <PillButton type="submit" disabled={!url.trim()} className="h-11">
          <Globe /> Continue
        </PillButton>
      </div>
      <button type="button" onClick={onGithub} className={linkCls}>
        or connect GitHub instead
      </button>
      {error && <ErrorLine error={error} />}
    </form>
  );
}
