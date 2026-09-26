import type { Metadata } from "next";
import { AccountForm } from "@/components/account-form";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <AccountForm signup={mode === "signup"} />;
}
