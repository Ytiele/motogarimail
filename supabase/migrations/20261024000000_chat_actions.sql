-- Chat message actions: reply to a message, forward, edit, delete (for everyone), and
-- "delete conversation" for yourself (hides earlier messages of a 1:1 chat only for you).

alter table public.chat_messages add column if not exists reply_to_id uuid references public.chat_messages (id) on delete set null;
alter table public.chat_messages add column if not exists forwarded boolean not null default false;
alter table public.chat_messages add column if not exists edited_at timestamptz;
alter table public.chat_messages add column if not exists deleted_at timestamptz;

-- A deleted message keeps no content, so the "must have text or a file" rule allows deleted rows.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.chat_messages'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%attachment_path IS NOT NULL%'
  loop
    execute format('alter table public.chat_messages drop constraint %I', c);
  end loop;
end $$;
alter table public.chat_messages add constraint chat_messages_content_check
  check (deleted_at is not null or coalesce(char_length(body), 0) > 0 or attachment_path is not null);

create table if not exists public.chat_clears (
  user_id uuid not null references public.users (id) on delete cascade,
  peer_id uuid not null references public.users (id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
alter table public.chat_clears enable row level security;
drop policy if exists chat_clears_read on public.chat_clears;
create policy chat_clears_read on public.chat_clears for select to authenticated using (user_id = auth.uid());
