"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, FileCode, GitBranch, GitPullRequest, LoaderCircle, TriangleAlert } from "lucide-react";
import type { GithubStatusResponse } from "@/lib/contracts";
import type { PullRequestResult } from "@/lib/github";
import { useApi } from "@/lib/console/hooks";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { GithubMark } from "./brand";

export function PrBody({ pr }: { pr: PullRequestResult }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={pr.dryRun ? "warn" : "good"}>{pr.dryRun ? "Dry run" : "Opened"}</Badge>
        {pr.number && <span className="text-[0.85rem] text-white/50">#{pr.number}</span>}
        <span className="flex items-center gap-1.5 font-mono text-[0.75rem] text-white/50">
          <GitBranch className="size-3.5" />
          {pr.branch}
        </span>
        {pr.url && (
          <a href={pr.url} target="_blank" rel="noreferrer" className="ml-auto">
            <Button size="sm" variant="primary">
              Open on GitHub <ArrowUpRight />
            </Button>
          </a>
        )}
      </div>
      <div className="text-[1.1rem] font-semibold text-white">{pr.title}</div>
      <pre className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 font-sans text-[0.85rem] leading-relaxed whitespace-pre-wrap text-white/65">
        {pr.body}
      </pre>
      {pr.files.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[0.75rem] font-medium tracking-[0.14em] text-white/40 uppercase">Files ({pr.files.length})</div>
          {pr.files.map((f, i) => (
            <div key={f.path} className="overflow-hidden rounded-xl border border-white/[0.07]">
              <button
                onClick={() => setOpen(open === i ? -1 : i)}
                className="flex w-full items-center gap-2 bg-white/[0.03] px-3 py-2 text-left font-mono text-[0.78rem] text-white/75 hover:bg-white/[0.06]"
              >
                <FileCode className="size-3.5 text-white/40" />
                {f.path}
                <span className="ml-auto text-[#8ff0b2]/80">+{f.content.split("\n").length}</span>
              </button>
              {open === i && (
                <pre className="max-h-[18rem] overflow-auto bg-[#07090d] px-3 py-2 font-mono text-[0.72rem] leading-[1.5] text-[#b7f5cd]/85 scrollbar-thin">
                  {f.content
                    .split("\n")
                    .map((l) => `+ ${l}`)
                    .join("\n")}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PrModal({ pr, onClose }: { pr?: PullRequestResult; onClose: () => void }) {
  return (
    <Modal open={Boolean(pr)} onClose={onClose} title="Pull request" icon={<GitPullRequest />} className="max-w-[46rem]">
      {pr && <PrBody pr={pr} />}
    </Modal>
  );
}

const CONNECT_STEPS = ["Reading the repository", "Generating the analytics install", "Opening a pull request"];

export function ConnectRepoModal({
  open,
  onClose,
  status,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  status?: GithubStatusResponse;
  onConnected: (pr: PullRequestResult) => void;
}) {
  const api = useApi();
  const [url, setUrl] = useState("https://github.com/pace-running/storefront");
  const [busy, setBusy] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullRequestResult | null>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStepIdx((i) => Math.min(CONNECT_STEPS.length - 1, i + 1)), 700);
    return () => clearInterval(t);
  }, [busy]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStepIdx(0);
    setError(null);
    setResult(null);
    try {
      const pr = await api.connectRepo(url.trim());
      setResult(pr);
      onConnected(pr);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={result ? "Analytics install PR" : "Connect your store"}
      icon={<GithubMark className="size-[1.1rem] text-white" />}
      className="max-w-[44rem]"
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Start watching shoppers
          </Button>
        ) : undefined
      }
    >
      {!result ? (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <p className="text-[0.95rem] leading-relaxed text-white/60">
            Darwin opens a pull request that installs analytics for <b className="text-white/85">humans</b> and{" "}
            <b className="text-white/85">AI shopping agents</b>. After that it watches, experiments and ships improvements as PRs you review.
          </p>
          {status?.repo && (
            <div className="flex items-center gap-2 rounded-xl border border-brand/25 bg-brand/[0.05] px-3 py-2 text-[0.85rem] text-white/75">
              <Check className="size-4 text-brand" /> Connected to <b>{status.repo}</b>
              {!status.configured && <span className="text-white/40">(dry run: no GITHUB_TOKEN)</span>}
            </div>
          )}
          <label className="flex flex-col gap-2">
            <span className="text-[0.78rem] font-medium tracking-[0.12em] text-white/45 uppercase">Repository URL</span>
            <input
              data-autofocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/acme/storefront"
              className="h-12 rounded-xl border border-white/10 bg-white/[0.04] px-4 font-mono text-[0.9rem] text-white outline-none placeholder:text-white/25 focus:border-brand/50 focus:bg-white/[0.06]"
            />
          </label>
          <AnimatePresence>
            {busy && (
              <motion.ol initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-2">
                {CONNECT_STEPS.map((s, i) => (
                  <li key={s} className={cn("flex items-center gap-2 text-[0.88rem]", i <= stepIdx ? "text-white/80" : "text-white/30")}>
                    {i < stepIdx ? (
                      <Check className="size-4 text-brand" />
                    ) : i === stepIdx ? (
                      <LoaderCircle className="size-4 animate-spin text-brand" />
                    ) : (
                      <span className="size-4 rounded-full border border-white/15" />
                    )}
                    {s}
                  </li>
                ))}
              </motion.ol>
            )}
          </AnimatePresence>
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad/[0.08] px-3 py-2 text-[0.85rem] text-[#ffb4b4]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.78rem] text-white/35">Without a GITHUB_TOKEN this runs as a dry run and shows the would-be PR.</span>
            <Button type="submit" variant="primary" size="lg" disabled={busy || !url.trim()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <GitPullRequest />}
              Connect & open PR
            </Button>
          </div>
        </form>
      ) : (
        <PrBody pr={result} />
      )}
    </Modal>
  );
}

export function ConfirmResetModal({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset Darwin to Gen 0?"
      icon={<TriangleAlert />}
      className="max-w-[30rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} data-autofocus>
            Reset
          </Button>
        </>
      }
    >
      <p className="text-[0.95rem] leading-relaxed text-white/60">
        Clears events, experiments, generation history and the live spec. The store goes back to its baseline configuration.
      </p>
    </Modal>
  );
}
