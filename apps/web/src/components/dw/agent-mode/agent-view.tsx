"use client";

/**
 * Agent mode: the same console page as a machine-readable document for an AI agent browsing it.
 *   01 What's on this page  — the page's key data (same SWR hooks as the page), rows + <pre id="darwin-page-state">
 *   02 What you can do here — page-relevant commands from the registry, with every way to call them
 *   03 How to connect       — MCP one-liner, llms.txt
 * Plus <script type="application/json" id="darwin-page-manifest"> (state + commands) for agents that read the DOM.
 */
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { PAGES, inputJsonSchema, pageOf, specOf, validateStep, type CommandName, type CommandResult, type PageKey } from "@/lib/commands";
import { roadmapFor } from "@/lib/status/roadmap";
import { useCommandRuntime, useWebMcpAvailable } from "../command";
import { suggestionsFor } from "../command/suggest";
import { useDarwin } from "../provider";
import { setViewMode } from "./mode";
import { usePageState, type StateBlock } from "./page-state";

/** Commands a page's own UI does, beyond the ⌘K suggestions (which only carry steps for some). */
const PAGE_EXTRA: Partial<Record<PageKey, CommandName[]>> = {
  overview: ["ask_darwin", "send_shopper"],
  issues: ["open_issue", "ask_darwin"],
  fixes: ["watch_fix"],
  changes: ["rollback"],
  dashboards: ["build_dashboard"],
  personalize: ["draft_personalization"],
  agents: ["start_agent_test", "set_agent_autopilot"],
  traffic: ["simulate_traffic"],
  onboarding: ["check_install", "detect_platform"],
};

interface PageCommand {
  name: CommandName;
  title: string;
  description: string;
  risk: "safe" | "confirm";
  readOnly: boolean;
  input: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  call: { browser: string; webmcp: string; mcp: string; cli: string };
}

const json1 = (v: unknown) => JSON.stringify(v);

function cliFor(name: CommandName, input: Record<string, unknown>, confirm: boolean): string {
  const flat = Object.values(input).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v));
  const q = (s: string) => (/^[\w.:/-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
  const args = flat
    ? Object.entries(input).map(([k, v]) => `--${k.replace(/_/g, "-")} ${q(String(v))}`)
    : [`--json ${q(JSON.stringify(input))}`];
  return ["npm run darwin -- run", name, ...args, ...(confirm ? ["--yes"] : [])].join(" ");
}

function exampleInput(name: CommandName, given?: Record<string, unknown>): Record<string, unknown> {
  const candidates = [given, specOf(name).examples[0]?.input as Record<string, unknown> | undefined, {}];
  for (const c of candidates) if (c && validateStep(name, c).ok) return c;
  return {};
}

function usePageCommands(page: PageKey | undefined, origin: string, autopilot: boolean): PageCommand[] {
  return useMemo(() => {
    const seen = new Map<CommandName, Record<string, unknown> | undefined>();
    const add = (n: CommandName, input?: Record<string, unknown>) => {
      if (!seen.has(n)) seen.set(n, input);
    };
    const sugg = suggestionsFor(page, { autopilot, recent: [] });
    for (const s of sugg.filter((x) => x.group === "here")) for (const st of s.steps ?? []) add(st.command, st.input);
    for (const n of PAGE_EXTRA[page ?? "overview"] ?? []) add(n);
    for (const s of sugg.filter((x) => x.group === "do")) for (const st of s.steps ?? []) add(st.command, st.input);
    const other = sugg.find((s) => s.group === "go")?.steps?.[0];
    add("navigate", other?.input);
    add("whats_left", page ? { area: roadmapFor(PAGES[page].href)?.key } : undefined);

    return [...seen.entries()].map(([name, given]) => {
      const s = specOf(name);
      const input = exampleInput(name, given && Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)));
      const confirm = s.risk === "confirm";
      const mcpArgs = confirm ? { ...input, confirm: true } : input;
      return {
        name,
        title: s.title,
        description: s.description,
        risk: s.risk,
        readOnly: !!s.readOnly,
        input,
        inputSchema: inputJsonSchema(name),
        call: {
          browser: `await window.darwin.run(${json1(name)}, ${json1(input)})`,
          webmcp: `darwin_${name}`,
          mcp: `curl -s -X POST ${origin}/api/darwin/mcp -H 'content-type: application/json' -d '${json1({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: `darwin_${name}`, arguments: mcpArgs } })}'`,
          cli: cliFor(name, input, confirm),
        },
      };
    });
  }, [page, origin, autopilot]);
}

