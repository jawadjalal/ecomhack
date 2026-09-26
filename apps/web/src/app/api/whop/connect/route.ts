import { z } from "zod";
import { connectWhop, whopErrorStatus } from "@/lib/whop";

const Body = z.object({
  /** Optional: a Whop API key (same one `whop login --method api-key` takes). Default: WHOP_API_KEY. */
  apiKey: z.string().max(300).optional(),
});

/**
 * POST /api/whop/connect { apiKey? } → WhopConnection
 * Verifies the key against Whop's /accounts/me and remembers the business. No key → labelled offline demo.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let input: unknown = {};
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return Response.json({ error: "Body must be JSON: { apiKey? }" }, { status: 400 });
  }
  const parsed = Body.safeParse(input);
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  try {
    return Response.json(await connectWhop(parsed.data));
  } catch (err) {
    const { status, error } = whopErrorStatus(err);
    return Response.json({ error }, { status });
  }
}
