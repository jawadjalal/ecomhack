"use client";

/**
 * Agent stickers: a handful of die-cut stickers of the AI shoppers (ChatGPT, Claude, Gemini, Grok,
 * Perplexity) and the Darwin mascot, pressed onto the landing's sky, in the margins around the words.
 * Decoration only (aria-hidden): small, slightly tilted, a slow idle float (off under reduced motion),
 * and on a computer the peel sticker's corner lifts when you point at one. Six on wide screens, two on
 * phones, none in between (where the margins are too narrow to stay clear of the text).
 */
import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { BrandGlyph, type BrandKey } from "../brand-logos";
import { Mascot } from "../mascot";
import "../gloss.css";

interface Spot {
  key: string;
  brand?: BrandKey;
  /** Sticker paper colour: dw pastels. */
  face: string;
  tilt: number;
  size: number;
  pos: CSSProperties;
  /** Where it shows. */
  show: string;
}

const XL = "max-xl:hidden";
const WIDE = "max-[1400px]:hidden";
const PHONE = "sm:hidden";

const SPOTS: Spot[] = [
  // wide screens: the sky either side of the headline and buttons
  { key: "openai", brand: "openai", face: "#ddf3e8", tilt: -8, size: 56, pos: { left: "9%", top: 150 }, show: XL },
  { key: "claude", brand: "claude", face: "#fbe7d3", tilt: 10, size: 52, pos: { left: "20%", top: 262 }, show: XL },
  { key: "gemini", brand: "gemini", face: "#b8caee", tilt: 7, size: 54, pos: { right: "10%", top: 118 }, show: XL },
  { key: "grok", brand: "grok", face: "#f6d76b", tilt: -11, size: 48, pos: { right: "19%", top: 268 }, show: XL },
  // very wide: beside the dashboard preview
  { key: "perplexity", brand: "perplexity", face: "#d5ccf5", tilt: 6, size: 50, pos: { left: "3.4%", top: 540 }, show: WIDE },
  { key: "mascot", face: "#f3b5d5", tilt: -6, size: 56, pos: { right: "3.2%", top: 470 }, show: WIDE },
  // phones: two, small, clear of the left-aligned headline
  { key: "claude-m", brand: "claude", face: "#fbe7d3", tilt: 9, size: 42, pos: { right: 18, top: 100 }, show: PHONE },
  { key: "openai-m", brand: "openai", face: "#ddf3e8", tilt: -10, size: 40, pos: { right: 28, top: 350 }, show: PHONE },
];

export function AgentStickers({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden select-none", className)}>
      {SPOTS.map((s, i) => (
        <motion.span
          key={s.key}
          className={cn("absolute block", s.show)}
          style={s.pos}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.55 + i * 0.07, ease: [0.34, 1.4, 0.64, 1] }}
        >
          <span className="dw-stk-float block" style={{ animationDelay: `${-i * 1.3}s` }}>
            <span className="dw-stk is-peel is-quiet max-sm:!pointer-events-none lg:pointer-events-auto" style={{ "--r": `${s.tilt}deg`, "--peel": `${Math.round(s.size * 0.26)}px` } as CSSProperties}>
              <span
                className="dw-stk-face grid place-items-center text-dw-ink"
                style={{ width: s.size, height: s.size, borderRadius: Math.round(s.size * 0.3), background: s.face, padding: 0, gap: 0 }}
              >
                {s.brand ? <BrandGlyph brand={s.brand} size={Math.round(s.size * 0.46)} /> : <Mascot kind="leader" size={Math.round(s.size * 0.72)} />}
              </span>
              <span className="dw-stk-flap" />
            </span>
          </span>
        </motion.span>
      ))}
    </div>
  );
}
