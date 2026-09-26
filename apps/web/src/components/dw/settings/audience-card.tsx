"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Users } from "lucide-react";
import type { Audience, Experiment } from "@/lib/contracts";
import { cn } from "@/components/ui/cn";
import { useExperiments } from "@/lib/console/hooks";
import { BrandGlyph } from "../brand-logos";
import { Card, CardTitle } from "../ui";

const WHO: Record<Audience, string> = { human: "people", agent: "AI shoppers", all: "everyone" };

/**
 * An honest explainer, not toggles: Darwin picks who judges each test from what the fix touches
 * (ExperimentResult.audience, set by the optimizer). Counts come from the real experiments.
 */
export function AudienceCard({ className }: { className?: string }) {
  const experiments = useExperiments();
  const judged = (experiments ?? []).filter((e): e is Experiment & { result: NonNullable<Experiment["result"]> } => !!e.result);
  const count = (a: Audience) => judged.filter((e) => (e.result.audience ?? "all") === a).length;
  const running = experiments?.find((e) => e.status === "running");
  const runningAudience = running?.result?.audience ?? (running?.result ? "all" : undefined);

  return (
    <Card tone="blue" shape="observer" corner="br" className={cn("flex flex-col p-6 sm:p-7", className)} aria-label="Who Darwin tests for">
      <CardTitle>Who Darwin tests for</CardTitle>
      <p className="mt-2 text-[14.5px] leading-snug text-[#2E3A55]">
        Each fix is judged only on the shoppers it can reach, so the others can&apos;t add noise to the call. Darwin works this out from what the fix changes.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        <Who
          i={0}
          icon={<Users className="size-[18px]" strokeWidth={2.2} />}
          name="People"
          detail="Changes to the pages shoppers see. AI shoppers never load them."
          n={experiments ? count("human") : undefined}
          live={runningAudience === "human"}
        />
        <Who
          i={1}
          icon={
            <span className="grid grid-cols-2 gap-[3px]" aria-label="ChatGPT, Claude, Perplexity and Grok">
              <BrandGlyph brand="openai" size={12} />
              <BrandGlyph brand="claude" size={12} className="text-[#D97757]" />
              <BrandGlyph brand="perplexity" size={12} className="text-[#1F8A8A]" />
              <BrandGlyph brand="grok" size={12} />
            </span>
          }
          name="AI shoppers"
          detail="Changes to what the store API tells agents. People never see them."
          n={experiments ? count("agent") : undefined}
          live={runningAudience === "agent"}
        />
        <Who
          i={2}
          icon={<span className="text-[15px] font-semibold">All</span>}
          name="Everyone"
          detail="Changes both can feel, like a free-shipping threshold that shows up in an agent's landed price."
          n={experiments ? count("all") : undefined}
          live={runningAudience === "all"}
        />
      </ul>

      <p className="mt-4 text-[13px] leading-snug text-[#2E3A55]">
        {running && runningAudience ? (
          <>
            Right now “{running.name}” is judged on <span className="font-semibold text-dw-ink">{WHO[runningAudience]}</span>.
          </>
        ) : (
          "Automatic, so there's nothing to switch here."
        )}
      </p>
    </Card>
  );
}

function Who({ i, icon, name, detail, n, live }: { i: number; icon: ReactNode; name: string; detail: string; n?: number; live?: boolean }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + i * 0.07, duration: 0.3 }}
      className={cn("dw-row flex items-center gap-3.5 rounded-2xl bg-white/55 px-3.5 py-3 hover:bg-white/75", live && "bg-white/85 ring-2 ring-dw-ink")}
    >
      <span className="dw-tilt grid size-10 shrink-0 place-items-center rounded-[13px] bg-white text-dw-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_0_0_1px_rgba(20,20,19,0.06)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[15px] leading-tight font-semibold">
          {name}
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-dw-ink px-2 py-0.5 text-[11px] font-medium text-white">
              <span className="dw-live-dot size-1.5 rounded-full bg-dw-live" /> testing now
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[#2E3A55]">{detail}</span>
      </span>
      {n !== undefined && (
        <span className="flex shrink-0 flex-col items-end text-right">
          <span className="num text-[18px] leading-none font-semibold">{n}</span>
          <span className="text-[11.5px] text-[#2E3A55]">{n === 1 ? "test" : "tests"}</span>
        </span>
      )}
    </motion.li>
  );
}
