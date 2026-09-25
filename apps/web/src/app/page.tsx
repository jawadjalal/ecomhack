import Link from "next/link";

/** Placeholder. OWNED BY: console PR (landing + /console). */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-6 p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Darwin</h1>
      <p className="text-lg text-neutral-600">
        The storefront that improves itself: behaviour → insight → page change → better outcome, for humans and AI agents.
      </p>
      <div className="flex gap-3">
        <Link className="rounded-md bg-black px-4 py-2 text-white" href="/console">Open console</Link>
        <Link className="rounded-md border px-4 py-2" href="/store">Open demo store</Link>
      </div>
    </main>
  );
}
