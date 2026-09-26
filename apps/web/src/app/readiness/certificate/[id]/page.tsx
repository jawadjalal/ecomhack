import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { DarwinWordmark } from "@/components/console/brand";
import { CertificateEmbed } from "@/components/readiness/certificate-embed";
import { CertificateView, LEVEL_STYLE } from "@/components/readiness/certificate-view";
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
    <main data-darwin-dark className="darwin-bg relative min-h-screen w-full text-white">
      <div className="darwin-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-5 pb-20 sm:px-8">
        <nav className="flex h-20 items-center justify-between">
          <Link href="/readiness">
            <DarwinWordmark sub="agent readiness" />
          </Link>
          <Link
            href={`/readiness?url=${encodeURIComponent(cert.url)}`}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-2 text-[0.9rem] font-medium text-white/90 hover:bg-white/10"
          >
            <RefreshCw className="size-4" /> Re-check this store
          </Link>
        </nav>

        <CertificateView cert={cert} expired={expired} />

        <section className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
          <div className="font-semibold text-white/90">Show it on your store</div>
          <CertificateEmbed base={base} certId={cert.id} levelLabel={LEVEL_STYLE[cert.level].label} />
        </section>

        <p className="text-[0.84rem] leading-relaxed text-white/45">
          Darwin audits whether AI shopping agents can reach a store, read its products, prices, delivery and returns, and buy. With an LLM key, Grok also shops the store
          itself (never completing a real checkout). Gold needs a score of 85+ and a passing agent trial, Silver 70+, Bronze 55+. Certificates are valid for 90 days.{" "}
          <Link href="/readiness" className="inline-flex items-center gap-1 text-brand hover:underline">
            Check your store <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </div>
    </main>
  );
}
