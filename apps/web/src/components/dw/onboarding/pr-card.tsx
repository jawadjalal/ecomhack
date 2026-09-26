"use client";

/** The install pull request, in the cream design (white card, mono branch line, black diff panel). */
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, ChevronDown, FileCode } from "lucide-react";
import type { PullRequestResult } from "@/lib/github";
import { cn } from "@/components/ui/cn";
import { Markdown } from "@/components/console/markdown";
import { Card, PillButton, Tag } from "@/components/dw/ui";
import { AnimatedMascot } from "@/components/mascots/animated-mascot";
import { EASE } from "./bits";

function notesOf(pr: PullRequestResult): string[] {
  const out = [...(pr.notes ?? [])];
  if (pr.upToDate) out.unshift("Already up to date: nothing to change, no PR opened.");
  if (pr.existing) out.unshift("An open PR for this branch already existed and was updated.");
  if (pr.detection?.label) out.unshift(`Detected: ${pr.detection.label}`);
  return out;
}

export function PrCard({ pr }: { pr: PullRequestResult }) {
  const files = pr.files ?? [];
  const [open, setOpen] = useState(0);
  const [body, setBody] = useState(false);
  const notes = notesOf(pr);
  const file = files[open];
  return (
    <motion.div initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: EASE }}>
      <Card tone="white" hover={false} className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2.5">
          <AnimatedMascot kind="shipper" size={40} title="Dash, shipper" flash={pr.upToDate ? undefined : { state: "success", key: "opened" }} className="-my-1.5" />
          <Tag tone={pr.upToDate ? "sand" : pr.dryRun ? "warn" : "win"}>{pr.upToDate ? "Up to date" : pr.dryRun ? "Preview (dry run)" : "Opened"}</Tag>
          {pr.number && <span className="num text-[14px] font-semibold">#{pr.number}</span>}
          {pr.url && (
            <PillButton tone="sand" size="sm" className="ml-auto" onClick={() => window.open(pr.url, "_blank", "noopener,noreferrer")}>
              View on GitHub <ArrowUpRight />
            </PillButton>
          )}
        </div>
        <h2 className="mt-3 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-balance">{pr.title}</h2>
        <p className="mt-1.5 font-dwmono text-[12.5px] break-all text-dw-ink/60">
          {pr.branch}
          {pr.base ? ` → ${pr.base}` : ""} · {files.length} {files.length === 1 ? "file" : "files"}
          {pr.dryRun ? " · dry run" : ""}
        </p>

        {notes.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 rounded-[18px] bg-dw-warn-bg px-4 py-3 text-[13.5px] text-dw-warn">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        {files.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-[20px] bg-dw-ink">
            <div className="flex gap-1 overflow-x-auto border-b border-white/[0.08] p-2" role="tablist" aria-label="Files in the pull request">
              {files.map((f, i) => (
                <button
                  key={f.path}
                  type="button"
                  role="tab"
                  aria-selected={i === open}
                  onClick={() => setOpen(i)}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-dwmono text-[12px] transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none",
                    i === open ? "bg-white/[0.14] text-white" : "text-white/55 hover:text-white",
                  )}
                >
                  <FileCode className="size-3.5" />
                  {f.path.split("/").pop()}
                  <span className="text-[#7FE0A8]">+{f.content.split("\n").length}</span>
                </button>
              ))}
            </div>
            {file && (
              <div className="max-h-[20rem] overflow-auto px-4 py-3">
                <div className="mb-2 font-dwmono text-[12px] text-white/45">{file.path}</div>
                <pre className="font-dwmono text-[12.5px] leading-[1.65] text-[#9EE6B8]">
                  {file.content
                    .split("\n")
                    .map((l) => `+ ${l}`)
                    .join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}

        {pr.body && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setBody((b) => !b)}
              aria-expanded={body}
              className="flex items-center gap-1.5 rounded text-[14px] font-medium text-dw-ink/70 hover:text-dw-ink focus-visible:ring-2 focus-visible:ring-dw-ink/30 focus-visible:outline-none"
            >
              What the pull request says <ChevronDown className={cn("size-4 transition-transform", body && "rotate-180")} />
            </button>
            {body && (
              <div className="mt-3 rounded-[20px] bg-dw-ink p-5">
                <Markdown source={pr.body} />
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
