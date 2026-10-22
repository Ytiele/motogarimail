-- Group chats ("rooms"). A message goes either to one person (recipient_id) or to a room (room_id).
-- Only current members can read a room, its members and its messages; Realtime applies the same rules.

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_room_members (
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  user_id uuid not null references public.users (id),
  joined_at timestamptz not null default now(),
  -- Messages after this point count as unread for this member.
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists chat_room_members_user_idx on public.chat_room_members (user_id);

alter table public.chat_messages alter column recipient_id drop not null;
alter table public.chat_messages add column if not exists room_id uuid references public.chat_rooms (id) on delete cascade;
alter table public.chat_messages drop constraint if exists chat_messages_target_check;
alter table public.chat_messages add constraint chat_messages_target_check check ((recipient_id is null) <> (room_id is null));
create index if not exists chat_messages_room_idx on public.chat_messages (room_id, created_at desc) where room_id is not null;

create or replace function public.is_chat_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chat_room_members m
      join public.users u on u.id = m.user_id and u.is_active
     where m.room_id = p_room and m.user_id = auth.uid()
  );
$$;

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (
    public.is_active_user()
    and (auth.uid() in (sender_id, recipient_id) or (room_id is not null and public.is_chat_member(room_id)))
  );

alter table public.chat_rooms enable row level security;
drop policy if exists chat_rooms_read on public.chat_rooms;
create policy chat_rooms_read on public.chat_rooms for select to authenticated using (public.is_chat_member(id));

alter table public.chat_room_members enable row level security;
drop policy if exists chat_room_members_read on public.chat_room_members;
create policy chat_room_members_read on public.chat_room_members for select to authenticated using (public.is_chat_member(room_id));

do $$
begin
  alter publication supabase_realtime add table public.chat_rooms;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.chat_room_members;
exception when duplicate_object then null;
end $$;
