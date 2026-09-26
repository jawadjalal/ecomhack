"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
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
  TriangleAlert,
  X,
} from "lucide-react";
import type { DashboardKind, DashboardsResponse, GithubStatusResponse, TrackingEvent, TrackingPlan, WebSimulateResponse } from "@/lib/contracts";
import type { PullRequestResult } from "@/lib/github";
import type { VerifyResult } from "@/lib/tracking/verify";
import type { WhopConnection, WhopStatus } from "@/lib/whop";
import { cn } from "@/components/ui/cn";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { Mascot } from "@/components/dw/mascot";
import { Card, LiveDot, PillButton, Tag, Typing } from "@/components/dw/ui";
import { BrandGlyph, WhopLogo } from "@/components/dw/brand-logos";
import { Art } from "@/components/dw/art";
import { Gel, GelLink } from "@/components/dw/gel";
import { Sticker } from "@/components/dw/sticker";
import {
  AgentBubble,
  CheckPop,
  Drawer,
  EASE,
  ErrorLine,
  StageHead,
  StepList,
  StageArt,
  Stepper,
  YouBubble,
  inputCls,
  linkCls,
  useIsPhone,
} from "@/components/dw/onboarding/bits";
import { AskChat, answerChips, composePrompt, type Answers } from "@/components/dw/onboarding/ask";
import { PrCard } from "@/components/dw/onboarding/pr-card";
import { RepoPicker } from "@/components/dw/onboarding/repo-picker";
import { clearProgress, loadProgress, saveProgress, stageIndex, type SavedAccount, type SavedProgress, type SavedStage } from "@/components/dw/onboarding/persist";
import { recallPlan, rememberPlan, rememberSimulated, rememberSite } from "@/lib/tracking/remember";

/* ------------------------------------------------------------------ data */

/** connect → ask (Darwin's two questions) → plan → install → live. The stepper shows ask as part of Plan. */
type Stage = "connect" | "ask" | "plan" | "install" | "live";

const PR_STEPS = ["Reading the repository", "Adding darwin.js and your tracking plan", "Opening a pull request"];

const SUGGESTIONS = ["Also track wishlist adds", "Don't track rage clicks", "Track coupon codes"];

/** Screen 1's starters: one tap writes a first message the merchant can edit. */
const EXAMPLES = [
  { label: "Running shoes", text: "Trail running shoes. Checkout feels slow on mobile and people keep asking about sizing." },
  { label: "Candles", text: "Handmade candles. Lots of people add to cart, then leave." },
  { label: "Courses on Whop", text: "Online courses sold on Whop. Can AI shopping agents buy them?" },
];

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
  const w = window as unknown as {
    darwin?: { capture?: (e: string, p: object) => void } | unknown[];
  };
  if (w.darwin && !Array.isArray(w.darwin) && w.darwin.capture) w.darwin.capture(event, props);
  else ((w.darwin as unknown[] | undefined) ?? ((w as { darwin?: unknown[] }).darwin = [])).push([event, props]);
}

