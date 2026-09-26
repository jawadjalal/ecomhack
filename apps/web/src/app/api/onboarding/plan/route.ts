import { z } from "zod";
import { githubErrorStatus, inspectRepository } from "@/lib/github";
import { amendPlan, applyToggles, buildPlan, getPlan, planIntro, savePlan } from "@/lib/tracking";

const SiteSchema = z.string().regex(/^[\w.-]{1,64}$/);

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 16_000) throw new Error("Body too large");
  return text.trim() ? JSON.parse(text) : {};
}

const bad = (err: unknown) => Response.json({ error: err instanceof z.ZodError ? z.prettifyError(err) : String((err as Error)?.message ?? err) }, { status: 400 });

/**
 * POST /api/onboarding/plan { prompt?, repoUrl, whop? } → { plan, reply, note? }
 * Reads the repo (framework, site id), turns what the merchant said into a tracking plan, saves it.
 */
export async function POST(req: Request) {
  let input;
  try {
    input = z.object({ prompt: z.string().max(1000).optional(), repoUrl: z.string().min(1).max(300), whop: z.string().max(120).optional() }).parse(await body(req));
  } catch (err) {
    return bad(err);
  }
  try {
    const repo = await inspectRepository(input.repoUrl);
    const plan = savePlan(
      await buildPlan({ site: repo.siteId, prompt: input.prompt?.trim() || undefined, repo: repo.repo, framework: repo.framework, whop: input.whop, analytics: repo.analytics, repoRead: !repo.assumed }),
    );
    return Response.json({ plan, reply: planIntro(plan), note: repo.note, found: { framework: repo.framework, assumed: repo.assumed, analytics: repo.analytics } });
  } catch (err) {
    const { status, error } = githubErrorStatus(err);
    return Response.json({ error }, { status });
  }
}

/** PATCH /api/onboarding/plan { site, message } → { plan, reply }: the merchant chats to change the plan. */
export async function PATCH(req: Request) {
  let input;
  try {
    input = z.object({ site: SiteSchema, message: z.string().trim().min(1).max(500) }).parse(await body(req));
  } catch (err) {
    return bad(err);
  }
  const plan = getPlan(input.site);
  if (!plan) return Response.json({ error: "No plan for this site yet" }, { status: 404 });
  const out = await amendPlan(plan, input.message);
  return Response.json({ plan: savePlan(out.plan), reply: out.reply });
}

/** PUT /api/onboarding/plan { site, enabled: { eventName: boolean } } → { plan }: toggles. */
export async function PUT(req: Request) {
  let input;
  try {
    input = z.object({ site: SiteSchema, enabled: z.record(z.string().max(60), z.boolean()) }).parse(await body(req));
  } catch (err) {
    return bad(err);
  }
  const plan = getPlan(input.site);
  if (!plan) return Response.json({ error: "No plan for this site yet" }, { status: 404 });
  return Response.json({ plan: savePlan(applyToggles(plan, input.enabled)) });
}

/** GET /api/onboarding/plan?site=… → { plan } */
export function GET(req: Request) {
  const site = SiteSchema.safeParse(new URL(req.url).searchParams.get("site") ?? "");
  if (!site.success) return Response.json({ error: "?site= is required" }, { status: 400 });
  return Response.json({ plan: getPlan(site.data) ?? null });
}
