-- Per-chat memory for the Telegram bot (src/lib/telegram/memory.ts).
-- Written with the service role. If this table is missing, Darwin keeps history in
-- process memory only and does not fail the webhook.

create table if not exists public.telegram_chats (
  chat_id       text        primary key,
  turns         jsonb       not null default '[]'::jsonb,
  denied_notice boolean     not null default false,
  updated_at    timestamptz not null default now()
);

comment on table public.telegram_chats is 'Recent Ask Darwin turns for each Telegram chat. Optional; the webhook degrades to in-memory history without it.';
