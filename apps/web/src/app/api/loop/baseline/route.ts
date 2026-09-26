import { z } from "zod";
import { PageSpecSchema } from "@/lib/contracts";
import { getLoopState, resetLoop } from "@/lib/optimizer";
import { getLiveSpec, promoteSpec } from "@/lib/spec/store";
import { getRunningExperiment } from "@/lib/experiments/store";

/**
 * Import a connected store's committed config as Darwin's Gen 0 baseline.
 *
 *   GET  /api/loop/baseline                      → { spec }   the live spec
 *   POST /api/loop/baseline { spec, reset? }      → { spec, loop }
 *
 * Darwin's live spec starts from apps/web/storefront.config.json. When Darwin optimizes another
 * repo (DARWIN_TARGET_CONFIG_PATH), that repo's own storefront.config.json should be the baseline,
 * otherwise the "ship the winner" PR would write this demo store's copy (headline, button text)
 * into the other store. Only allowed before the loop has results (or with `reset: true`, which
 * clears events, experiments and history first, like POST /api/loop/reset). Admin only
 * (/api/loop/* is behind the admin gate in proxy.ts).
 */

const Body = z.object({ spec: PageSpecSchema, reset: z.boolean().optional() });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function GET() {
  return json({ spec: getLiveSpec() });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Body must be JSON: { spec: PageSpec, reset?: boolean }" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: z.prettifyError(parsed.error) }, 400);
  const { spec, reset } = parsed.data;

  const state = getLoopState();
  const started = state.phase !== "idle" || state.generation > 0 || state.history.length > 0 || Boolean(getRunningExperiment());
  if (started && !reset) {
    return json({ error: "Darwin already has results for the current baseline. Send reset: true to start over from this config." }, 409);
  }
  if (reset) await resetLoop();

  const { version: _v, label, ...settings } = spec; // eslint-disable-line @typescript-eslint/no-unused-vars
  const live = promoteSpec({ ...getLiveSpec(), ...settings }, label.trim() || "Baseline");
  return json({ spec: live, loop: getLoopState() });
}
