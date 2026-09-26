"use client";

/**
 * How it works: one timeline, six stops, from connecting a store to the loop that keeps going
 * (a clone of Wayari's Timeline, rewritten with motion/react).
 *
 * The rail down the middle is the page's spine: a groove that fills with pink as the reader scrolls,
 * down to the reading line, with whoever works the current stop riding the front of the fill. Each stop
 * has a key on the rail that lights as the fill reaches it, a heading with one selected phrase, one
 * plain sentence, and a small picture. Stops alternate sides on a computer; on a phone the rail moves
 * to the left edge and the stops stack beside it.
 */
import { useRef, useState, type ReactNode } from "react";
import { motion, useInView, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { Check, Code2, Eye, FlaskConical, PenLine, RefreshCw, Rocket, RotateCcw, Plug, User } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Mascot, type MascotKind } from "@/components/dw/mascot";
import { AgentTile, agentBrand } from "@/components/dw/agent-tile";
import { BrandGlyph, WhopLogo } from "@/components/dw/brand-logos";
import { Art } from "@/components/dw/art";
import { CARD, EASE, H2, RIM, Reveal, Sel } from "./bits";

type Stop = {
  id: string;
  head: [string, string, string];
  body: string;
  crew: MascotKind;
  icon: ReactNode;
  Picture: () => React.ReactElement;
};

const CREW_ROW: MascotKind[] = ["leader", "observer", "designer", "experimenter", "shipper"];

/* ── the pictures: small windows on the desk ───────────────────────────── */

