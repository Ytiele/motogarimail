-- Team chat: direct messages between staff, with optional file/photo. Only the two participants can
-- read a message (RLS, also applied to Realtime). Writes go through server actions (service role).

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users (id),
  recipient_id uuid not null references public.users (id),
  body text check (char_length(body) <= 4000),
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size int,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id),
  check (coalesce(char_length(body), 0) > 0 or attachment_path is not null)
);
create index if not exists chat_messages_recipient_unread_idx on public.chat_messages (recipient_id) where read_at is null;
create index if not exists chat_messages_pair_idx
  on public.chat_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc);

alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.is_active_user() and auth.uid() in (sender_id, recipient_id));

-- Live delivery; Realtime applies the policy above, so each person only receives their own messages.
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

-- Private bucket for chat files (25 MB each). Uploads use one-time signed URLs; downloads go through
-- the app, which checks the viewer is in the conversation and hands out a 60-second link.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat', 'chat', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
