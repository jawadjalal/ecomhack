import { redirect } from "next/navigation";

/** "Pull requests" became "Changes": a PR is just one optional artefact of a change. Keeps ?mock=1 etc. */
export default async function Page({ searchParams }: PageProps<"/console/pulls">) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, value);
  }
  const qs = params.toString();
  redirect(`/console/changes${qs ? `?${qs}` : ""}`);
}
