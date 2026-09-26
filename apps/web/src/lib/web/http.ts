import { z } from "zod";
import { WebRuleError } from "./store";

const MAX_BODY_BYTES = 32 * 1024;

/** Parse a small JSON body. Returns a Response to send back when it isn't one. */
export async function readJson(req: Request): Promise<unknown | Response> {
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Response.json({ error: "Body too large" }, { status: 413 });
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
}

/** Map validation and rule errors to 4xx responses; rethrow anything else. */
export function errorResponse(err: unknown): Response {
  if (err instanceof z.ZodError) return Response.json({ error: z.prettifyError(err) }, { status: 400 });
  if (err instanceof WebRuleError) return Response.json({ error: err.message }, { status: err.status });
  throw err;
}

/** The origin the caller used (behind Vercel / a proxy too). */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
