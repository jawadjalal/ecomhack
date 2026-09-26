"use client";

/**
 * The crew: seven agents, one job each (Wayari's crew, as Darwin's). The five mascots wear the white
 * die-cut rim they wear on Wayari's desk; Mika and Grok, who are not mascots, get their brand tiles.
 * Under them, the AI shoppers Mika sells to.
 */
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { BrandGlyph, WhopLogo } from "@/components/dw/brand-logos";
import { CARD, H2, RIM, Reveal, Sel } from "./bits";

type Member = { name: string; role: string; line: string; face: ReactNode; tint: string; tilt: number };

const mascot = (kind: MascotKind) => <Mascot kind={kind} size={64} />;

const CREW: Member[] = [
  { name: "Darwin", role: "Lead", line: "Talks to you and runs the team. Ask it anything about your store.", face: mascot("leader"), tint: "bg-dw-lilac", tilt: -4 },
  { name: "Iris", role: "Watcher", line: "Finds where people and AI shoppers get stuck.", face: mascot("observer"), tint: "bg-dw-blue", tilt: 3 },
  { name: "Pixel", role: "Designer", line: "Drafts page changes from facts already on your page.", face: mascot("designer"), tint: "bg-dw-warn-bg", tilt: -3 },
  { name: "Fizz", role: "Tester", line: "Tests the new version against your current page and picks the winner.", face: mascot("experimenter"), tint: "bg-dw-pink", tilt: 4 },
  { name: "Dash", role: "Shipper", line: "Ships the winner as a code change, and can undo it in one click.", face: mascot("shipper"), tint: "bg-dw-win-bg", tilt: -3 },
  {
    name: "Mika",
    role: "Store agent",
    line: "Sells to AI shoppers on your Whop store, with a checkout link for each sale.",
    face: (
      <span className="grid size-16 place-items-center rounded-[20px] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_1px_rgba(20,20,19,0.08)]">
        <WhopLogo size={34} />
      </span>
    ),
    tint: "bg-dw-yellow",
    tilt: 3,
  },
  {
    name: "Grok",
    role: "Teammate",
    line: "Sends you a short briefing every morning.",
    face: (
      <span className="grid size-16 place-items-center rounded-[20px] bg-dw-ink text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]">
        <BrandGlyph brand="grok" size={32} />
      </span>
    ),
    tint: "bg-dw-sand",
    tilt: -4,
  },
];

const SHOPPERS = ["chatgpt", "claude", "gemini", "grok", "perplexity"] as const;

export function Crew() {
  return (
    <section id="crew" aria-labelledby="crew-title" className="relative scroll-mt-6 px-4 py-20 sm:px-7 sm:py-28">
      <div className="mx-auto max-w-[1240px]">
        <Reveal as="header" className="mx-auto max-w-[820px] text-center">
          <p className="text-[14px] font-medium text-dw-muted">The agents</p>
          <h2 id="crew-title" className={cn(H2, "mt-3")}>
            Meet <Sel tone="lilac">the crew.</Sel>
          </h2>
          <p className="mx-auto mt-4 max-w-[560px] text-[17px] leading-relaxed text-balance text-dw-ink/75 sm:text-[18px]">
            Seven agents, one job each. You talk to Darwin, and Darwin runs the rest.
          </p>
        </Reveal>

        <ul className="mt-14 grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-4">
          {CREW.map((m, i) => (
            <Reveal as="li" key={m.name} delay={(i % 4) * 0.06} className={cn(CARD, "dw-card group relative flex flex-col p-6")}>
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn("relative inline-grid place-items-center rounded-[24px] p-3 transition-transform duration-300 group-hover:rotate-0", m.tint)}
                  style={{ rotate: `${m.tilt}deg` }}
                >
                  <span className={cn(RIM, "inline-grid rounded-[22px]")}>{m.face}</span>
                </span>
                <span className="rounded-full bg-dw-sand px-2.5 py-1 text-[12.5px] font-medium text-dw-muted">{m.role}</span>
              </div>
              <h3 className="mt-5 text-[22px] font-semibold tracking-[-0.02em]">{m.name}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-dw-ink/75">{m.line}</p>
            </Reveal>
          ))}
          <Reveal as="li" delay={0.18} className="flex flex-col justify-center rounded-[28px] border border-dashed border-dw-hairline p-6 max-lg:min-[560px]:col-span-2 lg:col-span-1">
            <p className="text-[15px] leading-relaxed text-dw-ink/75">
              Every agent shows its work, so you can always see what each one did and why.
            </p>
          </Reveal>
        </ul>

        <Reveal className="mt-10 flex flex-col items-center gap-3 text-center">
          <p className="text-[16px] font-medium">Sells to ChatGPT, Claude, Gemini, Grok and Perplexity shoppers</p>
          <div className="flex items-center gap-2.5">
            {SHOPPERS.map((s) => (
              <AgentTile key={s} brand={agentBrand(s)} size={40} />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
