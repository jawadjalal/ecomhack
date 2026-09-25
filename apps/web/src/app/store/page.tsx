import { getVisitor } from "@/lib/visitor";

/** Placeholder. OWNED BY: storefront PR. */
export default async function StoreHome() {
  const visitor = await getVisitor();
  return (
    <main className="p-10">
      <h1 className="text-3xl font-semibold">{visitor.spec.hero.headline}</h1>
      <p className="text-neutral-600">{visitor.spec.hero.subheadline}</p>
      <pre className="mt-6 text-xs text-neutral-500">
        visitor {visitor.distinctId} · spec v{visitor.spec.version} · {visitor.variant ?? "no experiment"}
      </pre>
    </main>
  );
}
