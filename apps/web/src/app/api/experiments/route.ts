import { NextResponse, connection } from "next/server";
import type { ExperimentsResponse } from "@/lib/contracts";
import { listExperiments } from "@/lib/experiments/store";

/** GET /api/experiments → { experiments } (newest first, results included). */
export async function GET() {
  await connection(); // always read live state, never prerender
  const experiments = [...listExperiments()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json<ExperimentsResponse>({ experiments }, { headers: { "cache-control": "no-store" } });
}
