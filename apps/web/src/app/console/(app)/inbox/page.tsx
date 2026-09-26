import { InboxScreen } from "@/components/dw/inbox/inbox-screen";

/** /console/inbox?chat=… — Darwin's pinned Inbox, or the group chat a signal opened. */
export default async function InboxPage({ searchParams }: PageProps<"/console/inbox">) {
  const sp = await searchParams;
  const chat = typeof sp.chat === "string" ? sp.chat : null;
  return <InboxScreen chatId={chat} />;
}
