"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** HTML a merchant pastes into their footer: the badge, linking to the public certificate. */
export function badgeEmbedHtml(base: string, certId: string, levelLabel: string): string {
  const b = base.replace(/\/$/, "");
  return `<a href="${b}/readiness/certificate/${certId}" target="_blank" rel="noopener"><img src="${b}/api/readiness/badge/${certId}" alt="Darwin agent-ready: ${levelLabel}" height="20"></a>`;
}

export function CertificateEmbed({ base, certId, levelLabel, compact = false }: { base?: string; certId: string; levelLabel: string; compact?: boolean }) {
  const origin = base ?? (typeof window === "undefined" ? "" : window.location.origin);
  const snippet = badgeEmbedHtml(origin, certId, levelLabel);
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- the badge is a dynamic SVG endpoint */}
          <img src={`/api/readiness/badge/${certId}`} alt={`Darwin agent-ready: ${levelLabel}`} height={20} className="h-5 w-auto" />
          {!compact && <span className="text-[0.84rem] text-white/50">Add the badge to your store&apos;s footer.</span>}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(snippet).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            });
          }}
          className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.72rem] text-white/70 hover:bg-white/[0.08] hover:text-white"
        >
          {done ? <Check className="size-3" /> : <Copy className="size-3" />} {done ? "Copied" : "Copy embed code"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-white/[0.07] bg-black/40 p-3 font-mono text-[0.72rem] leading-snug whitespace-pre-wrap break-all text-white/70">
        {snippet}
      </pre>
    </div>
  );
}
