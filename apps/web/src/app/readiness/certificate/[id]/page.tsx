import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Mascot } from "@/components/dw/mascot";
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
    <main data-dw className="min-h-screen w-full bg-dw-bg font-dw text-dw-ink">
      <div className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 pb-20 sm:px-8">
        <nav className="flex h-20 items-center justify-between gap-3">
          <Link href="/readiness" className="flex items-center gap-2 text-[18px] font-semibold">
            <Mascot kind="analyst" size={30} /> Darwin <span className="hidden font-normal text-dw-muted sm:inline">agent readiness</span>
          </Link>
          <Link
            href={`/readiness?url=${encodeURIComponent(cert.url)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-medium shadow-[0_0_0_1px_rgba(20,20,19,0.08)] hover:bg-[#fffaf0]"
          >
            <RefreshCw className="size-4" /> Check again
          </Link>
        </nav>

        <CertificateView cert={cert} expired={expired} />

        <section className="flex flex-col gap-3 rounded-[26px] border border-dw-hairline bg-dw-surface p-6">
          <div className="text-[18px] font-semibold">Show it on your store</div>
          <CertificateEmbed base={base} certId={cert.id} levelLabel={LEVEL_STYLE[cert.level].label} />
        </section>

        <p className="text-[14px] leading-relaxed text-dw-muted">
          Darwin checks whether AI shopping agents can reach a store, read its products, prices, delivery and returns, and buy. When an AI key is set, Grok also
          shops the store itself (it never completes a real checkout). Gold needs 85+ and a passing trial, Silver 70+, Bronze 55+. Certificates last 90 days.{" "}
          <Link href="/readiness" className="inline-flex items-center gap-1 font-medium text-dw-ink underline-offset-2 hover:underline">
            Check your store <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </div>
    </main>
  );
}
