"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight, Bot } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useGithubStatus } from "@/lib/console/hooks";
import { BrandGlyph, WhopLogo } from "../brand-logos";
import { Mascot } from "../mascot";
import { useDarwin } from "../provider";
import { Card, CardTitle, Tag } from "../ui";
import { brainOf, scriptTagFor, useSession, useWhop, type GithubStatusFull } from "./data";
import { Snippet } from "./snippet";

type Dot = "on" | "demo" | "off" | "agent";
const DOT_TITLE: Record<Dot, string> = { on: "Connected", demo: "Demo or dry run", off: "Not connected", agent: "Always on for AI shoppers" };
const DOT: Record<Dot, string> = {
  on: "bg-dw-live",
  demo: "bg-[#E8A33D]",
  off: "bg-dw-ink/25",
  agent: "bg-dw-hot",
};

const RETURN = "/console/settings";

/** Everything Darwin is plugged into: repo, GitHub account, Whop, the store agent and the model doing the thinking. */
export function StoreCard({ className }: { className?: string }) {
  const { mock } = useDarwin();
  const { status: raw } = useGithubStatus();
  const gh = raw as GithubStatusFull | undefined;
  const { session, mutate: mutateSession } = useSession();
  const { whop } = useWhop();
  const { loop } = useDarwin();
  const brain = brainOf(loop?.designer);
  const conn = gh?.connection;

  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await mutateSession();
    } finally {
      setSigningOut(false);
    }
  };

  /* ---------------------------------------------------------------- repo */
  const repoName = conn?.repo ?? gh?.repo;
  const mode = conn?.mode ?? gh?.mode;
  const repoDot: Dot = !repoName ? "off" : mode === "live" ? "on" : "demo";
  const modeText = mode === "live" ? "pull requests open for real" : mode === "dry-run" ? "dry run, pull requests are drafted only" : "offline, pull requests are previews";
  const repoDetail = !gh
    ? "Checking…"
    : repoName
      ? [conn?.frameworkLabel, conn ? modeText : "set on the server", conn?.installPr?.number ? `analytics from PR #${conn.installPr.number}` : undefined].filter(Boolean).join(" · ")
      : mock
        ? "This demo runs in your browser, so nothing is connected"
        : "Darwin opens a pull request that installs its analytics";

  /* ---------------------------------------------------------------- whop */
  const wc = whop?.connection;
  const whopDot: Dot = !wc ? "off" : wc.mode === "live" ? "on" : "demo";

  return (
    <Card tone="white" className={cn("flex flex-col overflow-clip p-6 sm:p-7", className)} aria-label="Your store">
      <CardTitle
        right={
          <Link href="/onboarding" className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium text-dw-ink hover:bg-dw-sand focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none">
            Connect a store <ArrowUpRight className="size-3.5" />
          </Link>
        }
      >
        Your store
      </CardTitle>

      <ul className="relative mt-3 flex flex-col">
        {/* The thread that ties the connections together. */}
        <span aria-hidden className="absolute top-8 bottom-8 left-[19px] w-px bg-[repeating-linear-gradient(to_bottom,#D9CFBB_0_4px,transparent_4px_8px)]" />

        <Row
          i={0}
          dot={repoDot}
          icon={<BrandGlyph brand="github" size={20} title="GitHub" />}
          name={repoName ?? "No repo connected"}
          detail={repoDetail}
          action={
            repoName && mode === "live" ? (
              <ActionLink href={`https://github.com/${repoName}`} external>
                Open
              </ActionLink>
            ) : (
              <ActionLink href="/onboarding">{repoName ? "Change" : "Connect"}</ActionLink>
            )
          }
        >
          {conn?.host && conn.siteId && (
            <Snippet className="mt-2.5" label="darwin.js install tag" code={scriptTagFor(conn.host, conn.siteId)} />
          )}
        </Row>

        <Row
          i={1}
          dot={session?.github ? "on" : "off"}
          icon={
            session?.github?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.github.avatarUrl} alt="" width={40} height={40} className="size-full rounded-[inherit] object-cover" />
            ) : (
              <BrandGlyph brand="github" size={20} title="GitHub" />
            )
          }
          name={session?.github ? `Signed in as @${session.github.login}` : "Your GitHub account"}
          detail={
            !session
              ? "Checking…"
              : session.github
                ? "Darwin reads your repos and opens pull requests as you"
                : session.providers.github
                  ? "Sign in so pull requests come from you, not the server"
                  : gh?.configured
                    ? "Sign-in isn't set up here, so Darwin uses the server's GitHub token"
                    : "Sign-in isn't set up on this server (GITHUB_OAUTH_CLIENT_ID)"
          }
          action={
            session?.github ? (
              <ActionButton onClick={() => void signOut()} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign out"}
              </ActionButton>
            ) : session?.providers.github ? (
              // A full navigation: the OAuth redirect has to leave the app.
              <a
                href={`/api/auth/github/start?return=${encodeURIComponent(RETURN)}`}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-dw-ink px-3.5 text-[13px] font-medium whitespace-nowrap text-white transition-[background-color,transform] hover:bg-black focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.97]"
              >
                <BrandGlyph brand="github" size={14} /> Sign in with GitHub
              </a>
            ) : undefined
          }
        />

        <Row
          i={2}
          dot={whopDot}
          icon={<WhopLogo size={22} />}
          name={
            <span className="flex flex-wrap items-center gap-2">
              {wc?.title ?? "Whop"}
              {wc && <Tag tone={wc.mode === "live" ? "win" : "yellow"}>{wc.mode === "live" ? "Live" : "Demo"}</Tag>}
            </span>
          }
          detail={
            !whop
              ? "Checking…"
              : wc
                ? wc.mode === "live"
                  ? `Connected · ${wc.products.length} product${wc.products.length === 1 ? "" : "s"}${whop.configured ? " · key on the server" : ""}`
                  : "A labelled demo business, no API key yet"
                : "Sell on Whop? Connect it and your store agent can sell your plans"
          }
          action={<ActionLink href="/onboarding">{wc ? "Change" : "Connect"}</ActionLink>}
        />

        <Row
          i={3}
          dot="agent"
          icon={<Bot className="size-5" strokeWidth={2} />}
          name="Store agent"
          detail="AI shoppers ask, compare and buy over A2A, MCP and llms.txt"
          action={<ActionLink href="/console/agents">Open</ActionLink>}
        />

        <Row
          i={4}
          dot={brain.llm ? "on" : "demo"}
          icon={brain.glyph ? <BrandGlyph brand={brain.glyph} size={20} title={brain.name} /> : <Mascot kind="leader" size={26} state="idle" title="Built-in rules" />}
          badge={brain.via && brain.via !== brain.glyph ? <BrandGlyph brand={brain.via} size={11} /> : undefined}
          name={
            <span className="flex flex-wrap items-center gap-x-2">
              Darwin&apos;s brain
              <span className="font-normal text-dw-ink/60">
                {brain.name}
                {brain.model && brain.model !== brain.name && <span className="font-dwmono text-[12.5px]"> {brain.model}</span>}
              </span>
            </span>
          }
          detail={
            !loop
              ? "Checking…"
              : brain.grok
                ? "Grok writes the insights and fixes"
                : brain.llm
                  ? "Writes the insights and fixes. Set XAI_API_KEY to think with Grok"
                  : "Hand-written rules, no AI key needed. Set XAI_API_KEY to think with Grok"
          }
        />
      </ul>
    </Card>
  );
}