/* ------------------------------------------------------------------ bits */

function Copy({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
      className="shrink-0 rounded-full px-2 py-0.5 font-dwmono text-[11px] text-dw-muted ring-1 ring-dw-hairline transition-colors hover:bg-dw-sand hover:text-dw-ink"
    >
      {done ? "copied" : label}
    </button>
  );
}

function SectionHead({ n, id, title, sub }: { n: string; id: string; title: string; sub: string }) {
  return (
    <div className="md:sticky md:top-6 md:self-start">
      <p className="font-dwmono text-[11px] tracking-[0.14em] text-dw-muted uppercase">§ {n}</p>
      <h2 id={id} className="mt-1 text-[19px] leading-tight font-medium tracking-[-0.01em]">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[26ch] text-[13px] leading-snug text-dw-muted">{sub}</p>
    </div>
  );
}

function Block({ b }: { b: StateBlock }) {
  return (
    <div>
      <h3 className="font-dwmono text-[12px] tracking-[0.06em] text-dw-ink uppercase">{b.heading}</h3>
      {b.rows.length ? (
        <dl className="mt-2 divide-y divide-dw-hairline border-y border-dw-hairline">
          {b.rows.map((r, i) => (
            <div key={`${r.key}-${i}`} className="grid gap-x-4 py-1.5 sm:grid-cols-[150px_1fr]">
              <dt className="truncate font-dwmono text-[12px] text-dw-muted">{r.key}</dt>
              <dd className="text-[13.5px] leading-snug break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 border-y border-dw-hairline py-1.5 font-dwmono text-[12px] text-dw-muted">{b.empty ?? "–"}</p>
      )}
    </div>
  );
}

function CallLine({ via, code }: { via: string; code: string }) {
  return (
    <div className="grid grid-cols-[64px_1fr_auto] items-start gap-2 py-1">
      <span className="pt-px font-dwmono text-[11px] text-dw-muted">{via}</span>
      <code className="min-w-0 font-dwmono text-[12px] leading-[1.55] break-all text-dw-ink">{code}</code>
      <Copy text={code} />
    </div>
  );
}

function CommandRow({ c, onRun, result, busy, webmcp }: { c: PageCommand; onRun: () => void; result?: CommandResult; busy: boolean; webmcp: boolean }) {
  return (
    <li data-command={c.name} data-risk={c.risk} className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-dwmono text-[14px] font-medium text-dw-ink">{c.name}</h3>
        <span className="text-[13px] text-dw-muted">{c.title}</span>
        <span
          className={`rounded-full px-2 py-px font-dwmono text-[10.5px] tracking-[0.04em] uppercase ring-1 ${
            c.risk === "confirm" ? "bg-dw-warn-bg text-dw-warn ring-dw-warn/25" : "bg-dw-win-bg text-dw-win ring-dw-win/20"
          }`}
        >
          {c.risk === "confirm" ? "confirm · asks the merchant" : "safe"}
        </span>
        {c.readOnly && <span className="font-dwmono text-[10.5px] tracking-[0.04em] text-dw-muted uppercase">read-only</span>}
        <button
          type="button"
          onClick={onRun}
          disabled={busy}
          data-run={c.name}
          className="ml-auto h-8 rounded-full bg-dw-ink px-3.5 font-dwmono text-[12px] text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {busy ? "running…" : c.risk === "confirm" ? "run (asks first)" : "run"}
        </button>
      </div>
      <p className="mt-1.5 max-w-[80ch] text-[13.5px] leading-snug text-dw-ink/80">{c.description}</p>
      <div className="mt-2.5 divide-y divide-dw-hairline/70 rounded-[14px] bg-dw-bg px-3 py-1 ring-1 ring-dw-hairline">
        <CallLine via="browser" code={c.call.browser} />
        <CallLine via="webmcp" code={`${c.call.webmcp}${webmcp ? "" : "  (registered when navigator.modelContext exists)"}`} />
        <CallLine via="mcp" code={c.call.mcp} />
        <CallLine via="cli" code={c.call.cli} />
      </div>
      <details className="group mt-2">
        <summary className="cursor-pointer font-dwmono text-[11.5px] text-dw-muted select-none hover:text-dw-ink">input schema</summary>
        <pre className="mt-1.5 max-h-72 overflow-auto rounded-[12px] bg-dw-bg p-3 font-dwmono text-[11.5px] leading-[1.5] ring-1 ring-dw-hairline">{JSON.stringify(c.inputSchema, null, 2)}</pre>
      </details>
      {result && (
        <p role="status" data-result={result.ok ? "ok" : "error"} className={`mt-2 font-dwmono text-[12px] ${result.ok ? "text-dw-win" : "text-dw-warn"}`}>
          {result.ok ? "→ " : "✕ "}
          {result.text}
          {result.synthetic ? " (includes simulated traffic)" : ""}
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ the view */

export function AgentView() {
  const pathname = usePathname() ?? "/console";
  const page = pageOf(pathname);
  const { mock, autopilot } = useDarwin();
  const rt = useCommandRuntime();
  const webmcp = useWebMcpAvailable();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const state = usePageState(page, pathname);
  const commands = usePageCommands(page, origin, autopilot);
  const [results, setResults] = useState<Record<string, CommandResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const title = page ? PAGES[page].label : "This page";
  const stateJson = useMemo(() => JSON.stringify({ ...state.json, source: mock ? "mock (in-browser demo engine, ?mock=1)" : "live API" }, null, 2), [state.json, mock]);
  const mcpUrl = `${origin}/api/darwin/mcp`;
  const connect = {
    claude_code: `claude mcp add --transport http darwin ${mcpUrl}`,
    cursor: json1({ mcpServers: { darwin: { url: mcpUrl } } }),
    llms_txt: `${origin}/llms.txt`,
  };
  const manifestJson = useMemo(
    () =>
      JSON.stringify({
        schema: "darwin.page-manifest/1",
        page: { key: page ?? null, title, url: `${origin}${pathname}` },
        state: JSON.parse(stateJson),
        commands: commands.map(({ name, title: t, description, risk, readOnly, input, inputSchema, call }) => ({ name, title: t, description, risk, readOnly, exampleInput: input, inputSchema, call })),
        connect: { mcp: { endpoint: mcpUrl, transport: "http", method: "tools/call", toolPrefix: "darwin_" }, ...connect },
      }).replace(/</g, "\\u003c"),
    // connect is derived from mcpUrl/origin
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, title, origin, pathname, stateJson, commands, mcpUrl],
  );

  async function run(c: PageCommand) {
    if (!rt) return;
    setBusy(c.name);
    try {
      const r = await rt.runOne(c.name, c.input, "api");
      setResults((m) => ({ ...m, [c.name]: r }));
    } catch (err) {
      setResults((m) => ({ ...m, [c.name]: { ok: false, text: err instanceof Error ? err.message : String(err) } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article data-agent-view={page ?? "page"} aria-labelledby="dw-agent-title" className="w-full rounded-[26px] bg-dw-surface ring-1 ring-dw-hairline">
      <script type="application/json" id="darwin-page-manifest" dangerouslySetInnerHTML={{ __html: manifestJson }} />

      {/* masthead */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-dw-hairline px-5 py-3 sm:px-8">
        <span className="font-dwmono text-[11px] tracking-[0.14em] text-dw-muted uppercase">machine view</span>
        <span className="font-dwmono text-[12px] text-dw-ink">{pathname}</span>
        <span className="font-dwmono text-[11px] text-dw-muted">
          {commands.length} commands · {mock ? "mock data" : "live data"} · {state.loading ? "loading" : "ready"}
        </span>
        <button
          type="button"
          onClick={() => setViewMode("human")}
          className="ml-auto h-8 rounded-full px-3 font-dwmono text-[12px] text-dw-ink ring-1 ring-dw-hairline transition-colors hover:bg-dw-sand"
        >
          ← human view
        </button>
      </header>

      <div className="px-5 pt-7 pb-3 sm:px-8">
        <h1 id="dw-agent-title" className="text-[34px] leading-none font-medium tracking-[-0.02em] max-sm:text-[28px]">
          {title}
        </h1>
        <p className="mt-2.5 max-w-[72ch] text-[14px] leading-snug text-dw-muted">
          You are reading Darwin&rsquo;s console as an agent. Everything a person sees on this page is below as text and JSON, followed by
          the commands this page offers and exactly how to call them. Confirm-risk commands always stop for the merchant.
        </p>
      </div>

      {/* 01 */}
      <section aria-labelledby="dw-agent-state" className="grid gap-6 border-t border-dw-hairline px-5 py-7 sm:px-8 md:grid-cols-[220px_1fr]">
        <SectionHead n="01" id="dw-agent-state" title="What's on this page" sub="The page's data, from the same live endpoints the page polls." />
        <div className="flex min-w-0 flex-col gap-5">
          {state.blocks.map((b) => (
            <Block key={b.heading} b={b} />
          ))}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-dwmono text-[12px] tracking-[0.06em] uppercase">JSON</h3>
              <code className="font-dwmono text-[11px] text-dw-muted">#darwin-page-state</code>
              <span className="ml-auto">
                <Copy text={stateJson} label="copy json" />
              </span>
            </div>
            <pre id="darwin-page-state" className="mt-2 max-h-[420px] overflow-auto rounded-[14px] bg-dw-bg p-4 font-dwmono text-[12px] leading-[1.55] text-dw-ink ring-1 ring-dw-hairline">
              {stateJson}
            </pre>
          </div>
        </div>
      </section>

      {/* 02 */}
      <section aria-labelledby="dw-agent-do" className="grid gap-6 border-t border-dw-hairline px-5 py-7 sm:px-8 md:grid-cols-[220px_1fr]">
        <SectionHead n="02" id="dw-agent-do" title="What you can do here" sub="Commands from Darwin's registry, most relevant to this page first." />
        <ul className="min-w-0 divide-y divide-dw-hairline border-y border-dw-hairline">
          {commands.map((c) => (
            <CommandRow key={c.name} c={c} webmcp={webmcp} busy={busy === c.name} result={results[c.name]} onRun={() => void run(c)} />
          ))}
        </ul>
      </section>

      {/* 03 */}
      <section aria-labelledby="dw-agent-connect" className="grid gap-6 border-t border-dw-hairline px-5 py-7 sm:px-8 md:grid-cols-[220px_1fr]">
        <SectionHead n="03" id="dw-agent-connect" title="How to connect" sub="Drive Darwin from your own agent, outside this tab." />
        <div className="min-w-0 divide-y divide-dw-hairline/70 rounded-[14px] bg-dw-bg px-3 py-1 ring-1 ring-dw-hairline">
          <CallLine via="claude" code={connect.claude_code} />
          <CallLine via="cursor" code={connect.cursor} />
          <div className="grid grid-cols-[64px_1fr] items-start gap-2 py-1.5">
            <span className="font-dwmono text-[11px] text-dw-muted">llms.txt</span>
            <a href="/llms.txt" className="font-dwmono text-[12px] break-all text-dw-ink underline decoration-dw-hairline underline-offset-4 hover:decoration-dw-ink">
              {connect.llms_txt}
            </a>
          </div>
          <div className="grid grid-cols-[64px_1fr] items-start gap-2 py-1.5">
            <span className="font-dwmono text-[11px] text-dw-muted">manifest</span>
            <code className="font-dwmono text-[12px] break-all">document.getElementById(&quot;darwin-page-manifest&quot;).textContent</code>
          </div>
        </div>
      </section>
    </article>
  );
}
