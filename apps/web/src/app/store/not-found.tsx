import Link from "next/link";
import { PaceLogo } from "@/components/store/logo";
import { themeVars } from "@/components/store/store-shell";
import { DEFAULT_SPEC } from "@/lib/spec/default-spec";

/** 404 for unknown store routes / product slugs. (No searchParams here, so it uses Gen 0 styling.) */
export default function StoreNotFound() {
  return (
    <div className="pace-root flex min-h-full flex-1 flex-col items-center justify-center px-6 py-24 text-center" style={themeVars(DEFAULT_SPEC)}>
      <PaceLogo />
      <p className="pace-eyebrow mt-10 text-(--muted)">404</p>
      <h1 className="pace-display mt-3 text-4xl font-extrabold sm:text-5xl">Wrong turn on the route</h1>
      <p className="mt-4 max-w-sm text-(--muted)">We couldn&apos;t find that page. The rest of the collection is right this way.</p>
      <Link href="/store" className="pace-btn pace-btn-primary mt-8 min-h-[52px] px-8">
        Back to the store
      </Link>
    </div>
  );
}
