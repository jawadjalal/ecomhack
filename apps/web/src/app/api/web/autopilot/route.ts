import { z } from "zod";
import { errorResponse, readJson, setAutopilot, SiteSchema } from "@/lib/web";

/** POST /api/web/autopilot { site, on } → WebAutopilotState */
export async function POST(req: Request) {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    const { site, on } = z.object({ site: SiteSchema, on: z.boolean() }).parse(body);
    return Response.json(setAutopilot(site, on));
  } catch (err) {
    return errorResponse(err);
  }
}
