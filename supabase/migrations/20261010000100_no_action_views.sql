-- Inbox views and counters that understand 'no_action' (newsletters / notifications).
-- These conversations never count as work: not New, not Unassigned, never overdue.

create or replace function public.list_conversations(p jsonb)
returns table (
  id uuid, subject text, customer_name text, customer_email text,
  status public.conversation_status, priority public.email_priority,
  assigned_to uuid, assignee_name text, category_id uuid, category_name text, category_color text,
  snippet text, message_count int, has_attachments boolean, reopened_count int,
  last_message_at timestamptz, last_activity_at timestamptz, sla_due_at timestamptz,
  is_overdue boolean, total_count bigint
)
language plpgsql stable security invoker set search_path = public as $$
#variable_conflict use_column
declare
  v_view text := coalesce(p->>'view', 'all');
  v_q text := nullif(trim(p->>'q'), '');
  v_tsq tsquery;
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200);
  v_offset int := greatest(coalesce((p->>'offset')::int, 0), 0);
begin
  if v_q is not null then
    v_tsq := websearch_to_tsquery('english', v_q);
  end if;

  return query
  with filtered as (
    select c.*,
           (c.sla_due_at is not null and c.sla_due_at < now() and c.status in ('new', 'assigned', 'in_progress')) as overdue
      from public.conversations c
     where
       case v_view
         when 'all' then c.status not in ('archived', 'no_action')
         when 'new' then c.status = 'new'
         when 'unassigned' then c.assigned_to is null and c.status in ('new', 'assigned', 'in_progress', 'waiting')
         when 'mine' then c.assigned_to = auth.uid() and c.status in ('new', 'assigned', 'in_progress', 'waiting')
         when 'assigned' then c.status = 'assigned'
         when 'in_progress' then c.status = 'in_progress'
         when 'waiting' then c.status = 'waiting'
         when 'resolved' then c.status = 'resolved'
         when 'archived' then c.status = 'archived'
         when 'updates' then c.status = 'no_action'
         when 'urgent' then c.priority = 'urgent' and c.status in ('new', 'assigned', 'in_progress', 'waiting')
         when 'overdue' then c.sla_due_at < now() and c.status in ('new', 'assigned', 'in_progress')
         when 'resolved_today' then c.status = 'resolved'
              and c.resolved_at >= (date_trunc('day', now() at time zone public.app_tz()) at time zone public.app_tz())
         else true
       end
       and (p->>'status' is null or c.status = (p->>'status')::public.conversation_status)
       and (p->>'priority' is null or c.priority = (p->>'priority')::public.email_priority)
       and (p->>'category' is null or c.category_id = (p->>'category')::uuid)
       and (p->>'staff' is null or c.assigned_to = (p->>'staff')::uuid)
       and (p->>'from' is null or c.last_message_at >= (p->>'from')::date::timestamptz)
       and (p->>'to' is null or c.last_message_at < ((p->>'to')::date + 1)::timestamptz)
       and (
         v_q is null
         or c.subject ilike '%' || v_q || '%'
         or c.customer_name ilike '%' || v_q || '%'
         or c.customer_email ilike '%' || v_q || '%'
         or exists (select 1 from public.emails e where e.conversation_id = c.id and e.search_vector @@ v_tsq)
         or exists (select 1 from public.emails e where e.conversation_id = c.id and lower(e.sender_email) like '%' || lower(v_q) || '%')
       )
  )
  select f.id, f.subject, f.customer_name, f.customer_email, f.status, f.priority,
         f.assigned_to, u.name, f.category_id, cat.name, cat.color,
         f.snippet, f.message_count, f.has_attachments, f.reopened_count,
         f.last_message_at, f.last_activity_at, f.sla_due_at, f.overdue,
         count(*) over ()
    from filtered f
    left join public.users u on u.id = f.assigned_to
    left join public.categories cat on cat.id = f.category_id
   order by
     case when f.priority = 'urgent' and f.status in ('new', 'assigned', 'in_progress', 'waiting') then 0 else 1 end,
     f.last_message_at desc nulls last
   limit v_limit offset v_offset;
end $$;

create or replace function public.inbox_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'new', count(*) filter (where status = 'new'),
    'unassigned', count(*) filter (where assigned_to is null and status in ('new', 'assigned', 'in_progress', 'waiting')),
    'assigned', count(*) filter (where status = 'assigned'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'waiting', count(*) filter (where status = 'waiting'),
    'overdue', count(*) filter (where sla_due_at < now() and status in ('new', 'assigned', 'in_progress')),
    'urgent', count(*) filter (where priority = 'urgent' and status in ('new', 'assigned', 'in_progress', 'waiting')),
    'mine', count(*) filter (where assigned_to = auth.uid() and status in ('new', 'assigned', 'in_progress', 'waiting')),
    'updates', count(*) filter (where status = 'no_action' and last_message_at >= now() - interval '24 hours'),
    'resolved_today', count(*) filter (where status = 'resolved'
        and resolved_at >= (date_trunc('day', now() at time zone public.app_tz()) at time zone public.app_tz()))
  )
  from public.conversations;
$$;
