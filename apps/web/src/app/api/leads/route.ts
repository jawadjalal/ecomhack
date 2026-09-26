import { z } from "zod";
import { kvGet, kvUpdate } from "@/lib/db/json-store";

export const dynamic = "force-dynamic";

export interface Lead {
  email: string;
  storeUrl?: string;
  score?: number;
  source: string;
  at: string;
}

const Body = z.object({
  email: z.email().max(200),
  storeUrl: z.string().max(500).optional(),
  score: z.number().int().min(0).max(100).optional(),
  source: z.string().max(40).default("readiness"),
});

const KEY = "leads";
const MAX_LEADS = 5000;

/** POST /api/leads { email, storeUrl?, score?, source? } → { ok: true }. Stored in .data/leads.json. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Enter a valid email." }, { status: 400 });
  const lead: Lead = { ...parsed.data, email: parsed.data.email.toLowerCase(), at: new Date().toISOString() };
  kvUpdate<Lead[]>(KEY, () => [], (list) => [lead, ...list.filter((l) => !(l.email === lead.email && l.storeUrl === lead.storeUrl))].slice(0, MAX_LEADS));
  return Response.json({ ok: true, pilotUrl: process.env.NEXT_PUBLIC_DARWIN_PILOT_URL || null });
}

/** GET /api/leads with header `authorization: Bearer $DARWIN_ADMIN_TOKEN` → Lead[]. Disabled when the token isn't set. */
export async function GET(req: Request) {
  const token = process.env.DARWIN_ADMIN_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ leads: kvGet<Lead[]>(KEY, () => []) });
}
