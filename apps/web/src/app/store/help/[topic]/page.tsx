import { notFound } from "next/navigation";
import { PageView } from "@/components/store/store-provider";
import { StoreShell } from "@/components/store/store-shell";
import { Container } from "@/components/store/ui";
import { SHIPPING_FEE } from "@/lib/catalog/products";
import { formatGBP } from "@/lib/money";
import { getStoreContext } from "@/lib/storefront/context";

const TOPICS = ["delivery", "returns"] as const;
type Topic = (typeof TOPICS)[number];

export function generateStaticParams() {
  return TOPICS.map((topic) => ({ topic }));
}

export default async function HelpPage(props: PageProps<"/store/help/[topic]">) {
  const { topic } = await props.params;
  if (!TOPICS.includes(topic as Topic)) notFound();
  const ctx = await getStoreContext(props.searchParams);
  const threshold = ctx.spec.cart.freeShippingThreshold;

  const sections: Record<Topic, { title: string; rows: [string, string][] }> = {
    delivery: {
      title: "Delivery",
      rows: [
        ["UK standard delivery", `${formatGBP(SHIPPING_FEE)}, 2–4 working days. Each product page shows its own delivery estimate.`],
        ["Free delivery", threshold !== null ? `On orders over ${formatGBP(threshold)}.` : "Not currently offered."],
        ["Where we deliver", "Mainland UK, Northern Ireland and the Channel Islands."],
        ["Tracking", "You'll get a tracking link by email as soon as your order ships."],
      ],
    },
    returns: {
      title: "Returns",
      rows: [
        ["Footwear", "Free returns within 60 days, even if you've run in them."],
        ["Accessories", "Returns within 30 days, unused and in original packaging. Return postage is paid by you."],
        ["Refunds", "Back to your original payment method within 5 working days of the return arriving."],
        ["How to return", "Start a return from your order confirmation email; we'll email a prepaid label."],
      ],
    },
  };
  const s = sections[topic as Topic];

  return (
    <StoreShell ctx={ctx}>
      <PageView page={`help-${topic}`} />
      <Container className="max-w-3xl py-14 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{s.title}</h1>
        <dl className="mt-8 divide-y divide-(--line) border-y border-(--line)">
          {s.rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-medium">{k}</dt>
              <dd className="text-(--muted)">{v}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </StoreShell>
  );
}
