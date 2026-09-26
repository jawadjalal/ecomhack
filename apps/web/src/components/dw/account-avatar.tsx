"use client";

/**
 * The header avatar: the merchant's initials from their Darwin account (GET /api/account, a sealed cookie set
 * when they save their email in onboarding), else a neutral person icon. The console top bar opens its account
 * menu from it (`AvatarFace` + `useAccount`); `AccountAvatar` is the plain link to Settings.
 */
import Link from "next/link";
import useSWR from "swr";
import { UserRound } from "lucide-react";

interface AccountInfo {
  email?: string;
  initials?: string;
  sites: string[];
}

const fetchAccount = async (url: string): Promise<AccountInfo> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { sites: [] };
  return (await res.json()) as AccountInfo;
};

export function useAccount(): AccountInfo | undefined {
  const { data } = useSWR<AccountInfo>("/api/account", fetchAccount, { revalidateOnFocus: true, dedupingInterval: 10_000 });
  return data;
}

/** Initials, else a person icon. */
export function AvatarFace({ account }: { account?: AccountInfo }) {
  const initials = account?.initials?.slice(0, 2);
  return initials ? <>{initials}</> : <UserRound className="size-5 max-sm:size-4" aria-hidden />;
}

export function AccountAvatar() {
  const data = useAccount();
  return (
    <Link
      href="/console/settings"
      aria-label="Profile and settings"
      title={data?.email ? `Signed in as ${data.email}` : "Profile and settings"}
      className="grid size-11 place-items-center rounded-full bg-dw-ink text-[14px] font-semibold text-white transition-transform hover:scale-[1.06] max-sm:size-9 max-sm:text-[12.5px]"
    >
      <AvatarFace account={data} />
    </Link>
  );
}
