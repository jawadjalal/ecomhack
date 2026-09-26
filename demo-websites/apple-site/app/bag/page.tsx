import type { Metadata } from "next";
import { getSpec } from "@/lib/spec";
import { BagView } from "@/components/bag-view";

export const metadata: Metadata = { title: "Bag" };

export default async function BagPage() {
  const { spec } = await getSpec();
  return <BagView cart={spec.cart} />;
}