/** GitHub OAuth start: same tab, back to /onboarding. Only shown when the server has sign-in configured. */
const GITHUB_SIGN_IN = "/api/auth/github/start?return=/onboarding";

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
  /** What's typed in "Paste your store URL" before it becomes the chip. */
  const [urlDraft, setUrlDraft] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const continueBtn = useRef<HTMLButtonElement>(null);
  const [snippet, setSnippet] = useState<string | null>(null);
  const [whopStatus, setWhopStatus] = useState<WhopStatus | null>(null);
  const [whop, setWhop] = useState<WhopConnection | null>(null);
  const [answers, setAnswers] = useState<Answers | undefined>();

  const [plan, setPlan] = useState<TrackingPlan | null>(null);
  const [chat, setChat] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [pr, setPr] = useState<PullRequestResult | null>(null);
  /** "Save your setup": the email and the link back from any device (POST /api/account). Nothing is emailed. */
  const [account, setAccount] = useState<SavedAccount | null>(null);

  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  /** Progress is only written after it has been read back, so a reload never overwrites it with blanks. */
  const [hydrated, setHydrated] = useState(false);
  /** Re-fetching the saved plan after a reload. */
  const [restoring, setRestoring] = useState(false);

  /** The furthest stage reached: a revisit resumes there, and going back to edit answers keeps it. */
  const [furthest, setFurthest] = useState<SavedStage>("connect");
  /** The site id being restored (kept in the saved progress while its plan loads). */
  const [savedSite, setSavedSite] = useState<string | null>(null);
  /** A revisit after going live: "Welcome back" instead of silently restarting. */
  const [welcome, setWelcome] = useState<{ site: string; host: string; stage: SavedStage } | null>(null);

  function restore(saved: SavedProgress) {
    setPrompt(saved.prompt);
    setAnswers(saved.answers);
    setRepo(saved.repo);
    setWebsite(saved.website);
    setWhop(saved.whop ? { ...saved.whop, products: [], notes: [] } : null);
    setSnippet(saved.snippet);
    setPr(saved.pr);
    setChat(saved.chat);
    setAccount(saved.account ?? null);
    setFurthest(saved.furthest ?? saved.stage);
    const reconnected = !!saved.repo || !!saved.website;
    if (!reconnected || saved.stage === "connect") return setStage("connect");
    if (saved.stage === "ask" || !saved.site) {
      // No plan yet: back to the questions (answers kept); nothing is regenerated behind the merchant's back.
      return setStage("ask");
    }
    const site = saved.site;
    setSavedSite(site);
    const live = saved.stage === "live" || saved.furthest === "live";
    // Already live: screen 1 greets them with their dashboards (the saved progress is left as it was).
    if (live) setWelcome({ site, host: saved.website ? hostOf(saved.website) : (saved.repo ?? site), stage: saved.stage });
    setStage(live ? "connect" : saved.stage);
    // 1. The browser's copy: instant, and never regenerated.
    const local = recallPlan(site);
    if (local) setPlan(local);
    else setRestoring(true);
    // 2. Make sure this server instance has it too (the server's copy wins if it has one).
    const sync = local
      ? http<{ plan: TrackingPlan }>("POST", "/api/onboarding/restore", { plan: local })
      : http<{ plan: TrackingPlan | null }>("GET", `/api/onboarding/plan?site=${encodeURIComponent(site)}`);
    sync
      .then(
        (r) => {
          if (r.plan) setPlan(r.plan);
          else if (!local) setStage("ask");
        },
        () => {
          if (!local) setStage("ask");
        },
      )
      .finally(() => setRestoring(false));
  }

  // Keep the browser's copy of the plan and the store (lib/tracking/remember): revisits and the console
  // (/console/dashboards on another server instance) restore from it.
  useEffect(() => {
    if (!plan) return;
    rememberPlan(plan);
    rememberSite(plan.site, plan.siteUrl ?? undefined);
  }, [plan]);

  // Track the furthest stage as the stage moves (adjusting state during render, not in an effect).
  const [seenStage, setSeenStage] = useState<Stage>(stage);
  if (seenStage !== stage) {
    setSeenStage(stage);
    if (stageIndex(stage) > stageIndex(furthest)) setFurthest(stage);
  }

  // Save progress on every change (localStorage: survives closing the tab). Not while "Welcome back" shows.
  useEffect(() => {
    if (!hydrated || welcome) return;
    saveProgress({
      v: 2,
      stage,
      furthest: stageIndex(stage) > stageIndex(furthest) ? stage : furthest,
      prompt,
      answers,
      repo,
      website,
      whop: whop
        ? {
            mode: whop.mode,
            title: whop.title,
            accountId: whop.accountId,
            connectedAt: whop.connectedAt,
          }
        : null,
      site: plan?.site ?? savedSite,
      snippet,
      pr,
      account,
      chat: chat
        .filter((m) => !m.pending)
        .map(({ from, text, chips }) => ({
          from,
          text,
          ...(chips ? { chips } : {}),
        })),
    });
  }, [hydrated, welcome, stage, furthest, prompt, answers, repo, website, whop, plan?.site, savedSite, snippet, pr, account, chat]);

  const startOver = () => {
    clearProgress(DRAFT_KEY);
    setWelcome(null);
    setSavedSite(null);
    setFurthest("connect");
    setUrlDraft("");
    setUrlError(null);
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
    setAccount(null);
    track("onboarding_restarted");
  };

  /** A valid address typed but not yet added still counts: Continue adds it. */
  const draftSite = website || repo ? null : storeOrigin(urlDraft);
  const connected = !!repo || !!website || !!draftSite;

  /** "Paste your store URL" → the chip (Enter or Add). The script-tag path: no GitHub needed. */
  const addUrl = (focusNext = true) => {
    const origin = storeOrigin(urlDraft);
    if (!origin) {
      setUrlError(urlDraft.trim() ? `“${urlDraft.trim().slice(0, 40)}” isn't a web address yet. Try shop.example.com` : "Paste your store's address, like shop.example.com");
      return null;
    }
    setWebsite(origin);
    setRepo(null);
    setUrlDraft("");
    setUrlError(null);
    setOpen((o) => (o === "github" ? null : o));
    track("script_tag_chosen");
    if (focusNext) setTimeout(() => continueBtn.current?.focus(), 50);
    return origin;
  };

  // Every step starts at its top (on a phone the last step can leave you deep in a long page).
  const firstStage = useRef(true);
  useEffect(() => {
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
  }, [stage]);

  const reply = (text: string) => setChat((c) => [...c.filter((m) => !m.pending), { from: "darwin", text }]);

  /** Screen 1 → 2: connected, now Darwin asks. */
  const toAsk = () => {
    if (!connected) return;
    if (draftSite) addUrl(false);
    setOpen(null);
    setStage("ask");
    track("onboarding_connected", {
      whop: !!whop,
      described: !!prompt.trim(),
      via: website || draftSite ? "script_tag" : "github",
    });
  };

  const toPlan = (a: Answers) => {
    if (!connected || busy) return;
    void runPlan(a, { prompt, repo, website, whop: whop?.title });
  };

  /** POST the plan. Takes its inputs explicitly so a restore can re-plan before state has settled. */
  async function runPlan(
    a: Answers,
    ctx: {
      prompt: string;
      repo: string | null;
      website: string | null;
      whop?: string;
    },
  ) {
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
    track("questions_answered", {
      track: a.track.length + (a.note.trim() ? 1 : 0),
      where: a.where.join(","),
    });
    try {
      // Keep the steps on screen long enough to read, even when the plan comes back instantly.
      const [res] = await Promise.all([
        http<{
          plan: TrackingPlan;
          reply: string;
          note?: string;
          snippet?: string;
        }>("POST", "/api/onboarding/plan", {
          prompt: full || undefined,
          // Part of the server's cache key: the same store, words and answers get the same plan back.
          answers: { track: a.track, where: a.where, ...(a.note.trim() ? { note: a.note.trim() } : {}) },
          ...(ctx.website ? { siteUrl: ctx.website } : { repoUrl: `https://github.com/${ctx.repo}` }),
          whop: ctx.whop,
        }),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
      setPlan(res.plan);
      setSnippet(res.snippet ?? null);
      reply(res.note ? `${res.reply}\n\n${res.note}` : res.reply);
      track("plan_ready", {
        events: res.plan.events.filter((e) => e.enabled).length,
        goals: res.plan.goals?.length ?? 0,
      });
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
    const params = new URLSearchParams(window.location.search);
    const t = setTimeout(() => {
      // 1. Pick up where the merchant left off (a reload lands on the same stage).
      const saved = loadProgress();
      if (saved) restore(saved);
      // 2. Back from GitHub's sign-in: restore what was typed, and reopen the GitHub drawer on the repo picker.
      if (params.has("github") || params.has("github_error")) {
        try {
          const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as { prompt?: string; url?: string };
          if (draft.prompt) setPrompt(draft.prompt);
          if (draft.url) setUrlDraft(draft.url);
        } catch {
          /* nothing saved */
        }
        setWelcome(null);
        setStage("connect");
        setAuthError(params.get("github_error"));
        setOpen("github");
        window.history.replaceState(null, "", window.location.pathname);
      }
      setHydrated(true);
    }, 0);
    return () => clearTimeout(t);
    // Runs once on mount; restore() only calls setters.
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
    setPlan({
      ...plan,
      events: plan.events.map((e) => (e.name === name ? { ...e, enabled: on } : e)),
    });
    try {
      const res = await http<{ plan: TrackingPlan }>("PUT", "/api/onboarding/plan", { site: plan.site, enabled: { [name]: on } });
      setPlan(res.plan);
      track("plan_changed", { via: "toggle" });
    } catch {
      /* keep the optimistic state; the next change re-syncs */
    }
  };

  const connectedTo = repo ?? (website ? hostOf(website) : "");
  const canStartOver = hydrated && (stage !== "connect" || connected || !!whop);

  return (
    <MotionConfig reducedMotion="user">
      <main data-dw className="relative min-h-[100svh] w-full overflow-clip bg-dw-bg font-dw text-dw-ink">
        <StageArt stage={stage} />

        <div className="relative flex min-h-[100svh] w-full flex-col">
          {/* Screen 1 is the composer on its painting and nothing else; the nav arrives with the next step. */}
          <AnimatePresence>
            {stage !== "connect" && (
              <motion.nav
                key="nav"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="mx-auto grid w-full max-w-[1600px] grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 px-4 pt-4 sm:px-7 sm:pt-5 md:grid-cols-[1fr_auto_1fr]"
              >
                <Link
                  href="/console"
                  aria-label="Darwin console"
                  className="flex h-11 items-center gap-2 justify-self-start rounded-full bg-dw-bg pr-4 pl-1.5 focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
                >
                  <Mascot kind="analyst" size={32} active />
                  <span className="text-[20px] font-semibold tracking-[-0.02em]">darwin</span>
                </Link>
                <Stepper step={stage === "ask" ? "plan" : stage} className="col-span-2 justify-self-center max-md:order-last max-sm:hidden md:col-span-1" />
                <span
                  className="flex h-10 max-w-[12rem] min-w-0 items-center gap-2 justify-self-end rounded-full bg-dw-bg px-3.5 text-[13.5px] font-medium sm:max-w-[18rem]"
                  title={connectedTo}
                >
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

          {/* After screen 1 the stage is a cream sheet rising over the painting. */}
          <div className={cn("relative flex w-full flex-1 flex-col", stage !== "connect" && "mt-16 rounded-t-[30px] bg-dw-bg sm:mt-32 sm:rounded-t-[44px]")}>
            <div
              className={cn(
                "mx-auto flex w-full flex-1 flex-col px-4 pb-20 transition-[max-width] duration-500 sm:px-7",
                WIDTH[stage],
                stage === "connect" ? "justify-center py-10 max-sm:justify-start max-sm:py-0" : "pt-5 sm:pt-10",
              )}
            >
              {stage !== "connect" && <Stepper variant="bar" step={stage === "ask" ? "plan" : stage} className="mb-6 sm:hidden" />}
              <AnimatePresence mode="wait">
                {stage === "connect" && (
                  <motion.section key="connect" {...fade} className="flex flex-col items-center gap-8 max-sm:flex-1 max-sm:items-stretch max-sm:gap-0 sm:gap-9">
                    {/* phones: a slim bar on the painting */}
                    <div className="flex h-14 items-center justify-between sm:hidden">
                      <Link href="/" aria-label="Darwin home" className="flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none">
                        <Mascot kind="analyst" size={30} active />
                        <span className="text-[20px] font-semibold tracking-[-0.02em] text-white [text-shadow:0_1px_3px_rgba(20,20,19,0.35)]">darwin</span>
                      </Link>
                      {canStartOver && !welcome && <StartOver onConfirm={startOver} label="Start over" onPainting />}
                    </div>

                    <h1 className="isolate text-center text-[34px] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-white [text-shadow:0_2px_14px_rgba(20,40,60,0.35)] max-sm:mt-[7svh] max-sm:text-left max-sm:text-[40px] max-sm:leading-[1.02] sm:text-[52px]">
                      Let&apos;s make your store{" "}
                      <span className="relative inline-block whitespace-nowrap text-dw-ink [text-shadow:none]">
                        <motion.span
                          aria-hidden
                          className="absolute inset-x-[-0.1em] inset-y-[0.04em] -z-10 rounded-[0.16em] bg-dw-yellow"
                          style={{ originX: 0 }}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ delay: 0.35, duration: 0.7, ease: EASE }}
                        />
                        improve itself
                      </span>
                    </h1>
                    <p className="mt-3 text-[17px] leading-snug text-white [text-shadow:0_1px_8px_rgba(20,40,60,0.45)] sm:hidden">Tell Darwin what you sell and what worries you.</p>

                    {welcome ? (
                      <WelcomeBack
                        host={welcome.host}
                        site={welcome.site}
                        onContinue={() => {
                          const back = welcome.stage;
                          setWelcome(null);
                          setStage(back);
                          track("onboarding_resumed", { stage: back });
                        }}
                        onAnother={() => {
                          track("onboarding_another_store");
                          startOver();
                        }}
                      />
                    ) : (
                      <>
                    {/* starters: one tap writes a first message */}
                    {!prompt.trim() && (
                      <div className="flex flex-wrap items-center gap-2 max-sm:mt-5 sm:order-last sm:justify-center" aria-label="Examples">
                        <span className="text-[13.5px] font-medium text-white [text-shadow:0_1px_6px_rgba(20,40,60,0.5)] max-sm:sr-only">Try</span>
                        {EXAMPLES.map((x) => (
                          <button
                            key={x.label}
                            type="button"
                            onClick={() => setPrompt(x.text)}
                            className="h-9 rounded-full bg-dw-bg/95 px-3.5 text-[14px] font-medium text-dw-ink transition-[transform,background-color] hover:bg-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none active:scale-[0.97]"
                          >
                            {x.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* no store yet: the demo store is one quiet link away */}
                    <Link
                      href="/console"
                      onClick={() => track("onboarding_skipped_to_demo")}
                      className="order-last rounded-full px-2 py-1 text-[13.5px] sm:-mt-5 font-medium text-white underline decoration-white/50 underline-offset-[3px] [text-shadow:0_1px_6px_rgba(20,40,60,0.55)] hover:decoration-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none max-sm:hidden"
                    >
                      Skip, explore with the demo store
                    </Link>

                    {/*
                      The composer. One DOM for both layouts (the textarea stays one element):
                      computer: a crisp beveled card, field on top, the store address, drawer, then the stickers and the gel;
                      phone: pinned to the bottom, drawer sheet, the address and the stickers on the painting, then the ink dock.
                    */}
                    <div
                      className={cn(
                        "dw-bevel grid w-full grid-cols-[minmax(0,1fr)_auto] rounded-[28px] transition-shadow duration-500",
                        "max-sm:sticky max-sm:bottom-0 max-sm:z-30 max-sm:-mx-4 max-sm:mt-auto max-sm:w-auto max-sm:rounded-none max-sm:bg-transparent max-sm:bg-none max-sm:pt-6 max-sm:shadow-none",
                      )}
                    >
                      {/* phones: the ink dock behind the field and the send */}
                      <div aria-hidden className="col-[1/-1] row-start-5 rounded-t-[28px] bg-dw-ink sm:hidden" />

                      <div className="flex items-start gap-3 px-5 pt-5 max-sm:col-start-1 max-sm:row-start-5 max-sm:items-end max-sm:gap-2.5 max-sm:pt-3 max-sm:pr-2 max-sm:pb-[max(12px,env(safe-area-inset-bottom))] max-sm:pl-3 sm:col-[1/-1] sm:row-start-1">
                        <motion.span
                          key={connected ? "yes" : "no"}
                          className="mt-0.5 inline-grid max-sm:mt-0"
                          animate={connected ? { y: [0, -12, 0, -4, 0], rotate: [0, -10, 6, 0, 0] } : undefined}
                          transition={{ duration: 0.8 }}
                        >
                          <Mascot kind="analyst" frame size={44} active title="Darwin" />
                        </motion.span>
                        <PromptField
                          value={prompt}
                          onChange={setPrompt}
                          onEnter={() => {
                            if (connected) toAsk();
                            else urlInput.current?.focus();
                          }}
                        />
                      </div>

                      {/* The primary way in: the store's address (darwin.js goes in with one script tag, no GitHub). */}
                      <div className="col-[1/-1] px-5 pt-3 max-sm:row-start-3 max-sm:px-4 max-sm:pt-0 max-sm:pb-2.5 sm:row-start-2">
                        {website ? (
                          <span className="inline-flex h-11 max-w-full min-w-0 items-center gap-2 rounded-full bg-dw-win-bg pr-1.5 pl-3.5 text-[14.5px] font-medium text-dw-ink">
                            <Globe className="size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate" title={website}>
                              {hostOf(website)}
                            </span>
                            <CheckPop size={18} tone="live" burst />
                            <span className="text-[12.5px] font-normal text-dw-ink/55 max-sm:hidden">script tag, no GitHub</span>
                            <button
                              type="button"
                              aria-label={`Remove ${hostOf(website)}`}
                              onClick={() => {
                                setUrlDraft(hostOf(website));
                                setWebsite(null);
                                setTimeout(() => urlInput.current?.focus(), 0);
                              }}
                              className="grid size-8 shrink-0 place-items-center rounded-full text-dw-ink/55 transition-colors hover:bg-white/70 hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
                            >
                              <X className="size-4" />
                            </button>
                          </span>
                        ) : (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              addUrl();
                            }}
                            className="flex h-12 items-center gap-2 rounded-full border border-dw-hairline bg-white py-1 pr-1 pl-4 focus-within:border-dw-ink/40 focus-within:ring-2 focus-within:ring-dw-ink/10 max-sm:border-transparent max-sm:shadow-[0_6px_18px_rgba(20,40,60,0.18)]"
                          >
                            <Globe className="size-[18px] shrink-0 text-dw-ink/55" aria-hidden />
                            <input
                              ref={urlInput}
                              value={urlDraft}
                              onChange={(e) => {
                                setUrlDraft(e.target.value);
                                setUrlError(null);
                              }}
                              inputMode="url"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              placeholder="Paste your store URL, e.g. shop.example.com"
                              aria-label="Your store's address"
                              aria-invalid={!!urlError}
                              aria-describedby="dwo-connect-why"
                              className="h-10 min-w-0 flex-1 bg-transparent text-[15.5px] text-dw-ink outline-none placeholder:text-dw-ink/40 max-sm:text-[16px]"
                            />
                            <button
                              type="submit"
                              disabled={!urlDraft.trim()}
                              className="h-10 shrink-0 rounded-full bg-dw-ink px-4 text-[14px] font-medium text-white transition-[opacity,transform] focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.97] disabled:opacity-30"
                            >
                              Add <span className="font-dwmono text-[12px] text-white/60 max-sm:hidden">↵</span>
                            </button>
                          </form>
                        )}
                      </div>

                      <div className="col-[1/-1] max-sm:row-start-1 sm:row-start-3">
                        <AnimatePresence initial={false}>
                          {open === "whop" && (
                            <Drawer key="whop">
                              <WhopConnect
                                status={whopStatus}
                                onConnected={(c) => {
                                  setWhop(c);
                                  setOpen(null);
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
                                  // The link itself navigates this tab to GitHub; keep what was typed for the way back.
                                  try {
                                    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt, url: website ?? urlDraft }));
                                  } catch {
                                    /* storage blocked: the prompt is retyped */
                                  }
                                  track("github_sign_in_started");
                                }}
                                onConnected={(r) => {
                                  setRepo(r);
                                  setWebsite(null);
                                  setOpen(null);
                                }}
                                onWebsite={() => {
                                  setOpen(null);
                                  setTimeout(() => urlInput.current?.focus(), 0);
                                }}
                              />
                            </Drawer>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Why Continue is off, said plainly (not only a grey button). */}
                      {!connected && (
                        <p
                          id="dwo-connect-why"
                          aria-live="polite"
                          className={cn(
                            "col-[1/-1] flex items-center gap-1.5 px-5 pt-2 text-[13px] max-sm:row-start-2 max-sm:mx-4 max-sm:mb-2.5 max-sm:justify-self-start max-sm:rounded-full max-sm:bg-dw-bg max-sm:px-3 max-sm:py-1.5 sm:row-start-4 sm:px-6",
                            urlError ? "text-dw-warn" : "text-dw-ink/60 max-sm:text-dw-ink/75",
                          )}
                        >
                          {urlError ? <TriangleAlert className="size-3.5 shrink-0" /> : <ArrowUp className="size-3.5 shrink-0 max-sm:rotate-180" />}
                          {urlError ?? "To continue, paste your store's address or connect GitHub. Whop is optional."}
                        </p>
                      )}

                      <div className="col-[1/-1] flex min-w-0 flex-wrap items-center gap-2.5 px-4 pt-4 pb-4 max-sm:row-start-4 max-sm:pt-0 max-sm:pb-3.5 sm:col-[1/2] sm:row-start-5 sm:self-end sm:pr-0 sm:pl-5">
                        <span className="text-[13px] text-dw-ink/55 max-sm:sr-only">or</span>
                        <ConnectSticker
                          kind="github"
                          icon={<BrandGlyph brand="github" size={18} />}
                          label="Connect your GitHub"
                          short="Connect GitHub"
                          value={repo ?? undefined}
                          active={open === "github"}
                          onClick={() => setOpen(open === "github" ? null : "github")}
                        />
                        <ConnectSticker
                          kind="whop"
                          icon={<WhopLogo size={18} />}
                          label="Connect your Whop"
                          short="Connect Whop"
                          title="Optional: brings your Whop sales and refunds in"
                          value={whop ? whop.title : undefined}
                          hint={whop?.mode === "offline" ? "demo" : undefined}
                          active={open === "whop"}
                          onClick={() => setOpen(open === "whop" ? null : "whop")}
                        />
                        <Link
                          href="/console"
                          onClick={() => track("onboarding_skipped_to_demo")}
                          className="ml-auto rounded-full px-2 py-1 text-[13px] font-medium text-white underline decoration-white/50 underline-offset-[3px] [text-shadow:0_1px_6px_rgba(20,40,60,0.55)] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:hidden"
                        >
                          Skip: demo store
                        </Link>
                      </div>

                      <span className="relative self-end max-sm:col-start-2 max-sm:row-start-5 max-sm:mr-3 max-sm:mb-[max(12px,env(safe-area-inset-bottom))] sm:row-start-5 sm:mr-4 sm:mb-4">
                        {connected && (
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 rounded-full bg-dw-pink"
                            initial={{ scale: 1, opacity: 0.6 }}
                            animate={{ scale: 1.35, opacity: 0 }}
                            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                          />
                        )}
                        <Gel
                          ref={continueBtn}
                          tone={connected ? "pink" : "ghost"}
                          h={48}
                          onClick={toAsk}
                          disabled={!connected}
                          aria-label="Continue"
                          aria-describedby={connected ? undefined : "dwo-connect-why"}
                          className="max-sm:h-11 max-sm:w-11 max-sm:p-0"
                        >
                          <span className="max-sm:hidden">Continue</span>
                          <ArrowRight className="max-sm:hidden" />
                          <ArrowUp className="size-5! sm:hidden" />
                        </Gel>
                      </span>
                    </div>
                      </>
                    )}
                  </motion.section>
                )}

                {stage === "ask" && (
                  <motion.section key="ask" {...fade}>
                    <AskChat
                      prompt={prompt}
                      connectedTo={connectedTo}
                      whop={whop?.title}
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
                      <div className="flex min-w-0 flex-col gap-4 max-sm:contents lg:sticky lg:top-6 lg:col-start-1 lg:row-start-2 lg:self-start">
                        <Thread messages={chat.slice(2)} />
                        {plan && (
                          <>
                            <Composer busy={busy} onSend={say} />
                            {/* phones: pinned to the bottom while the plan scrolls under it */}
                            <div className="flex items-center justify-between gap-3 pt-1 max-sm:sticky max-sm:bottom-0 max-sm:z-20 max-sm:-mx-4 max-sm:bg-dw-bg max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(12px,env(safe-area-inset-bottom))]">
                              <PillButton tone="ghost" onClick={() => setStage("ask")}>
                                Back
                              </PillButton>
                              <Gel
                                h={52}
                                disabled={busy}
                                className="max-sm:flex-1"
                                onClick={() => {
                                  // Approved: the console gets exactly this plan, even on a fresh server instance.
                                  rememberPlan(plan);
                                  rememberSite(plan.site, plan.siteUrl ?? undefined);
                                  setStage("install");
                                  track("plan_confirmed", {
                                    events: plan.events.filter((e) => e.enabled).length,
                                  });
                                }}
                              >
                                Looks good: install it <ArrowRight />
                              </Gel>
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
                          saved={account}
                          onDone={(acc) => {
                            if (acc) setAccount(acc);
                            track("script_tag_installed", { saved: !!acc });
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
                          One pull request on <b className="font-dwmono font-medium text-dw-ink">{plan.repo}</b>: darwin.js (under 5 KB) and your plan as{" "}
                          <code className="rounded-md bg-dw-sand px-1.5 py-0.5 font-dwmono text-[0.85em] text-dw-ink max-sm:bg-dw-bg">DARWIN_TRACKING.md</code>. Nothing changes until you
                          merge it.
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
                            <SaveAndRecord
                              site={plan.site}
                              saved={account}
                              onDone={(acc) => {
                                if (acc) setAccount(acc);
                                setStage("live");
                              }}
                            />
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
                      account={account}
                      onOpen={() => {
                        track("dashboards_opened", { site: plan.site });
                        router.push(`/console/dashboards?site=${encodeURIComponent(plan.site)}`);
                      }}
                    />
                  </motion.section>
                )}
              </AnimatePresence>
              {canStartOver && !welcome && (
                <div className={cn("flex justify-center", stage === "connect" ? "mt-5 max-sm:hidden" : "mt-14")}>
                  <StartOver onConfirm={startOver} label={stage === "connect" ? "Start over" : "Not the right store? Start over"} onPainting={stage === "connect"} />
                </div>
              )}
            </div>
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

/* ------------------------------------------------------------------ resume */

/** "Start over" asks first: it wipes the setup in this browser (the plans stay in the console). */
function StartOver({ onConfirm, label, onPainting }: { onConfirm: () => void; label: string; onPainting?: boolean }) {
  const [asking, setAsking] = useState(false);
  const base = "h-8 rounded-full px-3 text-[13px] transition-colors focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none";
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={cn(base, onPainting ? "bg-dw-bg/90 font-medium text-dw-ink/75 hover:bg-dw-bg hover:text-dw-ink" : "text-dw-ink/50 hover:bg-dw-sand hover:text-dw-ink")}
      >
        {label}
      </button>
    );
  }
  return (
    <span role="group" aria-label="Confirm start over" className="inline-flex items-center gap-1 rounded-full bg-dw-bg py-1 pr-1 pl-3 text-[13px] text-dw-ink shadow-[0_0_0_1px_rgba(20,20,19,0.1)]">
      <span className="mr-1">Wipe this setup?</span>
      <button
        type="button"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className="h-7 rounded-full bg-dw-ink px-3 font-medium text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:ring-offset-1 focus-visible:outline-none"
      >
        Yes, start over
      </button>
      <button type="button" onClick={() => setAsking(false)} className="h-7 rounded-full px-3 text-dw-ink/65 hover:bg-dw-sand hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none">
        Cancel
      </button>
    </span>
  );
}

/** A revisit after going live: straight to the dashboards, back into the setup, or another store. */
function WelcomeBack({ host, site, onContinue, onAnother }: { host: string; site: string; onContinue: () => void; onAnother: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="dw-bevel w-full max-w-[40rem] rounded-[28px] p-6 max-sm:mt-auto max-sm:mb-[max(16px,env(safe-area-inset-bottom))] sm:p-7"
      aria-label="Welcome back"
    >
      <div className="flex items-center gap-4">
        <Mascot kind="analyst" frame size={52} active title="Darwin" />
        <div className="min-w-0">
          <h2 className="text-[24px] leading-tight font-semibold tracking-[-0.02em]">Welcome back</h2>
          <p className="mt-0.5 text-[15px] leading-snug text-dw-ink/65">
            <b className="font-semibold text-dw-ink">{host}</b> is set up. Your dashboards are waiting.
          </p>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <GelLink href={`/console/dashboards?site=${encodeURIComponent(site)}`} h={50} className="max-sm:w-full">
          <LayoutDashboard /> Open your dashboards
        </GelLink>
        <PillButton tone="sand" onClick={onContinue} className="h-[50px] max-sm:w-full">
          Back to the setup
        </PillButton>
        <button type="button" onClick={onAnother} className={cn(linkCls, "self-center sm:ml-auto")}>
          Set up another store
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ plan stage */

function Thread({ messages }: { messages: Message[] }) {
  return (
    <>
      {messages.map((m, i) =>
        m.from === "you" ? (
          <YouBubble key={`you-${i}-${m.text}`} text={m.text} chips={m.chips} />
        ) : (
          <motion.div
            key={`darwin-${i}-${m.pending ? "pending" : m.text}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <AgentBubble working={!!m.pending}>
              {m.pending ? m.steps ? <Working steps={m.steps} /> : <Typing /> : <span className="whitespace-pre-line">{m.text}</span>}
            </AgentBubble>
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
        className="dw-bevel flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-2 max-sm:bg-dw-ink max-sm:bg-none max-sm:shadow-none"
      >
        <Mascot kind="analyst" size={30} active={busy} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Anything else to track? Or something to leave out?"
          aria-label="Tell Darwin what to change in the plan"
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-dw-ink outline-none placeholder:text-dw-ink/35 max-sm:text-[16px] max-sm:text-white max-sm:placeholder:text-white/45"
        />
        <Gel type="submit" round h={40} tone={text.trim() ? "pink" : "ghost"} disabled={busy || !text.trim()} aria-label="Send">
          {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
        </Gel>
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
    <Card tone="white" hover={false} className="p-6 max-sm:border-0 max-sm:bg-transparent! max-sm:p-0 sm:p-7" aria-busy="true" aria-label="Drafting your plan">
      <div className="flex items-center gap-4">
        <Mascot kind="designer" frame size={60} active />
        <div>
          <div className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Drafting your plan</div>
          <div className="mt-0.5 text-[14px] text-dw-ink/60">What to record, and the dashboards to build from it.</div>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {[92, 70, 110, 84, 128].map((w, i) => (
          <motion.span
            key={i}
            className="h-9 rounded-full bg-dw-yellow/60"
            style={{ width: w }}
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
          />
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            className="h-[62px] rounded-[18px] bg-dw-sand"
            animate={{ opacity: [0.45, 1, 0.45] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: 0.3 + i * 0.12,
            }}
          />
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
          value={
            plan.siteUrl
              ? "not checked (no repo)"
              : plan.repoRead === false
                ? "not checked yet"
                : plan.existingAnalytics?.length
                  ? plan.existingAnalytics.join(" · ")
                  : "none found"
          }
          hint={plan.existingAnalytics?.some((a) => !a.startsWith("Darwin")) ? "darwin.js runs alongside" : undefined}
        />
        {!!plan.goals?.length && <Fact label="Heard" value={plan.goals.join(", ")} brand />}
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

      <Card tone="white" hover={false} className="p-5 max-sm:border-0 max-sm:bg-transparent! max-sm:px-0 max-sm:py-2 sm:p-6">
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
                {d.custom && (
                  <Tag tone="ink" className="h-5 px-2 text-[11px]">
                    you asked
                  </Tag>
                )}
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
    <motion.svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 18 }}
    >
      <motion.path
        d="M3.6 8.4l2.9 2.9 5.9-6.4"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.08 }}
      />
    </motion.svg>
  );
}

function Fact({ label, value, hint, brand }: { label: string; value: string; hint?: string; brand?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3 text-[13px]",
        brand ? "bg-dw-ink text-white" : "border border-dw-hairline bg-dw-surface max-sm:border-dw-ink/15 max-sm:bg-transparent",
      )}
      title={hint}
    >
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
      onDone(
        await http<PullRequestResult>("POST", "/api/onboarding/install", {
          site,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card tone="white" hover={false} className="p-5 max-sm:border-0 max-sm:bg-transparent! max-sm:px-0 max-sm:py-2 sm:p-6">
      <div className="flex items-center gap-3">
        <Mascot kind="shipper" frame size={48} active={busy} />
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
        <Gel h={50} onClick={run} disabled={busy} className="max-sm:w-full">
          {busy ? <LoaderCircle className="animate-spin" /> : <GitPullRequest />}
          Open pull request
        </Gel>
      </div>
    </Card>
  );
}

/** The install step without GitHub: copy one script tag, then start recording. */
function InstallSnippet({ plan, snippet, saved, onDone }: { plan: TrackingPlan; snippet: string; saved: SavedAccount | null; onDone: (account: SavedAccount | null) => void }) {
  const [copied, setCopied] = useState(false);
  const verify = useVerify(plan.site, plan.siteUrl);
  const custom = plan.events.filter((e) => e.enabled && !e.automatic).length;
  return (
    <>
      <AgentBubble working={false}>
        Paste this line into your site&apos;s{" "}
        <code className="rounded-md bg-dw-sand px-1.5 py-0.5 font-dwmono text-[0.85em] text-dw-ink max-sm:bg-dw-bg">&lt;head&gt;</code>
        {custom ? `, then add the one-line call for your ${custom} events (they're in the plan)` : ""}. Under 5 KB, and it never reads form fields.
      </AgentBubble>
      <Card tone="white" hover={false} className="p-5 max-sm:border-0 max-sm:bg-transparent! max-sm:p-0 sm:p-6">
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
      <VerifyRow host={hostOf(plan.siteUrl ?? "")} verify={verify} />
      <SaveAndRecord site={plan.site} saved={saved} onDone={onDone} />
    </>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * "Start recording", the moment of highest motivation, asks for one thing: an email to save the setup.
 * POST /api/account → a link back from any device (shown on Live; nothing is emailed). Skipping is allowed.
 */
function SaveAndRecord({ site, saved, onDone }: { site: string; saved: SavedAccount | null; onDone: (account: SavedAccount | null) => void }) {
  const [email, setEmail] = useState(saved?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = EMAIL_RE.test(email.trim());

  if (saved) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="mr-auto text-[13.5px] text-dw-ink/60">
          Saved to <b className="font-semibold text-dw-ink">{saved.email}</b>
        </span>
        <Gel h={52} onClick={() => onDone(null)} className="max-sm:w-full">
          <Radio /> Start recording
        </Gel>
      </div>
    );
  }

  const save = async () => {
    if (!valid) return setError(email.trim() ? "That doesn't look like an email address." : "Add your email to save your setup, or skip for now.");
    setBusy(true);
    setError(null);
    try {
      const r = await http<{ email: string; initials: string; resumeUrl: string }>("POST", "/api/account", { email: email.trim(), site });
      track("setup_saved", { site });
      onDone({ email: r.email, resumeUrl: r.resumeUrl });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="rounded-[24px] border border-dw-hairline bg-dw-surface p-4 max-sm:border-0 max-sm:bg-dw-sand sm:p-5"
      aria-label="Save your setup"
    >
      <label htmlFor="dwo-email" className="block text-[15px] font-semibold">
        Save your setup
      </label>
      <p className="mt-0.5 text-[13.5px] leading-snug text-dw-ink/60">Your email, and Darwin gives you a link to come back from any device.</p>
      <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <input
          id="dwo-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder="you@yourstore.com"
          aria-invalid={!!error}
          className="h-[52px] w-full min-w-0 rounded-full border border-dw-hairline bg-white px-5 text-[16px] text-dw-ink outline-none placeholder:text-dw-ink/35 focus:border-dw-ink/40 focus-visible:ring-2 focus-visible:ring-dw-ink/15 sm:flex-1"
        />
        <Gel type="submit" h={52} disabled={busy} tone={valid ? "pink" : "ghost"} className="max-sm:w-full">
          {busy ? <LoaderCircle className="animate-spin" /> : <Radio />} Save &amp; start recording
        </Gel>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {error ? (
          <span role="alert" id="dwo-email-error" className="text-[13px] text-dw-warn">
            {error}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => {
            track("setup_save_skipped", { site });
            onDone(null);
          }}
          className={linkCls}
        >
          Skip for now
        </button>
      </div>
    </form>
  );
}

/** On Live, once saved: the link back (the resume link restores this setup on any browser). */
function SavedLink({ account }: { account: SavedAccount }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] bg-dw-sand/80 px-4 py-3" aria-live="polite">
      <CheckPop size={20} tone="live" />
      <span className="min-w-0 flex-1 basis-60 text-[14px] leading-snug">
        <b className="font-semibold">Saved.</b> Your link to come back from any device:{" "}
        <span className="block truncate font-dwmono text-[12.5px] text-dw-ink/60" title={account.resumeUrl}>
          {account.resumeUrl}
        </span>
      </span>
      <PillButton
        tone="white"
        size="sm"
        onClick={() => {
          navigator.clipboard?.writeText(account.resumeUrl).then(
            () => setCopied(true),
            () => setCopied(false),
          );
          track("resume_link_copied");
        }}
        className="max-sm:w-full"
      >
        {copied ? <CheckPop size={16} tone="live" /> : <Copy />} {copied ? "Copied" : "Copy"}
      </PillButton>
    </div>
  );
}

/**
 * Is darwin.js really on the store? GET /api/onboarding/verify every 5 s until it is (a real event from the
 * store, or the tag on its homepage). Without a store address (the GitHub path) there's nothing to poll.
 */
function useVerify(site: string, url: string | undefined) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    if (!url) return;
    setChecking(true);
    try {
      const r = await http<VerifyResult>("GET", `/api/onboarding/verify?site=${encodeURIComponent(site)}&url=${encodeURIComponent(url)}`);
      setResult(r);
      if (r.verified) track("install_verified", { site, via: r.via });
    } catch {
      /* the next poll tries again */
    } finally {
      setChecking(false);
    }
  }, [site, url]);
  const verified = !!result?.verified;
  useEffect(() => {
    if (!url || verified) return;
    const first = setTimeout(check, 0);
    const t = setInterval(check, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [check, url, verified]);
  return { result, verified, checking, check };
}

type Verify = ReturnType<typeof useVerify>;

/** "Waiting to detect darwin.js on eastfork.com…" → "Verified: darwin.js found on eastfork.com". */
function VerifyRow({ host, verify, className }: { host: string; verify: Verify; className?: string }) {
  const { result, verified, checking, check } = verify;
  return (
    <div
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[20px] px-4 py-3", verified ? "bg-dw-win-bg text-dw-win" : "bg-dw-sand/80 text-dw-ink", className)}
    >
      <span className="grid size-6 shrink-0 place-items-center">
        {verified ? <CheckPop size={20} tone="live" burst /> : <LoaderCircle className="size-[18px] animate-spin text-dw-ink/45 motion-reduce:animate-none" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1 basis-52">
        <span className="block text-[14.5px] font-semibold">{verified ? `Verified: darwin.js found on ${host}` : `Waiting to detect darwin.js on ${host}…`}</span>
        {result?.detail && <span className={cn("block text-[13px] leading-snug", verified ? "text-dw-win/80" : "text-dw-ink/60")}>{result.detail}</span>}
      </span>
      {!verified && (
        <PillButton tone="white" size="sm" onClick={() => void check()} disabled={checking} className="max-sm:w-full">
          {checking ? <LoaderCircle className="animate-spin" /> : <Radio />} Test my install
        </PillButton>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ live */

const fmt = (v: number) => Math.round(v).toLocaleString("en-GB");

function Live({ plan, account, onOpen }: { plan: TrackingPlan; account: SavedAccount | null; onOpen: () => void }) {
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
      const res = await http<WebSimulateResponse>("POST", "/api/web/simulate", {
        site: plan.site,
        visitors: 300,
        events: goals.slice(0, 12),
      });
      setSent((n) => n + res.visitors);
      // So the console can re-send them to a server instance that never saw them.
      rememberSimulated(plan.site, res.visitors);
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
  const verify = useVerify(plan.site, plan.siteUrl);
  /** Only proof counts as "Recording": the tag on the store, or real visits (the GitHub path has no address to check). */
  const recording = verify.verified || (!plan.siteUrl && real > 0);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <LiveMascot celebrate={all} />
          <div className="min-w-0">
            <h1 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[46px]">Your dashboards are built</h1>
            <p className="mt-2 max-w-[48rem] text-[15.5px] leading-snug text-dw-ink/70 sm:text-[17px]">
              {recording
                ? "darwin.js is live: real shoppers show up here within seconds. Simulated shoppers stay labelled and never mix into your real numbers."
                : `${plan.siteUrl ? "Publish the script tag" : "Merge the pull request and deploy"}: until Darwin sees it, this is a simulated preview. Send simulated shoppers to watch it fill (labelled, never mixed into your real numbers).`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5 max-sm:w-full max-sm:flex-col-reverse">
          <Gel tone="ghost" h={50} onClick={simulate} disabled={sending} className="max-sm:w-full">
            {sending ? <LoaderCircle className="animate-spin" /> : <Bot />}
            Send 300 simulated shoppers
          </Gel>
          <Gel h={50} onClick={onOpen} className="max-sm:w-full">
            <LayoutDashboard /> Open my dashboards
          </Gel>
        </div>
      </header>

      {(plan.siteUrl || account) && (
        <div className="-mt-2 flex flex-col gap-2.5">
          {plan.siteUrl && <VerifyRow host={hostOf(plan.siteUrl)} verify={verify} />}
          {account && <SavedLink account={account} />}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <Card tone="yellow" shape="experimenter" corner="br" hover={false} className="self-start p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">Events</h2>
            <span className="num text-[13px] font-medium text-dw-ink/70">
              {recorded}/{events.length} recorded
            </span>
          </div>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-dw-ink/10"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={events.length}
            aria-valuenow={recorded}
            aria-label="Events recorded"
          >
            <motion.div
              className="h-full rounded-full bg-dw-ink"
              initial={{ width: 0 }}
              animate={{
                width: `${events.length ? (recorded / events.length) * 100 : 0}%`,
              }}
              transition={{ duration: 0.8, ease: EASE }}
            />
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-2 text-[13px] text-dw-ink/75">
            {recording ? (
              <>
                <LiveDot /> Recording <span className="truncate font-dwmono text-[12.5px]">{plan.site}</span>
              </>
            ) : (
              <>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-dw-ink/30" /> Not verified yet: simulated preview
              </>
            )}
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
              {data.syntheticEvents.toLocaleString("en-GB")} of {data.totalEvents.toLocaleString("en-GB")} events are simulated
              {sent ? ` (${sent} shoppers sent)` : ""}.
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
          {!!data?.syntheticEvents && !!data.dashboards.length && (
            <div className="mb-2.5 flex flex-wrap items-center gap-2 px-1.5 pt-1 text-[13px] text-dw-ink/70">
              <Tag tone="warn" className="h-6 px-2.5 text-[12px] font-semibold">
                {real > 0 ? "Real + simulated" : "Simulated"}
              </Tag>
              {real > 0 ? "Numbers below mix real visitors with simulated shoppers." : "Every number below comes from simulated shoppers, not real visitors."}
            </div>
          )}
          {data?.dashboards.length ? (
            <DashboardGrid dashboards={data.dashboards} compact />
          ) : (
            <div className="relative grid min-h-[300px] place-items-end overflow-hidden rounded-[22px] p-4 sm:min-h-[420px]">
              <Art id="valley" position="50% 40%" sizes="(max-width: 1024px) 100vw, 60vw" />
              <div className="relative flex items-center gap-3 rounded-full bg-dw-bg py-1.5 pr-4 pl-1.5 text-[14.5px] text-dw-ink/80">
                <Mascot kind="experimenter" frame size={36} active />
                {data ? "Your dashboards appear here as the first events arrive." : "Building your dashboards…"}
              </div>
            </div>
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

const PLACEHOLDER = "What do you sell, and what worries you? e.g. “trail running shoes; checkout feels slow on mobile and people ask about sizing”";

/** Screen 1's field. On a phone it lives in the ink dock and grows upward with the text, like a messaging app. */
function PromptField({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const phone = useIsPhone();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!phone) {
      el.style.height = "";
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value, phone]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        }
      }}
      rows={3}
      placeholder={phone ? "What do you sell? What worries you?" : PLACEHOLDER}
      aria-label="Tell Darwin about your store"
      className="min-h-[5.6rem] w-full resize-none bg-transparent pt-2.5 text-[16.5px] leading-relaxed text-dw-ink outline-none placeholder:text-dw-ink/35 max-sm:h-11 max-sm:min-h-0 max-sm:py-2.5 max-sm:text-[16px] max-sm:leading-6 max-sm:text-white max-sm:placeholder:text-white/45"
    />
  );
}

/** "Connect your GitHub" / "Connect your Whop" as die-cut stickers that peel a corner on hover. */
function ConnectSticker({
  kind,
  icon,
  label,
  short,
  value,
  hint,
  title,
  active,
  onClick,
}: {
  kind: "github" | "whop";
  icon: ReactNode;
  label: string;
  /** What a phone shows (the full label stays the accessible name). */
  short: string;
  value?: string;
  hint?: string;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  const done = !!value;
  return (
    <Sticker
      tilt={active ? 0 : kind === "github" ? -2 : 1.5}
      flat={active}
      onClick={onClick}
      aria-expanded={active}
      title={title}
      className="max-w-full min-w-0"
      faceClassName={cn(
        "h-10 max-w-[16rem] min-w-0 rounded-[14px] pr-2.5 pl-2 text-[14px] font-medium sm:max-w-[19rem]",
        done ? "bg-dw-win-bg text-dw-ink" : kind === "github" ? "bg-dw-ink text-white" : "bg-dw-pink text-dw-ink",
      )}
    >
      <span aria-hidden className="grid size-5 shrink-0 place-items-center">
        {icon}
      </span>
      <span className="min-w-0 truncate">
        {done ? (
          value
        ) : (
          <>
            <span aria-hidden className="sm:hidden">
              {short}
            </span>
            <span className="max-sm:sr-only">{label}</span>
          </>
        )}
      </span>
      {hint && <span className="opacity-60">({hint})</span>}
      {done ? <CheckPop size={18} tone="live" burst /> : <ChevronDown className={cn("size-4 shrink-0 opacity-60 transition-transform", active && "rotate-180")} aria-hidden />}
    </Sticker>
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
        <input
          ref={input}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="whop_…"
          autoComplete="off"
          aria-label="Whop API key"
          className={inputCls}
        />
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
  /** "No GitHub?": back to the store-address field. */
  onWebsite: () => void;
}) {
  const [url, setUrl] = useState(status?.repo ? `https://github.com/${status.repo}` : "");
  const [error, setError] = useState<string | null>(authError);
  const [paste, setPaste] = useState(false);
  /** The repos API said 401: the sign-in expired, so offer it again. */
  const [expired, setExpired] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const signedIn = !!auth?.github && !expired;
  const oauth = !!auth?.providers.github;
  const onUnauthorized = useCallback(() => setExpired(true), []);

  useEffect(() => input.current?.focus(), [paste, signedIn]);

  // Preview unless the server really can open PRs: a token GitHub rejected (valid: false) counts as none.
  const dryRun = !signedIn && (status ? (status.dryRun ?? (!status.configured || status.valid === false)) : false);

  const other = <NoGithub onChoose={onWebsite} />;

  // 1. Not signed in, and sign-in is available: the button is the main path.
  if (oauth && !signedIn && !paste) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] leading-snug text-dw-ink/70">
          {expired
            ? "Your GitHub sign-in has expired. Sign in again to pick your repository."
            : "Sign in so Darwin can see your repositories and open the install pull request as you. It only ever changes code through pull requests you review."}
        </p>
        {/* A plain same-tab link (no popup, no router): the API route redirects to github.com and back here. */}
        <a
          href={GITHUB_SIGN_IN}
          onClick={onSignIn}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-dw-ink px-6 text-[15px] font-medium text-white transition-[background-color,transform] hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
        >
          <BrandGlyph brand="github" size={18} /> Sign in with GitHub
        </a>
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
      <p className="text-[14px] leading-snug text-dw-ink/70">
        {oauth ? "Paste a repository URL." : "Paste a repository URL (GitHub sign-in isn't set up on this server)."} Darwin only ever changes it through pull requests you review.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input ref={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/acme/storefront" aria-label="Repository URL" className={inputCls} />
        <PillButton type="submit" disabled={!url.trim()} className="h-11">
          <BrandGlyph brand="github" size={16} /> Connect
        </PillButton>
      </div>
      {oauth &&
        (signedIn ? (
          <button type="button" onClick={() => setPaste(false)} className={linkCls}>
            or pick from your repositories
          </button>
        ) : (
          <a href={GITHUB_SIGN_IN} onClick={onSignIn} className={linkCls}>
            or sign in with GitHub
          </a>
        ))}
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

/** "shop.example.com", "https://Shop.example.com/x" → "https://shop.example.com"; anything else → null. */
function storeOrigin(raw: string): string | null {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  if (!/^https?:\/\//i.test(t) && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    const host = u.hostname;
    if (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || !/\.[a-z]{2,}$/i.test(host)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The ways in that don't need GitHub. */
function NoGithub({ onChoose }: { onChoose: () => void }) {
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-dw-ink/[0.08] pt-3 text-[13.5px] leading-snug text-dw-ink/65">
      <span>
        No GitHub?{" "}
        <button
          type="button"
          onClick={onChoose}
          className="rounded font-semibold text-dw-ink underline decoration-dw-ink/30 underline-offset-[3px] hover:decoration-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
        >
          Paste your store&apos;s address instead
        </button>{" "}
        and add one script tag (Shopify, Webflow, WordPress, any site you can edit).
      </span>
      <span>
        Only sell on Whop?{" "}
        <Link
          href="/console/agents"
          className="rounded font-semibold text-dw-ink underline decoration-dw-ink/30 underline-offset-[3px] hover:decoration-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
        >
          Your store agent needs no code
        </Link>
        : AI shoppers buy your Whop plans through it.
      </span>
    </div>
  );
}
