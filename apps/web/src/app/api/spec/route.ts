import { NextResponse } from "next/server";
import { resolveSpecForVisitor } from "@/lib/spec/resolve";
import { getLiveSpec } from "@/lib/spec/store";

/** GET /api/spec → live spec; GET /api/spec?distinct_id=… → spec that visitor sees. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("distinct_id");
  if (!id) return NextResponse.json({ spec: getLiveSpec() });
  return NextResponse.json(resolveSpecForVisitor(id));
}
