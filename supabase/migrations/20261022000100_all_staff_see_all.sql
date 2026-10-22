-- Every active staff member can see every conversation (incoming, assigned to others, resolved,
-- archived) and its messages, notes and history. Who may ACT is unchanged and enforced in server
-- code: claiming needs an unassigned conversation, assigning others is admin-only, and replying or
-- changing status/priority/category needs the owner or an admin.

create or replace function public.can_view_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (select 1 from public.conversations c where c.id = p_conversation);
$$;

drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
  using (public.is_active_user());
