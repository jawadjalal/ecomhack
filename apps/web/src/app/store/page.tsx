import { Leaf, MapPin, RotateCcw } from "lucide-react";
import { Hero, SocialProof } from "@/components/store/hero";
import { ProductGrid } from "@/components/store/product-grid";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { Container } from "@/components/store/ui";
import { getStoreContext } from "@/lib/storefront/context";

const VALUES = [
  { icon: MapPin, title: "Designed in Shoreditch", body: "Every PACE shoe is prototyped in our East London studio and tested on Regent's Canal towpaths." },
  { icon: RotateCcw, title: "Run in them for 60 days", body: "Not your shoe? Send them back — worn, muddy, whatever. We'll recycle them through our take-back scheme." },
  { icon: Leaf, title: "Lighter on the planet", body: "Recycled knit uppers, bio-based foams and carbon-neutral delivery across the UK." },
];

export default async function StoreHome(props: PageProps<"/store">) {
  const ctx = await getStoreContext(props.searchParams);
  const { spec } = ctx;
  return (
    <StoreShell ctx={ctx}>
      <PageView page="home" />
      <Hero spec={spec} />
      {spec.hero.showSocialProof && <SocialProof />}
      <ProductGrid spec={spec} category={ctx.query.category} />
      <section className="border-t border-(--line) bg-(--surface-2)">
        <Container className="grid gap-10 py-16 sm:grid-cols-3 sm:py-20">
          {VALUES.map((v) => (
            <div key={v.title}>
              <v.icon className="size-6" strokeWidth={1.6} aria-hidden />
              <h3 className="mt-4 text-lg font-semibold">{v.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--muted)">{v.body}</p>
            </div>
          ))}
        </Container>
      </section>
    </StoreShell>
  );
}
