import { z } from "zod";
import { createRule, errorResponse, readJson, SiteSchema, webState } from "@/lib/web";

export const dynamic = "force-dynamic";

/** GET /api/web/rules?site=… → WebRulesResponse: rules, their results, traffic by source, known sites. */
export function GET(req: Request) {
  const site = SiteSchema.safeParse(new URL(req.url).searchParams.get("site") ?? "");
  if (!site.success) return Response.json({ error: "?site= is required (the data-darwin-site of your darwin.js tag)" }, { status: 400 });
  return Response.json(webState(site.data));
}

const CreateSchema = z.object({ rule: z.unknown(), status: z.enum(["draft", "running"]).default("draft") });

/** POST /api/web/rules { rule: WebRuleDraft, status?: "draft" | "running" } → { rule } */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { rule, status } = CreateSchema.parse(body);
    return Response.json({ rule: createRule(rule, status) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
