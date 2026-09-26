/**
 * The footer (Wayari's, as Darwin's): a night sheet laid over the closing painting, its top corners
 * lapping it. The links in plain columns beside the name and one line of what Darwin is; then the
 * name as wide as the page, with the crew on its letters (Iris, Ada and Max sitting on theirs, Theo
 * peeking from behind, Darwin as the dot of the i); then the base line. Every link goes somewhere that
 * answers. No signup form: there is no mailing list behind it yet.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import "./landing.css";

const README = "https://github.com/jawadjalal/ecomhack#readme";

const COLS: { title: string; rows: { label: string; href: string }[] }[] = [
  {
    title: "Darwin",
    rows: [
      { label: "Open Darwin", href: "/console" },
      { label: "Set up your store", href: "/onboarding" },
      { label: "Demo store", href: "/store" },
      { label: "Agent readiness", href: "/readiness" },
    ],
  },
  {
    title: "This page",
    rows: [
      { label: "How it works", href: "/#how" },
      { label: "The crew", href: "/#crew" },
      { label: "Questions", href: "/#questions" },
    ],
  },
  {
    title: "Learn",
    rows: [{ label: "Docs", href: README }],
  },
];

/** Who is on which letter of the name, and how. `x` is where along the letter, from its left, in percent. */
const PERCH: Record<number, { kind: MascotKind; pose: "sit" | "peek" | "dot" | "tall"; x: number }> = {
  0: { kind: "observer", pose: "tall", x: 30 },
  1: { kind: "designer", pose: "peek", x: 52 },
  2: { kind: "experimenter", pose: "sit", x: 40 },
  4: { kind: "analyst", pose: "dot", x: 50 },
  5: { kind: "shipper", pose: "sit", x: 56 },
};

const NAME = "darwin";

export function Footer() {
  let k = 0;
  return (
    <footer className="dwf relative z-[1] font-dw text-white/85">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] lg:gap-20">
        <div className="grid max-w-[360px] justify-items-start gap-4">
          <Link href="/" className="flex items-center gap-2.5 rounded-full text-[22px] font-semibold tracking-[-0.03em] text-white focus-visible:outline-2 focus-visible:outline-white">
            <Mascot kind="analyst" size={28} active={false} />
            darwin
          </Link>
          <p className="text-[15.5px] leading-relaxed text-white/65">A crew of agents that makes your store better, for people and for AI shoppers.</p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
          {COLS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-3.5 text-[13.5px] font-semibold text-dw-pink">{g.title}</h3>
              <ul className="grid gap-2.5">
                {g.rows.map((r) => {
                  const ext = /^https?:/.test(r.href);
                  const cls =
                    "inline-flex items-center gap-1 rounded-md text-[16px] font-medium text-white/90 transition-colors hover:text-dw-pink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
                  return (
                    <li key={r.href}>
                      {ext ? (
                        <a href={r.href} target="_blank" rel="noopener noreferrer" className={cls}>
                          {r.label}
                          <ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
                        </a>
                      ) : (
                        <Link href={r.href} className={cls}>
                          {r.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      {/* The name, drawn once for the eye; the mark above already says it to a screen reader. */}
      <div className="dwf-name mx-auto max-w-[1320px] px-5 sm:px-8" aria-hidden>
        <span className="dwf-word">
          {NAME.split("").map((ch, i) => {
            const p = PERCH[i];
            return (
              <span key={i} className="dwf-l">
                {p?.pose === "dot" ? "ı" : ch}
                {p ? (
                  <span className={`dwf-p is-${p.pose}`} style={{ "--k": k++, "--x": `${p.x}%` } as CSSProperties}>
                    <Mascot kind={p.kind} size={120} active={false} className="size-full" />
                  </span>
                ) : null}
              </span>
            );
          })}
        </span>
      </div>

      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/10 px-5 py-6 text-[14px] text-white/60 sm:px-8">
        <span>© 2026 Darwin</span>
        <span>Made at Cursor Commerce London 2026</span>
      </div>
    </footer>
  );
}
