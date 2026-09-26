"use client";

/**
 * How a chat reads: short bubbles with the sender's mascot and name, progress as a compact timeline,
 * tool results as small cards, confirmations with Confirm / Cancel, and Darwin's report-back highlighted.
 */
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import type { AgentId, TeamAgent } from "@/lib/contracts";
import { Mascot } from "@/components/console/mascot";
import { cn } from "@/components/ui/cn";
import { friendlyNote, lookFor, toolLabel } from "./roster";
import type { LiveProgress, UiMessage } from "./team-state";

export const INK = "#141413";

/* ------------------------------------------------------------------ text */

/** Inline formatting for agent text: **bold** and [links](/path). Anything else stays plain. */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) parts.push(<strong key={m.index} className="font-semibold">{m[1]}</strong>);
    else parts.push(<SmartLink key={m.index} href={m[3]} className="underline underline-offset-2">{m[2]}</SmartLink>);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

function Paragraphs({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
          return (
            <ul key={i} className="m-0 flex list-disc flex-col gap-0.5 pl-4">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*[-•]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="m-0">
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

/** Internal links route in place; outside links open a new tab. Anything else renders as text. */
export function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return <span>{children}</span>;
}

function Pill({ children, tone }: { children: ReactNode; tone: "warn" | "win" | "sand" }) {
  const s = tone === "warn" ? "bg-[#FBE7D3] text-[#B8621B]" : tone === "win" ? "bg-[#DDF3E8] text-[#137A52]" : "bg-[#F3EDE0] text-[#4A463D]";
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium", s)}>{children}</span>;
}

/* ------------------------------------------------------------------ list */

export interface MessageListProps {
  messages: UiMessage[];
  agents: TeamAgent[];
  /** Live progress of agents working in this chat right now. */
  live: LiveProgress[];
  /** Who's typing (a request is in flight and nobody has shown progress yet). */
  thinking?: AgentId;
  busy: boolean;
  onConfirm: (message: UiMessage, approved: boolean) => void;
}

export function MessageList({ messages, agents, live, thinking, busy, onConfirm }: MessageListProps) {
  const rows: ReactNode[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    if (m.kind === "progress") {
      // Consecutive progress updates read as one small timeline.
      const run: UiMessage[] = [];
      while (i < messages.length && messages[i].kind === "progress") run.push(messages[i++]);
      i--;
      rows.push(<Timeline key={m.id} items={run} agents={agents} />);
      continue;
    }
    if (m.from === "user") {
      if (m.kind === "confirm" || !m.text.trim()) continue;
      rows.push(
        <div key={m.id} className="max-w-[85%] self-end rounded-[18px_18px_6px_18px] px-4 py-2.5 text-[15px] leading-[1.45] break-words text-white sm:max-w-[70%]" style={{ background: INK }}>
          {m.text}
        </div>,
      );
      continue;
    }
    const look = lookFor(agents, m.from);
    const showHead = !(prev && prev.from === m.from && prev.kind === "text" && m.kind === "text");
    switch (m.kind) {
      case "report":
        rows.push(<ReportCard key={m.id} message={m} agents={agents} />);
        break;
      case "tool":
        rows.push(<ToolCard key={m.id} message={m} agents={agents} />);
        break;
      case "confirm":
        rows.push(<ConfirmCard key={m.id} message={m} agents={agents} busy={busy} onAnswer={(ok) => onConfirm(m, ok)} />);
        break;
      case "navigate":
        rows.push(
          <p key={m.id} className="m-0 flex items-center gap-2 text-[13px] text-[#6B665A]">
            <Mascot kind={look.mascot} size={18} interactive={false} />
            <span>
              {look.name} {m.text ? <Inline text={m.text} /> : "opened a page for you"}
            </span>
            {m.link && (
              <SmartLink href={m.link.href} className="font-medium text-[#141413] underline underline-offset-2">
                {m.link.label}
              </SmartLink>
            )}
          </p>,
        );
        break;
      default:
        rows.push(
          <div key={m.id} className={cn("flex max-w-[88%] flex-col gap-1 sm:max-w-[78%]", showHead ? "mt-1" : "-mt-1.5")}>
            {showHead && (
              <div className="flex items-center gap-1.5 pl-0.5">
                <Mascot kind={look.mascot} size={22} interactive={false} />
                <span className="text-[13px] font-semibold">{look.name}</span>
              </div>
            )}
            <div
              className={cn(
                "flex flex-col gap-2 self-start rounded-[6px_18px_18px_18px] px-4 py-2.5 text-[15px] leading-[1.45] break-words",
                m.error && "bg-[#FBE7D3] text-[#8A4A15]",
              )}
              style={m.error ? undefined : { background: look.tint }}
            >
              <Paragraphs text={m.text} />
            </div>
          </div>,
        );
    }
  }

  return (
    <div className="flex flex-col gap-3" aria-live="polite" aria-relevant="additions">
      {rows}
      {live.map((p) => (
        <LiveRow key={p.agent} progress={p} agents={agents} />
      ))}
      {thinking && !live.length && <TypingRow agent={thinking} agents={agents} />}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Timeline({ items, agents }: { items: UiMessage[]; agents: TeamAgent[] }) {
  return (
    <ol className="m-0 flex list-none flex-col p-0 pl-1">
      {items.map((m, i) => {
        const look = lookFor(agents, m.from as AgentId);
        return (
          <li key={m.id} className="relative flex items-start gap-2.5 pb-1.5 last:pb-0">
            {i < items.length - 1 && <span aria-hidden className="absolute top-[18px] bottom-0 left-[8px] w-px bg-[#E4DBC7]" />}
            <Mascot kind={look.mascot} size={18} interactive={false} className="mt-px" />
            <p className="m-0 min-w-0 text-[13px] leading-[1.45] text-[#5C574B]">
              <span className="font-medium text-[#141413]">{look.name}</span> {m.text}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function LiveRow({ progress, agents }: { progress: LiveProgress; agents: TeamAgent[] }) {
  const look = lookFor(agents, progress.agent);
  const pct = progress.total ? Math.min(100, Math.max(6, (progress.step / progress.total) * 100)) : undefined;
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-[#F7F1E5] px-3 py-2" role="status">
      <Mascot kind={look.mascot} state="working" size={26} interactive={false} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 truncate text-[13px] text-[#4A463D]">
          <span className="font-semibold text-[#141413]">{look.name}</span> {friendlyNote(progress.label, look.name)}
        </p>
        {pct !== undefined && (
          <div className="h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-[#E8DFCC]" aria-hidden>
            <div className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%`, background: look.color }} />
          </div>
        )}
      </div>
      {progress.total ? (
        <span className="shrink-0 text-[12px] text-[#6B665A] tabular-nums">
          {Math.min(progress.step, progress.total)} of {progress.total}
        </span>
      ) : null}
    </div>
  );
}

function TypingRow({ agent, agents }: { agent: AgentId; agents: TeamAgent[] }) {
  const look = lookFor(agents, agent);
  return (
    <div className="flex items-center gap-2" role="status" aria-label={`${look.name} is thinking`}>
      <Mascot kind={look.mascot} state="thinking" size={30} interactive={false} />
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((k) => (
          <span key={k} className="dw-typing size-1.5 rounded-full bg-[#8C8676]" style={{ animationDelay: `${k * 0.15}s` }} />
        ))}
      </span>
    </div>
  );
}

function ToolCard({ message: m, agents }: { message: UiMessage; agents: TeamAgent[] }) {
  const look = lookFor(agents, m.from as AgentId);
  const failed = m.ok === false;
  return (
    <div className={cn("flex max-w-[520px] flex-col gap-2 rounded-[16px] px-4 py-3 shadow-[0_0_0_1px_#EDE4D2]", failed ? "bg-[#FDF3EA]" : "bg-white")}>
      <div className="flex min-w-0 items-center gap-2">
        <Mascot kind={look.mascot} size={20} interactive={false} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{toolLabel(m.tool)}</span>
        {m.synthetic && <Pill tone="sand">practice data</Pill>}
        {failed ? <Pill tone="warn">didn&apos;t work</Pill> : <Check className="size-4 shrink-0 text-[#137A52]" aria-label="done" />}
      </div>
      {m.text && <p className="m-0 line-clamp-3 text-[13px] leading-[1.45] text-[#5C574B]">{m.text.replace(/^- /gm, "").replace(/\n+/g, " · ")}</p>}
      {m.link && (
        <SmartLink href={m.link.href} className="inline-flex h-8 items-center gap-1 self-start rounded-full bg-[#141413] px-3.5 text-[13px] font-medium text-white no-underline">
          {m.link.label}
          <ArrowUpRight className="size-3.5" />
        </SmartLink>
      )}
    </div>
  );
}

function ReportCard({ message: m, agents }: { message: UiMessage; agents: TeamAgent[] }) {
  const look = lookFor(agents, m.from as AgentId);
  return (
    <div className="flex flex-col gap-2 rounded-[20px] bg-[#ECE6FB] px-4 py-3.5 shadow-[inset_0_0_0_1px_#DCD2F6] sm:px-5">
      <div className="flex items-center gap-2">
        <Mascot kind={look.mascot} state="success" size={30} interactive={false} />
        <span className="text-[14px] font-semibold">{look.name} reported back</span>
      </div>
      <div className="flex flex-col gap-2 text-[15px] leading-[1.5]">
        <Paragraphs text={m.text} />
      </div>
      {m.link && (
        <SmartLink href={m.link.href} className="inline-flex h-8 items-center gap-1 self-start rounded-full bg-[#141413] px-3.5 text-[13px] font-medium text-white no-underline">
          {m.link.label}
          <ArrowUpRight className="size-3.5" />
        </SmartLink>
      )}
    </div>
  );
}

function ConfirmCard({ message: m, agents, busy, onAnswer }: { message: UiMessage; agents: TeamAgent[]; busy: boolean; onAnswer: (approved: boolean) => void }) {
  const pc = m.pendingConfirm;
  const look = lookFor(agents, (pc?.agent ?? m.from) as AgentId);
  const resolved = pc?.resolved;
  return (
    <div className="flex max-w-[520px] flex-col gap-2.5 rounded-[18px] bg-[#F3EDE0] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Mascot kind={look.mascot} state={resolved ? "idle" : "thinking"} size={24} interactive={false} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{toolLabel(pc?.tool ?? m.tool)}</span>
        {resolved ? <Pill tone={resolved === "approved" ? "win" : "sand"}>{resolved === "approved" ? "confirmed" : "cancelled"}</Pill> : <Pill tone="warn">needs your OK</Pill>}
      </div>
      <p className="m-0 text-[14px] leading-[1.45] text-[#4A463D]">{pc?.prompt ?? m.text}</p>
      {!!pc?.diff?.length && <Changes diff={pc.diff} />}
      {!resolved && pc && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(true)}
            className="flex h-9 items-center rounded-full bg-[#141413] px-4 text-[14px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413] disabled:opacity-40"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAnswer(false)}
            className="flex h-9 items-center rounded-full bg-white px-4 text-[14px] font-medium shadow-[0_0_0_1px_#E8DFCC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413] disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Pixel's pending code change: a one-line summary, with the lines themselves one click away. */
function Changes({ diff }: { diff: NonNullable<NonNullable<UiMessage["pendingConfirm"]>["diff"]> }) {
  const added = diff.reduce((n, f) => n + f.added, 0);
  const removed = diff.reduce((n, f) => n + f.removed, 0);
  return (
    <details className="group rounded-[12px] bg-white px-3 py-2 text-[13px] shadow-[0_0_0_1px_#E8DFCC]">
      <summary className="cursor-pointer list-none text-[#4A463D] marker:hidden [&::-webkit-details-marker]:hidden">
        Changes {diff.length === 1 ? "1 file" : `${diff.length} files`}{" "}
        <span className="text-[#137A52] tabular-nums">+{added}</span> <span className="text-[#B8621B] tabular-nums">−{removed}</span>
        <span className="ml-1.5 underline underline-offset-2 group-open:hidden">See the changes</span>
      </summary>
      <div className="mt-2 flex max-h-[240px] flex-col gap-2 overflow-auto">
        {diff.map((f) => (
          <div key={f.path} className="flex flex-col gap-1">
            <span className="font-medium break-all">
              {f.path} {f.created && <span className="font-normal text-[#6B665A]">(new)</span>}
            </span>
            <pre className="m-0 overflow-x-auto rounded-[8px] bg-[#F7F1E5] p-2 text-[12px] leading-[1.45] whitespace-pre" style={{ fontFamily: "var(--font-dm-mono), ui-monospace, monospace" }}>
              {f.preview}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
