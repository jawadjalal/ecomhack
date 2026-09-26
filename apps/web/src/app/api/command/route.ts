import { z } from "zod";
import { eventStore } from "@/lib/analytics/store";
import { finishPlan, planCommand } from "@/lib/commands/plan";
import { manifest } from "@/lib/commands/specs";
import type { CommandManifestResponse, CommandPlanResponse, CommandSites } from "@/lib/commands/types";
import { listPlans } from "@/lib/tracking";
import { knownSites, listRules } from "@/lib/web";

export const dynamic = "force-dynamic";

function sites(): CommandSites {
  let web: string[] = [];
  try {
    web = knownSites(listRules(), eventStore().all()).map((s) => s.site);
  } catch {
    /* no web data yet */
  }
  return { tracking: listPlans().map((p) => p.site), web };
}

/**
 * GET /api/command → { commands: [{ name, title, description, risk, readOnly, aliases, inputSchema }], context: { sites } }
 * The command registry (what ⌘K, WebMCP and window.darwin can run) and the sites commands can target.
 */
export function GET() {
  return Response.json({ commands: manifest(), context: { sites: sites() } } satisfies CommandManifestResponse, { headers: { "cache-control": "no-store" } });
}

const Body = z.union([
  z.object({ text: z.string().trim().min(1).max(500), page: z.string().max(300).optional() }),
  z.object({ steps: z.array(z.object({ command: z.string().min(1).max(80), input: z.unknown().optional() })).min(1).max(6) }),
]);

/**
 * POST /api/command { text, page? } → CommandPlanResponse { steps: [{ command, input, title, label, risk, actor }], say, source, rejected? }
 *   Natural language → a validated plan (LLM when configured, else the heuristic parser). Nothing runs here:
 *   the browser runs the steps (⌘K / WebMCP), asking the merchant first for `risk: "confirm"` steps.
 * POST /api/command { steps: [{ command, input }] } → the same plan shape, validated; 400 with `rejected`
 *   when any step names an unknown command or has a bad input.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Send { "text": "build a dashboard of coupon usage per hour" } or { "steps": [{ "command", "input" }] }' }, { status: 400 });
  }
  if ("steps" in parsed.data) {
    const plan = finishPlan(parsed.data.steps, "", "direct");
    if (plan.rejected?.length) {
      const r = plan.rejected[0];
      return Response.json({ error: `Step ${r.index + 1}: ${r.reason}`, rejected: plan.rejected }, { status: 400 });
    }
    return Response.json(plan satisfies CommandPlanResponse);
  }
  const plan = await planCommand(parsed.data.text, { page: parsed.data.page, sites: sites() });
  return Response.json(plan satisfies CommandPlanResponse, { headers: { "cache-control": "no-store" } });
}