function Win({ title, tag, children, className }: { title: string; tag?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(CARD, "w-full min-w-0 max-w-[440px] overflow-hidden", className)}>
      <div className="flex h-11 items-center gap-2 border-b border-dw-hairline px-4">
        <span aria-hidden className="flex gap-1.5">
          <i className="size-2.5 rounded-full bg-dw-pink-shape" />
          <i className="size-2.5 rounded-full bg-dw-yellow-shape" />
          <i className="size-2.5 rounded-full bg-dw-olive" />
        </span>
        <span className="ml-1 truncate text-[13px] font-medium text-dw-ink/80">{title}</span>
        {tag && <span className="ml-auto shrink-0 rounded-full bg-dw-sand px-2.5 py-0.5 text-[11.5px] font-medium text-dw-muted">{tag}</span>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

const ROW = "flex min-w-0 items-center gap-3 rounded-[18px] border border-dw-hairline bg-white/70 px-3 py-2.5";

function ConnectPicture() {
  return (
    <Win title="Connect your store" tag="Pick one">
      <ul className="grid grid-cols-1 gap-2.5">
        <li className={ROW}>
          <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-dw-yellow"><Code2 className="size-[18px]" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">One script tag</span>
            <code className="block truncate font-dwmono text-[11.5px] text-dw-muted">&lt;script src=&quot;darwin.js&quot; async&gt;</code>
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-dw-win-bg px-2 py-0.5 text-[11.5px] font-medium text-dw-win"><Check className="size-3" aria-hidden />Added</span>
        </li>
        <li className={ROW}>
          <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-dw-ink text-white"><BrandGlyph brand="github" size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">GitHub</span>
            <span className="block truncate text-[12.5px] text-dw-muted">Darwin adds it for you</span>
          </span>
        </li>
        <li className={ROW}>
          <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"><WhopLogo size={20} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">Whop</span>
            <span className="block truncate text-[12.5px] text-dw-muted">Sign in and pick your store</span>
          </span>
        </li>
      </ul>
    </Win>
  );
}

function WatchPicture() {
  const rows: { who: ReactNode; name: string; saw: string; tone: string }[] = [
    { who: <span className="grid size-8 place-items-center rounded-[10px] bg-white shadow-[0_0_0_1px_rgba(20,20,19,0.08)]"><User className="size-4" aria-hidden /></span>, name: "A person", saw: "Left at the size chart", tone: "bg-dw-warn-bg text-dw-warn" },
    { who: <AgentTile brand={agentBrand("chatgpt")} size={32} />, name: "ChatGPT", saw: "Could not find delivery time", tone: "bg-dw-warn-bg text-dw-warn" },
    { who: <AgentTile brand={agentBrand("claude")} size={32} />, name: "Claude", saw: "Compared three shoes", tone: "bg-dw-blue/60 text-dw-ink" },
  ];
  return (
    <Win title="What Iris saw" tag="Example">
      <div className="relative -mx-4 -mt-4 mb-4 h-[92px] overflow-hidden sm:-mx-5 sm:-mt-5">
        <Art id="lake-marsh" position="50% 60%" sizes="440px" />
        <span className={cn(RIM, "absolute bottom-3 left-4 inline-grid")}><Mascot kind="observer" size={40} /></span>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {rows.map((r) => (
          <li key={r.name} className={ROW}>
            {r.who}
            <span className="min-w-0 flex-1 text-[14px] font-semibold">{r.name}</span>
            <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium", r.tone)}>{r.saw}</span>
          </li>
        ))}
      </ul>
    </Win>
  );
}

function DraftPicture() {
  return (
    <Win title="Pixel's draft" tag="Example">
      <div className="grid grid-cols-1 gap-2.5">
        <div className="rounded-[18px] border border-dw-hairline bg-white/70 p-3.5">
          <p className="text-[11.5px] font-medium text-dw-muted">Your current page</p>
          <p className="mt-1 text-[16px] font-semibold text-dw-ink/70">Trail Runner</p>
          <p className="text-[12.5px] text-dw-muted">£120</p>
        </div>
        <div className="relative rounded-[18px] bg-dw-lilac/60 p-3.5 shadow-[inset_0_0_0_1px_rgba(20,20,19,0.05)]">
          <p className="text-[11.5px] font-medium text-dw-ink/70">New version</p>
          <p className="mt-1 text-[16px] font-semibold">
            Trail Runner. <span className="rounded-[6px] bg-dw-yellow px-1">Free delivery in 2 days.</span>
          </p>
          <p className="text-[12.5px] text-dw-ink/70">£120 · Free returns for 30 days</p>
          <span className={cn(RIM, "absolute -top-4 right-3 inline-grid")}><Mascot kind="designer" size={34} /></span>
        </div>
        <p className="flex items-center gap-1.5 text-[12.5px] text-dw-muted"><Check className="size-3.5 text-dw-win" aria-hidden />Only facts already on your page</p>
      </div>
    </Win>
  );
}

function TestPicture() {
  const bars = [
    { label: "Your current page", w: "46%", fill: "bg-dw-sand shadow-[inset_0_0_0_1px_rgba(20,20,19,0.06)]" },
    { label: "New version", w: "68%", fill: "bg-dw-pink" },
  ];
  return (
    <Win title="A vs B test" tag="Example">
      <div className="flex items-center gap-3">
        <span className={cn(RIM, "inline-grid shrink-0")}><Mascot kind="experimenter" size={40} /></span>
        <p className="text-[13.5px] leading-snug text-dw-muted">Half your shoppers see each version. Fizz counts who buys.</p>
      </div>
      <ul className="mt-4 grid gap-3">
        {bars.map((b, i) => (
          <li key={b.label}>
            <p className="mb-1 text-[12.5px] font-medium text-dw-ink/80">{b.label}</p>
            <div className="h-7 rounded-full bg-dw-bg shadow-[inset_0_1px_2px_rgba(20,20,19,0.08)]">
              <motion.div
                className={cn("h-full rounded-full", b.fill)}
                style={{ originX: 0, width: b.w }}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true, margin: "0px 0px -20% 0px" }}
                transition={{ duration: 0.9, delay: 0.15 + i * 0.2, ease: EASE }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-dw-muted">% who buy</p>
    </Win>
  );
}

function ShipPicture() {
  return (
    <Win title="Changes" tag="Example">
      <div className="grid grid-cols-1 gap-2.5">
        <div className={ROW}>
          <span className={cn(RIM, "inline-grid shrink-0")}><Mascot kind="shipper" size={30} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">New version is live</span>
            <span className="block truncate text-[12.5px] text-dw-muted">Shipped by Dash, just now</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-dw-win-bg px-2 py-0.5 text-[11.5px] font-medium text-dw-win"><Check className="size-3" aria-hidden />Live</span>
        </div>
        <div className={ROW}>
          <span className="grid size-[36px] shrink-0 place-items-center rounded-[12px] bg-dw-ink text-white"><BrandGlyph brand="github" size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold">Code change on GitHub</span>
            <span className="block truncate text-[12.5px] text-dw-muted">Ready for you to check</span>
          </span>
        </div>
        <div aria-hidden className="flex items-center justify-between rounded-[18px] bg-dw-olive/25 px-3 py-2.5">
          <span className="text-[13px] font-medium">Changed your mind?</span>
          <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12.5px] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_0_0_1px_rgba(20,20,19,0.08),0_2px_6px_-2px_rgba(20,20,19,0.2)]">
            <RotateCcw className="size-3.5" />
            Undo
          </span>
        </div>
      </div>
    </Win>
  );
}

function LoopPicture() {
  return (
    <div className={cn(CARD, "relative h-[250px] w-full min-w-0 max-w-[440px] overflow-hidden sm:h-[270px]")}>
      <Art id="valley" position="50% 55%" sizes="(max-width: 640px) 92vw, 440px" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5">
        <div className="flex items-end gap-2">
          {CREW_ROW.map((k, i) => (
            <motion.span
              key={k}
              className={cn(RIM, "inline-grid")}
              initial={{ y: 14 }}
              whileInView={{ y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 + i * 0.08, duration: 0.5, ease: EASE }}
            >
              <Mascot kind={k} size={40} />
            </motion.span>
          ))}
        </div>
        <span className="flex items-center gap-2 rounded-full bg-dw-surface/95 px-3.5 py-1.5 text-[13px] font-medium shadow-[0_1px_2px_rgba(20,20,19,0.1),0_8px_18px_-10px_rgba(20,20,19,0.4)]">
          <RefreshCw className="size-3.5" aria-hidden />
          Next round starting
        </span>
      </div>
    </div>
  );
}

const STOPS: Stop[] = [
  {
    id: "connect",
    head: ["Connect ", "your store", ""],
    body: "Add one script tag, connect GitHub, or connect your Whop store. That is all the setup.",
    crew: "analyst",
    icon: <Plug />,
    Picture: ConnectPicture,
  },
  {
    id: "watch",
    head: ["Iris ", "watches", " people and AI shoppers"],
    body: "Iris sees where people and AI shopping agents get stuck on your pages, and says why in plain words.",
    crew: "observer",
    icon: <Eye />,
    Picture: WatchPicture,
  },
  {
    id: "draft",
    head: ["Pixel drafts ", "a page change", ""],
    body: "Pixel rewrites the part that trips shoppers up, using only facts that are already on your page.",
    crew: "designer",
    icon: <PenLine />,
    Picture: DraftPicture,
  },
  {
    id: "test",
    head: ["Fizz ", "tests it", " against your current page"],
    body: "Half your shoppers see your current page and half see the new version. Fizz keeps score.",
    crew: "experimenter",
    icon: <FlaskConical />,
    Picture: TestPicture,
  },
  {
    id: "ship",
    head: ["Dash ships ", "the winner", ""],
    body: "If the new version sells more, Dash ships it. If you change your mind, one click undoes it.",
    crew: "shipper",
    icon: <Rocket />,
    Picture: ShipPicture,
  },
  {
    id: "loop",
    head: ["It ", "keeps going", ""],
    body: "Then Iris looks again. Your store gets a little better every week, while you run the business.",
    crew: "analyst",
    icon: <RefreshCw />,
    Picture: LoopPicture,
  },
];

/** The rail's left edge on a phone, and its centre on a computer. */
const RAIL_X = "left-[22px] lg:left-1/2";

function StopRow({ s, i }: { s: Stop; i: number }) {
  const key = useRef<HTMLDivElement>(null);
  // Lit once the key is above the reading line (the middle of the window), and for as long as it stays there.
  const lit = useInView(key, { margin: "100000px 0px -50% 0px" });
  const flip = i % 2 === 1;
  return (
    <li className="relative grid min-w-0 grid-cols-1 items-center gap-6 pl-[60px] lg:grid-cols-2 lg:gap-x-[128px] lg:pl-0">
      <div
        ref={key}
        aria-hidden
        className={cn(
          "absolute top-1 z-[2] grid size-11 -translate-x-1/2 place-items-center rounded-full border-[3px] border-dw-bg transition-[background-color,color,transform,box-shadow] duration-500 lg:top-1/2 lg:size-12 lg:-translate-y-1/2 [&_svg]:size-[19px] [&_svg]:stroke-[2.1]",
          RAIL_X,
          lit
            ? "scale-105 bg-dw-hot text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_14px_-6px_rgba(240,87,158,0.7)]"
            : "bg-dw-surface text-dw-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_0_0_1px_rgba(20,20,19,0.08),0_4px_10px_-6px_rgba(20,20,19,0.3)]",
        )}
      >
        {s.icon}
      </div>
      <div className={cn("max-w-[470px]", flip ? "lg:order-2 lg:justify-self-start" : "lg:justify-self-end lg:text-right")}>
        <Reveal>
          <p className={cn("flex items-center gap-2 text-[13px] font-medium text-dw-muted", !flip && "lg:justify-end")}>
            <span className="tabular-nums">Step {i + 1}</span>
          </p>
          <h3 className="mt-2 text-[27px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[32px]">
            {s.head[0]}
            <Sel>{s.head[1]}</Sel>
            {s.head[2]}
          </h3>
          <p className="mt-3 text-[16.5px] leading-relaxed text-dw-ink/75 sm:text-[17.5px]">{s.body}</p>
        </Reveal>
      </div>
      <Reveal delay={0.12} className={cn("flex", flip ? "lg:order-1 lg:justify-end" : "lg:justify-start")}>
        <s.Picture />
      </Reveal>
    </li>
  );
}

export function Timeline() {
  const body = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: body, offset: ["start 50%", "end 50%"] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.4 });
  const riderTop = useTransform(fill, (v) => `${Math.min(1, Math.max(0, v)) * 100}%`);
  const [current, setCurrent] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const n = Math.min(STOPS.length - 1, Math.max(0, Math.floor(v * STOPS.length)));
    setCurrent((c) => (c === n ? c : n));
  });

  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-6 px-4 pt-24 pb-20 sm:px-7 sm:pt-32 sm:pb-28">
      <header className="mx-auto max-w-[1100px] text-center">
        <Reveal>
          <p className="text-[14px] font-medium text-dw-muted">How it works</p>
          <h2 id="how-title" className={cn(H2, "mt-3")}>
            Hand Darwin{" "}
            <span className="inline-flex translate-y-[0.08em] items-center -space-x-1.5 align-baseline">
              {CREW_ROW.map((k) => (
                <span key={k} className={cn(RIM, "inline-grid p-[2px]")}>
                  <Mascot kind={k} size={34} active={false} />
                </span>
              ))}
            </span>{" "}
            your store, and it gets <Sel>better every week.</Sel>
          </h2>
        </Reveal>
      </header>

      <div ref={body} className="relative mx-auto mt-16 max-w-[1180px] sm:mt-20">
        {/* the rail: a groove, the pink fill down to the reading line, and whoever is on the current stop riding its front */}
        <div aria-hidden className={cn("pointer-events-none absolute top-0 bottom-0 w-[8px] -translate-x-1/2", RAIL_X)}>
          <div className="absolute inset-0 rounded-full bg-dw-sand shadow-[inset_0_2px_4px_rgba(20,20,19,0.12),0_0_0_4px_rgba(255,255,255,0.45)]" />
          <motion.div className="absolute inset-x-[1.5px] top-0 bottom-0 rounded-full bg-dw-hot" style={{ scaleY: fill, originY: 0 }} />
          <motion.div className="absolute left-1/2 z-[3] -translate-x-1/2 -translate-y-1/2 max-lg:hidden" style={{ top: riderTop }}>
            <span className={cn(RIM, "inline-grid")}>
              <Mascot kind={STOPS[current].crew} size={34} />
            </span>
          </motion.div>
        </div>

        <ol className="relative grid grid-cols-1 gap-20 sm:gap-24 lg:gap-28">
          {STOPS.map((s, i) => (
            <StopRow key={s.id} s={s} i={i} />
          ))}
        </ol>
        <div aria-hidden className={cn("absolute -bottom-6 size-4 -translate-x-1/2 rounded-full bg-dw-hot shadow-[0_0_0_4px_var(--color-dw-bg)]", RAIL_X)} />
      </div>
    </section>
  );
}
