import type { CSSProperties, ReactNode } from "react";
import type { PageSpec } from "@/lib/contracts";
import type { StoreContext } from "@/lib/storefront/context";
import { luminance, readableOn, tint } from "@/lib/storefront/art/color";
import { getStoreBranding } from "@/lib/storefront/showcase";
import { StoreProvider } from "./store-provider";
import { StoreHeader } from "./header";
import { StoreFooter } from "./footer";
import { AddedToast } from "./added-toast";

const RADII: Record<PageSpec["theme"]["radius"], { btn: string; card: string; input: string; chip: string }> = {
  none: { btn: "0px", card: "0px", input: "0px", chip: "0px" },
  md: { btn: "10px", card: "16px", input: "10px", chip: "8px" },
  full: { btn: "999px", card: "28px", input: "999px", chip: "999px" },
};

export function themeVars(spec: PageSpec): CSSProperties {
  const accent = spec.theme.accent;
  const r = RADII[spec.theme.radius];
  // On dark surfaces a near-black accent would vanish; fall back to white there.
  const onDark = luminance(accent) < 0.06 ? "#ffffff" : accent;
  // The logo mark picks up the accent unless it's basically black.
  const logo = luminance(accent) < 0.03 ? "#f97316" : accent;
  return {
    "--accent": accent,
    "--accent-fg": readableOn(accent),
    "--accent-soft": tint(accent, 0.9),
    "--accent-on-dark": onDark,
    "--accent-on-dark-fg": readableOn(onDark),
    "--accent-logo": logo,
    "--r-btn": r.btn,
    "--r-card": r.card,
    "--r-input": r.input,
    "--r-chip": r.chip,
  } as CSSProperties;
}

export async function StoreShell({
  ctx,
  children,
  chrome = "full",
  bottomInset = false,
}: {
  ctx: StoreContext;
  children: ReactNode;
  /** "checkout" = minimal header, no announcement, slim footer. */
  chrome?: "full" | "checkout";
  /** Leave room for a fixed bottom bar (sticky add-to-cart). */
  bottomInset?: boolean;
}) {
  const { spec } = ctx;
  const { brand } = await getStoreBranding();
  return (
    <StoreProvider
      value={{ spec, persist: ctx.persist, preview: ctx.preview, variantLabel: ctx.variantLabel, analytics: ctx.analytics }}
    >
      <div
        className={`pace-root flex min-h-full flex-1 flex-col ${bottomInset ? "pb-[76px]" : ""}`}
        style={themeVars(spec)}
        data-spec-version={spec.version}
        data-variant={ctx.variantLabel}
      >
        <StoreHeader chrome={chrome} brand={brand} />
        <main className="flex flex-1 flex-col">{children}</main>
        <StoreFooter slim={chrome === "checkout"} brand={brand} />
        {chrome === "full" && <AddedToast />}
        {ctx.debug && (
          <div className="pointer-events-none fixed bottom-3 left-3 z-[60] rounded-full bg-black/85 px-3 py-1.5 font-mono text-[11px] text-white shadow-lg backdrop-blur">
            spec v{spec.version} · {ctx.variantLabel === "live" ? "live" : ctx.variantLabel}
            {spec.label ? <span className="text-white/60"> · {spec.label}</span> : null}
          </div>
        )}
      </div>
    </StoreProvider>
  );
}
