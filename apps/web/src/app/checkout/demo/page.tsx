import type { Metadata } from "next";
import { DemoCheckout } from "@/components/agents/demo-checkout";
import { DEMO_CATALOG, formatPrice, paidOrderFor } from "@/lib/store-agent";

export const metadata: Metadata = { title: "Demo checkout · no real payment", robots: { index: false } };

/**
 * /checkout/demo?offer=…&ref=… — where the store agent's checkout links go while the Whop store isn't
 * connected. Paying records a labelled, simulated payment credited to the agent conversation (ref),
 * once: a ref that's already paid opens as "Already paid".
 */
export default async function DemoCheckoutPage({ searchParams }: PageProps<"/checkout/demo">) {
  const sp = await searchParams;
  const offer = DEMO_CATALOG.offers.find((o) => o.id === sp.offer);
  const ref = typeof sp.ref === "string" ? sp.ref : "";
  const alreadyPaid = !!offer && !!ref && !!paidOrderFor(ref);
  return (
    <DemoCheckout offer={offer ? { id: offer.id, title: offer.title, description: offer.description, price: formatPrice(offer) } : undefined} refId={ref} alreadyPaid={alreadyPaid} />
  );
}
