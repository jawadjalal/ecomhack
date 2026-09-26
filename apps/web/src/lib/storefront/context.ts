/**
 * Server-side: resolve everything a store page needs from the request.
 *
 *   const ctx = await getStoreContext(props.searchParams);
 *
 * - `?variant=control|treatment` forces an experiment arm (console before/after).
 * - `?previewSpec=<base64url JSON>` renders an arbitrary valid PageSpec (ignored if invalid).
 * - `?preview=1` marks the view as a preview without changing the spec.
 * - `?debug=1` shows the spec pill.
 * Any preview disables analytics so console iframes never pollute experiment data.
 */
import type { PageSpec } from "@/lib/contracts";
import type { StoreAnalyticsConfig } from "./analytics";
import { attributionProps } from "@/lib/spec/resolve";
import { getVisitor, type Visitor } from "@/lib/visitor";
import { PERSISTED_PARAMS, decodePreviewSpec } from "./preview";

export type { StoreAnalyticsConfig };
export type SearchParams = Record<string, string | string[] | undefined>;

export interface StoreContext {
  spec: PageSpec;
  visitor: Visitor;
  /** "live" | "control" | "treatment" | "preview" */
  variantLabel: string;
  preview: boolean;
  debug: boolean;
  /** Query string carried across in-store links ("" when none). */
  persist: string;
  analytics: StoreAnalyticsConfig;
  /** Raw (first) value of each search param. */
  query: Record<string, string | undefined>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function getStoreContext(searchParams?: Promise<SearchParams> | SearchParams): Promise<StoreContext> {
  const sp: SearchParams = (await searchParams) ?? {};
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) query[k] = first(v);

  const forced = query.variant === "control" || query.variant === "treatment" ? query.variant : undefined;
  const visitor = await getVisitor(forced ?? null);
  const previewSpec = decodePreviewSpec(query.previewSpec);
  const spec = previewSpec ?? visitor.spec;
  const preview = Boolean(previewSpec || forced || query.preview === "1");
  const debug = query.debug === "1";

  const persistParams = new URLSearchParams();
  for (const key of PERSISTED_PARAMS) {
    const v = query[key];
    if (!v) continue;
    if (key === "previewSpec" && !previewSpec) continue;
    if (key === "variant" && !forced) continue;
    persistParams.set(key, v);
  }

  const variantLabel = previewSpec ? "preview" : (visitor.variant ?? "live");

  return {
    spec,
    visitor,
    variantLabel,
    preview,
    debug,
    persist: persistParams.toString(),
    query,
    analytics: {
      enabled: !preview,
      distinctId: visitor.distinctId,
      props: {
        visitor_kind: visitor.kind,
        ...(visitor.agentName ? { agent_name: visitor.agentName } : {}),
        ...attributionProps(visitor),
      },
    },
  };
}
