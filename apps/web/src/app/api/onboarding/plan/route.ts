import { z } from "zod";
import { githubTokenFor } from "@/lib/auth/oauth";
import { githubErrorStatus, inspectRepository, installSnippet } from "@/lib/github";
import type { TrackingPlan } from "@/lib/contracts";
import { amendPlan, applyToggles, buildPlan, cachedPlan, cachePlan, getPlan, planCacheKey, planIntro, savePlan } from "@/lib/tracking";
import { siteIdForUrl } from "@/lib/web";

const SiteSchema = z.string().regex(/^[\w.-]{1,64}$/);

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 16_000) throw new Error("Body too large");
  return text.trim() ? JSON.parse(text) : {};
}

const bad = (err: unknown) => Response.json({ error: err instanceof z.ZodError ? z.prettifyError(err) : String((err as Error)?.message ?? err) }, { status: 400 });

const STORE_URL_HINT = "Use your store's address, like https://shop.example.com";
const StoreUrl = z
  .string()
  .trim()
  .max(300)
  // "shop.example.com" is fine (https is assumed); "ftp://…" or "javascript:…" are not.
  .refine((s) => /^https?:\/\//i.test(s) || !/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s), STORE_URL_HINT)
  .transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.url({ protocol: /^https?$/, message: STORE_URL_HINT }))
  .refine((u) => new URL(u).hostname.includes("."), STORE_URL_HINT);

/** Onboarding's answers to Darwin's questions (optional; also part of the plan's cache key). */
const Answers = z.union([
  z.record(z.string().max(40), z.union([z.string().max(300), z.array(z.string().max(80)).max(20), z.boolean(), z.number()])),
  z.array(z.string().max(300)).max(20),
]);

/**
 * The same store, description and answers always get the same plan (the LLM's extra events vary from run to
 * run): the generated plan is cached by hash(site + normalised description + answers) and returned again,
 * unless the request says regenerate: true.
 */
async function stablePlan(key: string, regenerate: boolean | undefined, make: () => Promise<TrackingPlan>): Promise<{ plan: TrackingPlan; cached: boolean }> {
  const hit = regenerate ? undefined : cachedPlan(key);
  if (hit) return { plan: savePlan(hit), cached: true };
  return { plan: savePlan(cachePlan(key, await make())), cached: false };
}

/**
 * POST /api/onboarding/plan { prompt?, repoUrl | siteUrl, whop?, answers?, regenerate? } → { plan, reply, cached, note?, snippet?, install }
 * With repoUrl: reads the repo (framework, site id) and the install is a pull request.
 * With siteUrl (no GitHub): the install is one script tag, returned as `snippet`.
 * Either way, what the merchant said becomes a tracking plan, saved. Same inputs → same plan (see stablePlan).
 */
export async function POST(req: Request) {
  let input;
  try {
    input = z
      .object({
        prompt: z.string().max(1000).optional(),
        repoUrl: z.string().min(1).max(300).optional(),
        siteUrl: StoreUrl.optional(),
        whop: z.string().max(120).optional(),
        answers: Answers.optional(),
        regenerate: z.boolean().optional(),
      })
      .refine((b) => !!b.repoUrl !== !!b.siteUrl, "Send either repoUrl (GitHub) or siteUrl (your store's address)")
      .parse(await body(req));
  } catch (err) {
    return bad(err);
  }
  if (input.siteUrl) {
    const site = siteIdForUrl(input.siteUrl);
    if (!site) return bad(new Error("That address has no host name"));
    const key = planCacheKey({ site, source: "url", prompt: input.prompt, whop: input.whop, answers: input.answers });
    const { plan, cached } = await stablePlan(key, input.regenerate, () =>
      buildPlan({ site, siteUrl: input.siteUrl, prompt: input.prompt?.trim() || undefined, framework: "Any website (script tag)", whop: input.whop }),
    );
    const install = installSnippet(req, site);
    return Response.json({ plan, reply: planIntro(plan), cached, snippet: install.tag, install });
  }
  try {
    const repo = await inspectRepository(input.repoUrl!, { token: githubTokenFor(req) });
    const key = planCacheKey({
      site: repo.siteId,
      source: "repo",
      prompt: input.prompt,
      whop: input.whop,
      answers: input.answers,
      // A repo Darwin couldn't read before (no sign-in) gets a fresh plan once it can.
      context: { repo: repo.repo, framework: repo.framework, read: !repo.assumed, analytics: repo.analytics },
    });
    const { plan, cached } = await stablePlan(key, input.regenerate, () =>
      buildPlan({ site: repo.siteId, prompt: input.prompt?.trim() || undefined, repo: repo.repo, framework: repo.framework, whop: input.whop, analytics: repo.analytics, repoRead: !repo.assumed }),
    );
    return Response.json({
      plan,
      reply: planIntro(plan),
      cached,
      note: repo.note,
      found: { framework: repo.framework, assumed: repo.assumed, analytics: repo.analytics },
      // The tag the install PR adds (same helper), for anyone installing by hand.
      install: installSnippet(req, plan.site),
    });
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

/** GET /api/onboarding/plan?site=… → { plan, install } (install: the darwin.js tag for the site, same helper as POST). */
export function GET(req: Request) {
  const site = SiteSchema.safeParse(new URL(req.url).searchParams.get("site") ?? "");
  if (!site.success) return Response.json({ error: "?site= is required" }, { status: 400 });
  return Response.json({ plan: getPlan(site.data) ?? null, install: installSnippet(req, site.data) });
}
