import type { Metadata } from "next";
import { OrderConfirmation } from "@/components/order-confirmation";

export const metadata: Metadata = { title: "Thank you" };

export default async function OrderPage({ params }: PageProps<"/order/[id]">) {
  const { id } = await params;
  return <OrderConfirmation id={id} />;
}
