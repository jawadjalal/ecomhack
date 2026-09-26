/**
 * Tiny GitHub-flavoured markdown renderer for PR bodies shown in the console.
 * Covers what Darwin's PR bodies use: headings, paragraphs, lists, tables, fenced code,
 * blockquotes with [!NOTE]/[!WARNING] callouts, inline code/bold/italic/links, <sub>, <br>.
 * No raw HTML is ever injected: everything renders as React elements.
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "quote"; callout?: string; lines: string[] }
  | { kind: "rule" };

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", lang: fence[1], code: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quoted.push(lines[i++].replace(/^>\s?/, ""));
      const callout = quoted[0]?.match(CALLOUT)?.[1]?.toUpperCase();
      blocks.push({ kind: "quote", callout, lines: callout ? quoted.slice(1) : quoted });
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const re = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ""));
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]) &&
      !(lines[i].trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? ""))
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

/** Inline markdown → React nodes. */
export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  // Order matters: code first (its contents are literal), then links, bold, italic, <sub>, <br>.
  const re = /(`[^`]+`)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w*])[*_]([^*_]+)[*_](?![\w*])|<sub>(.*?)<\/sub>|<br\s*\/?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(
        <code key={key++} className="rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[0.85em] text-white/80">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2] !== undefined) {
      const href = /^https?:\/\//.test(m[3]) ? m[3] : undefined;
      out.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noreferrer" className="text-brand underline-offset-2 hover:underline">
            <Inline text={m[2]} />
          </a>
        ) : (
          <span key={key++} className="text-brand">
            <Inline text={m[2]} />
          </span>
        ),
      );
    } else if (m[4] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold text-white/90">
          <Inline text={m[4]} />
        </strong>,
      );
    } else if (m[5] !== undefined) {
      out.push(
        <em key={key++}>
          <Inline text={m[5]} />
        </em>,
      );
    } else if (m[6] !== undefined) {
      out.push(
        <small key={key++} className="text-white/45">
          <Inline text={m[6]} />
        </small>,
      );
    } else {
      out.push(<br key={key++} />);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out.map((n, idx) => (typeof n === "string" ? <Fragment key={`t${idx}`}>{n}</Fragment> : n))}</>;
}

const CALLOUT_STYLE: Record<string, string> = {
  NOTE: "border-sky-400/40 bg-sky-400/[0.06] text-sky-100/80",
  TIP: "border-brand/40 bg-brand/[0.06] text-white/75",
  IMPORTANT: "border-violet-400/40 bg-violet-400/[0.06] text-violet-100/80",
  WARNING: "border-amber-400/40 bg-amber-400/[0.07] text-amber-100/85",
  CAUTION: "border-red-400/40 bg-red-400/[0.07] text-red-100/85",
};

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={cn("flex flex-col gap-3 text-[0.88rem] leading-relaxed text-white/65", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <div
                key={i}
                className={cn(
                  "font-semibold text-white/90",
                  b.level <= 1 ? "text-[1.15rem]" : b.level === 2 ? "mt-1 text-[1rem]" : "text-[0.92rem]",
                )}
              >
                <Inline text={b.text} />
              </div>
            );
          case "paragraph":
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case "rule":
            return <hr key={i} className="border-white/[0.08]" />;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={cn("flex flex-col gap-1 pl-5", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[0.78rem] leading-snug text-white/75">
                {b.code}
              </pre>
            );
          case "quote":
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg border-l-2 px-3 py-2",
                  b.callout ? CALLOUT_STYLE[b.callout] : "border-white/20 bg-white/[0.02] text-white/55",
                )}
              >
                {b.callout && <div className="mb-1 text-[0.72rem] font-semibold tracking-[0.12em] uppercase opacity-80">{b.callout}</div>}
                {b.lines.map((l, j) => (
                  <p key={j}>
                    <Inline text={l} />
                  </p>
                ))}
              </div>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-lg border border-white/[0.07]">
                <table className="w-full text-left text-[0.82rem]">
                  <thead className="bg-white/[0.04] text-white/80">
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} className="px-3 py-1.5 font-medium">
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j} className="border-t border-white/[0.05]">
                        {r.map((c, k) => (
                          <td key={k} className="px-3 py-1.5">
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
