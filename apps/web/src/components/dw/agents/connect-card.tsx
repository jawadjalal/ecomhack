"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { Catalog } from "@/lib/store-agent";
import { cn } from "@/components/ui/cn";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { WhopLogo } from "@/components/dw/brand-logos";
import { Card, CardTitle, Tag } from "@/components/dw/ui";
import { money } from "./sales-card";

const WORKS_WITH = ["chatgpt", "claude", "perplexity", "gemini", "grok", "copilot"];

function useCopy() {
  const [copied, setCopied] = useState<string>();
  const copy = (key: string, text: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(undefined), 1200);
      })
      .catch(() => undefined);
  return { copied, copy };
}

/** Connect any AI agent: the A2A endpoint, the agent card, and a curl to try it. */
export function ConnectCard({ endpoint }: { endpoint: string }) {
  const { copied, copy } = useCopy();
  const curl = `curl -s ${endpoint} -H 'content-type: application/json' -H 'x-agent-name: my-agent' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"role":"ROLE_USER","messageId":"m1","parts":[{"text":"coaching under £40 a month"}]}}}'`;
  return (
    <Card tone="blue" shape="observer" corner="tr" className="min-w-0">
      <CardTitle>Connect any AI agent</CardTitle>
      <p className="mt-1.5 text-[14px] leading-snug text-dw-ink/75">
        Shoppers&apos; agents talk to your store here, get real offers, and buy through a checkout link that credits them.
      </p>
      <div className="mt-3 flex items-center gap-1.5" aria-label="Works with ChatGPT, Claude, Perplexity, Gemini, Grok, Copilot and your own agent">
        {WORKS_WITH.map((k) => (
          <AgentTile key={k} brand={agentBrand(k)} size={28} className="transition-transform hover:-translate-y-0.5 hover:-rotate-6" />
        ))}
        <span className="ml-1 text-[12.5px] text-dw-ink/65">and your own</span>
      </div>

      <div className="mt-4 flex h-12 items-center gap-2 rounded-full bg-white/75 pr-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate font-dwmono text-[13px]" title={endpoint}>
          {endpoint}
        </span>
        <button
          type="button"
          onClick={() => copy("endpoint", endpoint)}
          aria-label="Copy endpoint"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-dw-ink text-white transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink active:scale-95"
        >
          {copied === "endpoint" ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <a
        href="/a2a/whop/agent-card.json"
        target="_blank"
        rel="noreferrer"
        className="mt-2.5 inline-flex items-center gap-1 text-[13px] text-dw-ink/75 underline-offset-2 hover:text-dw-ink hover:underline"
      >
        Agent card (A2A v1.0 and v0.3) <ExternalLink className="size-3.5" />
      </a>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-medium">Try it from a terminal</span>
        <button
          type="button"
          onClick={() => copy("curl", curl)}
          aria-label="Copy curl command"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/70 px-3 text-[12.5px] font-medium transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-ink"
        >
          {copied === "curl" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied === "curl" ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-[18px] bg-dw-ink p-4 font-dwmono text-[11.5px] leading-relaxed whitespace-pre text-[#EDE6D6]">{curl}</pre>
    </Card>
  );
}

/** What it sells: the catalog the agent pitches from (Whop plans, or the labelled demo catalog). */
export function OffersCard({ catalog }: { catalog?: Catalog }) {
  return (
    <Card tone="white" shape="designer" corner="br" className="min-w-0">
      <CardTitle right={catalog && `${catalog.offers.length} offer${catalog.offers.length === 1 ? "" : "s"}`}>What it sells</CardTitle>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] text-dw-ink/65">
        {catalog?.source === "whop" ? (
          <>
            <WhopLogo size={14} /> Plans from {catalog.business} on Whop. Payments happen on Whop.
          </>
        ) : (
          <>Demo offers until a Whop business is connected.</>
        )}
      </p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {!catalog &&
          [0, 1, 2].map((i) => <li key={i} className="h-[62px] animate-pulse rounded-[18px] bg-dw-sand/70 motion-reduce:animate-none" aria-hidden />)}
        {catalog?.offers.map((o) => (
          <li key={o.id} className={cn("dw-row rounded-[18px] bg-dw-sand/70 px-4 py-3", !o.available && "opacity-60")}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14.5px] font-semibold">{o.title}</span>
              <span className="num shrink-0 font-dwmono text-[13px]">
                {o.price === 0 ? "Free" : money(o.price, o.currency)}
                {o.billing !== "one_time" && <span className="text-dw-ink/50">/{o.billing}</span>}
              </span>
            </div>
            {(o.description || !o.available) && (
              <div className="mt-0.5 flex items-center gap-2 text-[13px] leading-snug text-dw-ink/65">
                <span className="min-w-0 line-clamp-2">{o.description}</span>
                {!o.available && <Tag className="h-5 text-[11px]">Unavailable</Tag>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
