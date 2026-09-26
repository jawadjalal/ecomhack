"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@/lib/contracts/team";
import type { TeamInboxResponse } from "@/lib/contracts/watch";
import { PillButton } from "@/components/dw/ui";

/**
 * Darwin's Inbox, and the group chat a signal opened. Tapping an action spends its token through
 * POST /api/team/chat, the same confirm gate as everything else.
 */
export function InboxScreen({ chatId }: { chatId: string | null }) {
  const [inbox, setInbox] = useState<TeamInboxResponse | null>(null);
  const [thread, setThread] = useState<{ chatId: string; messages: ChatMessage[] } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch("/api/team/inbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: TeamInboxResponse | null) => {
        if (body) setInbox(body);
      })
      .catch(() => {});
    if (!chatId) return;
    const id = chatId;
    fetch(`/api/team/chats/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { messages?: ChatMessage[] } | null) => setThread({ chatId: id, messages: body?.messages ?? [] }))
      .catch(() => setThread({ chatId: id, messages: [] }));
  };

  useEffect(() => {
    let stop = false;
    fetch("/api/team/inbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: TeamInboxResponse | null) => {
        if (!stop && body) setInbox(body);
      })
      .catch(() => {});
    if (chatId) {
      const id = chatId;
      fetch(`/api/team/chats/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { messages?: ChatMessage[] } | null) => {
          if (!stop) setThread({ chatId: id, messages: body?.messages ?? [] });
        })
        .catch(() => {
          if (!stop) setThread({ chatId: id, messages: [] });
        });
    }
    return () => {
      stop = true;
    };
  }, [chatId]);

  const decide = async (token: string, approved: boolean) => {
    setBusy(token);
    setNote("");
    try {
      const res = await fetch("/api/team/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: { id: token, approved }, text: "" }),
      });
      const raw = await res.text();
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      const last = [...lines]
        .reverse()
        .map((l) => {
          try {
            return JSON.parse(l) as { type?: string; message?: { text?: string; from?: string; kind?: string } };
          } catch {
            return null;
          }
        })
        .find((e) => e?.type === "message" && e.message?.from === "darwin" && (e.message.kind === "report" || e.message.kind === "text"));
      setNote(last?.message?.text ?? (res.ok ? "Done." : raw.slice(0, 240)));
      load();
    } finally {
      setBusy(null);
    }
  };

  const messages = thread && thread.chatId === chatId ? thread.messages : null;

  return (
    <div className="flex flex-col gap-5 px-1">
      <header>
        <h1 className="text-[32px] font-semibold tracking-[-0.03em]">Inbox</h1>
        <p className="mt-1 text-[15px] text-dw-ink/70">What Darwin noticed, and the one thing he would do about it. Simulated numbers say so.</p>
      </header>
      {messages && (
        <section className="flex flex-col gap-2 rounded-[22px] border border-dw-hairline bg-dw-surface p-4" aria-label="Team chat">
          <h2 className="text-[15px] font-semibold">The team on this one</h2>
          {messages.map((m) => (
            <p key={m.id} className="text-[14px] leading-snug">
              <span className="font-semibold capitalize">{m.from}. </span>
              {m.text}
              {m.synthetic ? <span className="text-dw-ink/50"> (simulated)</span> : null}
            </p>
          ))}
        </section>
      )}
      <ul className="flex flex-col gap-3">
        {(inbox?.messages ?? [])
          .slice()
          .reverse()
          .map((m) => (
            <li key={m.id} className="rounded-[22px] border border-dw-hairline bg-dw-surface px-4 py-3">
              <p className="text-[15px] leading-snug">{m.text}</p>
              {m.synthetic && <p className="mt-1 text-[12px] text-dw-ink/50">Simulated traffic</p>}
              {m.actions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.actions.map((a) => (
                    <PillButton key={a.token} size="sm" tone={a.kind === "dismiss" ? "white" : "ink"} disabled={busy === a.token} onClick={() => void decide(a.token, true)}>
                      {busy === a.token ? "Working…" : a.label}
                    </PillButton>
                  ))}
                </div>
              )}
            </li>
          ))}
        {inbox && inbox.messages.length === 0 && <li className="text-[14px] text-dw-ink/60">Nothing yet. Darwin checks every 15 minutes, and only writes when something is worth it.</li>}
      </ul>
      {note && <p className="text-[14.5px] leading-snug">{note}</p>}
    </div>
  );
}
