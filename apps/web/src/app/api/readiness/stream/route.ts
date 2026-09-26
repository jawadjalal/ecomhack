// GET /api/readiness/stream?url= → text/event-stream of ReadinessProgress events as they really happen:
//   {type:"fetch"} per page fetched, {type:"audit", report}, {type:"trial"}, {type:"turn"} per agent tool call,
//   {type:"read"}, {type:"judged"}, then {type:"done", report, cert} or {type:"error", error}.
// Same limits as POST /api/readiness/certify (it runs the audit and the agent trial, and issues a certificate).
import type { ReadinessReport } from "@/lib/contracts";
import { BlockedUrlError, certifyStore, clientKey, normaliseStoreUrl, takeToken } from "@/lib/readiness";
import type { ReadinessProgress } from "@/lib/readiness/audit";

export const dynamic = "force-dynamic";
/** Audit (~10s) + a bounded agent trial (≤ 45s budget). */
export const maxDuration = 90;

const WINDOW_MS = 10 * 60_000;
const MAX_PER_IP = 10;
const GLOBAL_WINDOW_MS = 60 * 60_000;
const MAX_GLOBAL = 60;

const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let url: string;
  try {
    url = normaliseStoreUrl(raw.slice(0, 500));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!takeToken("certify", clientKey(req), MAX_PER_IP, WINDOW_MS)) {
    return Response.json({ error: "Too many checks from this address. Try again in a few minutes." }, { status: 429 });
  }
  if (!takeToken("certify-global", "all", MAX_GLOBAL, GLOBAL_WINDOW_MS)) {
    return Response.json({ error: "Darwin is checking a lot of stores right now. Try again later." }, { status: 429 });
  }

  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sse(data)));
        } catch {
          closed = true;
        }
      };
      let report: ReadinessReport | undefined;
      try {
        const cert = await certifyStore(url, {
          onProgress: (e: ReadinessProgress) => {
            if (e.type === "audit") report = e.report;
            send(e);
          },
        });
        send({ type: "done", report, cert });
      } catch (e) {
        if (!(e instanceof BlockedUrlError)) console.error("[readiness] stream failed", e);
        send({ type: "error", error: e instanceof BlockedUrlError ? e.message : "The check failed. Try again.", report });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
