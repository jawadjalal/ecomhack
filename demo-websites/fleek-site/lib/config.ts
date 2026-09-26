// Server only (node:fs): import this from server components and route handlers, never from "use client" files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeSpec, GEN0_SPEC, type PageSpec } from "./spec";

const FILE = path.join(process.cwd(), "storefront.config.json");

/**
 * The live PageSpec, read from `storefront.config.json` on every request. Reading at request time
 * (not import time) means merging a Darwin PR and pulling it shows the change on a running server,
 * with no rebuild. Falls back to Gen 0 if the file is missing or invalid JSON.
 */
export function getSpec(): PageSpec {
  try {
    return normalizeSpec(JSON.parse(readFileSync(FILE, "utf8")));
  } catch {
    return GEN0_SPEC;
  }
}

/** Darwin connection for the darwin.js tag. `DARWIN_URL=off` disables the tag. */
export function darwinTag(): { src: string; site: string } | null {
  const url = (process.env.DARWIN_URL ?? process.env.NEXT_PUBLIC_DARWIN_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
  if (!url || /^(off|false|0|none)$/i.test(url)) return null;
  const site = (process.env.DARWIN_SITE ?? process.env.NEXT_PUBLIC_DARWIN_SITE ?? "rackd").trim() || "rackd";
  return { src: `${url}/darwin.js`, site };
}
