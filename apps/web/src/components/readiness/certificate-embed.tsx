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
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- the badge is a dynamic SVG endpoint */}
          <img src={`/api/readiness/badge/${certId}`} alt={`Darwin agent-ready: ${levelLabel}`} height={20} className="h-5 w-auto" />
          {!compact && <span className="text-[14px] text-dw-ink/65">Add the badge to your store&apos;s footer.</span>}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(snippet).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            });
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-dw-ink px-3 text-[13px] font-medium text-white transition-colors hover:bg-black"
        >
          {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? "Copied" : "Copy embed code"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-[14px] bg-dw-ink px-3.5 py-3 font-dwmono text-[12px] leading-snug whitespace-pre-wrap break-all text-[#9EE6B8]">
        {snippet}
      </pre>
    </div>
  );
}
