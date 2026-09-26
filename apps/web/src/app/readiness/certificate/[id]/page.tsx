import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { PillButton } from "@/components/dw/ui";
import { CertificateEmbed } from "@/components/readiness/certificate-embed";
import { CertificateView, LEVEL_STYLE } from "@/components/readiness/certificate-view";
import { ReadinessNav } from "@/components/readiness/readiness-nav";
import { GLOW, NAV_LINK } from "@/components/readiness/styles";
import { getCertificate, isExpired } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/readiness/certificate/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const cert = getCertificate(id);
  if (!cert) return { title: "Certificate not found · Darwin" };
  const host = new URL(cert.origin).host;
  const level = LEVEL_STYLE[cert.level].label;
  return {
    title: `${host} · ${level} agent-readiness · Darwin`,
    description: `${host} scored ${cert.score}/100 for AI shopping agents (${level}). ${cert.verdict}`.slice(0, 300),
  };
}

export default async function CertificatePage(props: PageProps<"/readiness/certificate/[id]">) {
  const { id } = await props.params;
  const cert = getCertificate(id);
  if (!cert) notFound();

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") ? "http" : "https");
  const base = process.env.DARWIN_PUBLIC_URL?.replace(/\/$/, "") || `${proto}://${host}`;
  const expired = isExpired(cert);

  return (
    <div data-dw className="relative isolate flex min-h-[100svh] w-full flex-col overflow-x-hidden bg-dw-bg font-dw text-dw-ink">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[48rem]" style={{ background: GLOW }} />
      <ReadinessNav>
        <Link href={`/readiness?url=${encodeURIComponent(cert.url)}`} className={NAV_LINK}>
          <RefreshCw className="size-4" aria-hidden /> <span className="max-sm:hidden">Re-check this store</span>
          <span className="sm:hidden">Re-check</span>
        </Link>
        <PillButton href="/onboarding" size="sm" className="ml-1.5 h-9 px-4">
          Get started
        </PillButton>
      </ReadinessNav>

      <main className="mx-auto flex w-full max-w-[56rem] flex-col gap-4 px-4 pt-8 pb-24 sm:px-7 sm:pt-12">
        <CertificateView cert={cert} expired={expired} />

        <section className="flex min-w-0 flex-col gap-3 rounded-[26px] border border-dw-hairline bg-dw-surface p-6">
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">Show it on your store</h2>
          <CertificateEmbed base={base} certId={cert.id} levelLabel={LEVEL_STYLE[cert.level].label} />
        </section>

        <p className="px-1 text-[14px] leading-relaxed text-dw-ink/60">
          Darwin audits whether AI shopping agents can reach a store, read its products, prices, delivery and returns, and buy. With an LLM key, Grok also shops the store
          itself (never completing a real checkout). Gold needs a score of 85+ and a passing agent trial, Silver 70+, Bronze 55+. Certificates are valid for 90 days.{" "}
          <Link href="/readiness" className="inline-flex items-center gap-1 font-medium text-dw-ink underline decoration-dw-ink/25 underline-offset-4 hover:decoration-dw-ink">
            Check your store <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </main>
    </div>
  );
}
