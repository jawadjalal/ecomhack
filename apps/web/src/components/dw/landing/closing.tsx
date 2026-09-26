"use client";

/**
 * The last thing on the page (Wayari's Closing, as Darwin's): Howl's castle at dusk, one big line,
 * and the pink gel door to set up a store. The painting is lazy (below the fold) and drawn at the
 * width of the window.
 */
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/components/ui/cn";
import { Art } from "@/components/dw/art";
import { GelLink } from "@/components/dw/gel";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { EASE, RIM, Sel } from "./bits";

const CREW_ROW: MascotKind[] = ["observer", "designer", "analyst", "experimenter", "shipper"];

export function Closing() {
  return (
    <section id="closing" aria-labelledby="closing-title" className="relative isolate overflow-hidden px-4 pt-28 pb-36 sm:px-7 sm:pt-40 sm:pb-48">
      <Art id="castle-dusk" position="50% 45%" sizes="100vw" scrim="bg-[#1a1030]/30" className="-z-10" />
      <div className="mx-auto flex max-w-[1100px] flex-col items-center text-center">
        <motion.h2
          id="closing-title"
          className="text-[40px] leading-[1.04] font-semibold tracking-[-0.04em] text-white [text-shadow:0_1px_14px_rgba(26,16,48,0.5)] sm:text-[60px] xl:text-[76px]"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          You run the store.
          <br />
          <Sel className="text-dw-ink [text-shadow:none]">Darwin makes it better.</Sel>
        </motion.h2>

        <motion.div
          className="mt-10 flex w-full flex-col items-center gap-3 sm:mt-12 sm:w-auto sm:flex-row"
          initial={{ opacity: 0, scale: 0.94 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
        >
          <GelLink href="/onboarding" h={68} fontSize={21} className="group w-full sm:w-auto">
            Set up your store
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
          </GelLink>
          <GelLink href="/console" tone="ghost" h={68} fontSize={19} className="w-full sm:w-auto">
            Open Darwin
          </GelLink>
        </motion.div>

        <div className="mt-10 flex flex-col items-center gap-3">
          <div className="flex items-end gap-2" aria-hidden>
            {CREW_ROW.map((k, i) => (
              <motion.span
                key={k}
                className={cn(RIM, "inline-grid")}
                initial={{ y: 12, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 + i * 0.07, duration: 0.5, ease: EASE }}
              >
                <Mascot kind={k} size={k === "analyst" ? 44 : 36} />
              </motion.span>
            ))}
          </div>
          <p className="text-[15.5px] font-medium text-white [text-shadow:0_1px_10px_rgba(26,16,48,0.55)]">Free while Darwin is in beta.</p>
        </div>
      </div>
    </section>
  );
}
