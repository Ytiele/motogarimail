-- Visibility: admins see every conversation; staff see conversations assigned to them
-- plus unassigned ones waiting for an owner. Everything hanging off a conversation follows it.

create or replace function public.can_view_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.conversations c
      join public.users u on u.id = auth.uid() and u.is_active
     where c.id = p_conversation
       and (u.role = 'admin' or c.assigned_to = u.id or c.assigned_to is null)
  );
$$;

drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated
  using (public.is_active_user() and (public.is_admin() or assigned_to = auth.uid() or assigned_to is null));

drop policy if exists emails_read on public.emails;
create policy emails_read on public.emails for select to authenticated
  using (public.can_view_conversation(conversation_id));

drop policy if exists attachments_read on public.email_attachments;
create policy attachments_read on public.email_attachments for select to authenticated
  using (exists (select 1 from public.emails e where e.id = email_id and public.can_view_conversation(e.conversation_id)));

drop policy if exists assignments_read on public.email_assignments;
create policy assignments_read on public.email_assignments for select to authenticated
  using (public.can_view_conversation(conversation_id));

drop policy if exists notes_read on public.email_notes;
create policy notes_read on public.email_notes for select to authenticated
  using (public.can_view_conversation(conversation_id));

drop policy if exists events_read on public.email_events;
create policy events_read on public.email_events for select to authenticated
  using (case when conversation_id is null then public.is_admin() else public.can_view_conversation(conversation_id) end);
