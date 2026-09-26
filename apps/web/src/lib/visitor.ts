/**
 * Server-side helper for storefront pages: who is this visitor and which spec do they see?
 */
import { cookies, headers } from "next/headers";
import { resolveSpecForVisitor, type ResolvedSpec } from "@/lib/spec/resolve";
import { classifyVisitor } from "@/lib/analytics/classify";
import type { VisitorKind } from "@/lib/contracts";

export const VISITOR_COOKIE = "darwin_id";

export interface Visitor extends ResolvedSpec {
  distinctId: string;
  kind: VisitorKind;
  agentName?: string;
}

/**
 * `?variant=treatment|control` forces an arm (used by the console's before/after preview).
 */
export async function getVisitor(forceVariant?: string | null): Promise<Visitor> {
  const jar = await cookies();
  const h = await headers();
  const distinctId = jar.get(VISITOR_COOKIE)?.value ?? "anonymous";
  const { kind, agentName } = classifyVisitor({
    userAgent: h.get("user-agent"),
    declaredAgent: h.get("x-agent-name"),
  });
  const force = forceVariant === "treatment" || forceVariant === "control" ? forceVariant : undefined;
  return { distinctId, kind, agentName, ...resolveSpecForVisitor(distinctId, force) };
}