function Row({
  i,
  dot,
  icon,
  badge,
  name,
  detail,
  action,
  children,
}: {
  i: number;
  dot: Dot;
  icon: ReactNode;
  badge?: ReactNode;
  name: ReactNode;
  detail: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.12 + i * 0.06, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className="dw-row relative -mx-3 rounded-2xl px-3 py-2.5 hover:bg-[#F6F0E4]"
    >
      <div className="flex items-center gap-3.5">
        <span className="dw-tilt relative size-10 shrink-0">
          <span className="grid size-10 place-items-center overflow-hidden rounded-[13px] bg-white text-dw-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_1px_rgba(20,20,19,0.08),0_3px_8px_rgba(20,20,19,0.07)]">
            {icon}
          </span>
          {badge && <span className="absolute -right-1.5 -bottom-1.5 grid size-[20px] place-items-center rounded-full bg-white shadow-[0_0_0_1px_rgba(20,20,19,0.1),0_2px_4px_rgba(20,20,19,0.08)]">{badge}</span>}
          <span title={DOT_TITLE[dot]} className={cn("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-[2.5px] ring-dw-surface", DOT[dot], dot === "on" && "dw-live-dot")}>
            <span className="sr-only">{DOT_TITLE[dot]}</span>
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-tight font-semibold">{name}</div>
          <div className="mt-0.5 text-[13px] leading-snug text-dw-muted">{detail}</div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="pl-[54px]">{children}</div>}
    </motion.li>
  );
}

function ActionLink({ href, external, children }: { href: string; external?: boolean; children: ReactNode }) {
  const cls =
    "inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13.5px] font-medium text-dw-ink/75 transition-colors hover:bg-dw-sand hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none";
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children} <ArrowUpRight className="size-3.5" />
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function ActionButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center rounded-full bg-dw-sand px-3.5 text-[13px] font-medium text-dw-ink transition-colors hover:bg-[#e4dccb] focus-visible:ring-2 focus-visible:ring-dw-ink focus-visible:outline-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}
