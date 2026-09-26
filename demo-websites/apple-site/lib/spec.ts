import fs from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { cookies } from "next/headers";
import { PageSpecSchema, type PageSpec } from "./page-spec";

/** Cookie set by /preview?config=… so a demo can flip between the live file and a preset. */
export const PREVIEW_COOKIE = "orchard_preview";
export const PRESETS = ["fixed"] as const;
export type Preset = (typeof PRESETS)[number];

export interface LoadedSpec {
  spec: PageSpec;
  /** File the spec came from, relative to the app root. */
  file: string;
  preview?: Preset;
  /** Set when the file was missing or invalid and we fell back to a safe default. */
  error?: string;
}

const CONFIG_FILE = process.env.STOREFRONT_CONFIG?.trim() || "storefront.config.json";

async function readSpec(file: string): Promise<PageSpec> {
  const raw = await fs.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), file), "utf8");
  return PageSpecSchema.parse(JSON.parse(raw));
}

/**
 * The PageSpec for this request. Read from disk every time (no build step), so a merged Darwin PR or a
 * hand edit to storefront.config.json shows on the next refresh. `cache` dedupes reads within a request.
 */
export const getSpec = cache(async (): Promise<LoadedSpec> => {
  const jar = await cookies();
  const wanted = jar.get(PREVIEW_COOKIE)?.value;
  const preview = (PRESETS as readonly string[]).includes(wanted ?? "") ? (wanted as Preset) : undefined;
  const file = preview ? `presets/${preview}.json` : CONFIG_FILE;
  try {
    return { spec: await readSpec(file), file, preview };
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    if (file !== "storefront.config.json") {
      try {
        return { spec: await readSpec("storefront.config.json"), file: "storefront.config.json", error: `${file}: ${reason}` };
      } catch {
        /* fall through */
      }
    }
    throw new Error(`Orchard can't read its PageSpec (${file}): ${reason}`);
  }
});

/** CSS custom properties for the theme knobs. */
export function themeVars(spec: PageSpec): Record<string, string> {
  const radius = { none: "4px", md: "12px", full: "980px" }[spec.theme.radius];
  return { "--accent": spec.theme.accent, "--btn-radius": radius };
}
