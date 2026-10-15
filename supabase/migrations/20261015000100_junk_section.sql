-- Junk section: Gmail spam and mail from senders staff have marked as junk.
-- Junk never counts as work or as received customer email.

create table if not exists public.junk_senders (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('address', 'domain')),
  value text not null check (value = lower(value) and value <> ''),
  created_by uuid references public.users (id),
  source_conversation_id uuid references public.conversations (id) on delete set null,
  match_count int not null default 0,
  last_matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, value)
);
alter table public.junk_senders enable row level security;
drop policy if exists junk_senders_read on public.junk_senders;
create policy junk_senders_read on public.junk_senders for select to authenticated using (public.is_active_user());

create index if not exists conversations_customer_email_idx on public.conversations (customer_email);


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
         when 'all' then c.status not in ('archived', 'no_action', 'junk')
         when 'new' then c.status = 'new'
         when 'unassigned' then c.assigned_to is null and c.status in ('new', 'assigned', 'in_progress', 'waiting')
         when 'mine' then c.assigned_to = auth.uid() and c.status in ('new', 'assigned', 'in_progress', 'waiting')
         when 'assigned' then c.status = 'assigned'
         when 'in_progress' then c.status = 'in_progress'
         when 'waiting' then c.status = 'waiting'
         when 'resolved' then c.status = 'resolved'
         when 'archived' then c.status = 'archived'
         when 'updates' then c.status = 'no_action'
         when 'junk' then c.status = 'junk'
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
    'junk', count(*) filter (where status = 'junk' and last_message_at >= now() - interval '24 hours'),
    'resolved_today', count(*) filter (where status = 'resolved'
        and resolved_at >= (date_trunc('day', now() at time zone public.app_tz()) at time zone public.app_tz()))
  )
  from public.conversations;
$$;

-- Junk is not received customer email.
create or replace function public.analytics_summary(p_days int default 7) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  tz text := public.app_tz();
  today_start timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
  week_start timestamptz := today_start - make_interval(days => 6);
  range_start timestamptz := today_start - make_interval(days => greatest(p_days, 1) - 1);
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'received_today', (select count(*) from emails e where e.direction = 'inbound' and e.received_at >= today_start and not exists (select 1 from conversations jc where jc.id = e.conversation_id and jc.status = 'junk')),
    'received_week', (select count(*) from emails e where e.direction = 'inbound' and e.received_at >= week_start and not exists (select 1 from conversations jc where jc.id = e.conversation_id and jc.status = 'junk')),
    'new_today', (select count(*) from conversations where first_inbound_at >= today_start and not is_historical and status <> 'junk'),
    'resolved_today', (select count(*) from email_events where event_type = 'email_resolved' and created_at >= today_start),
    'resolved_week', (select count(*) from email_events where event_type = 'email_resolved' and created_at >= week_start),
    'unresolved', (select count(*) from conversations where status in ('new', 'assigned', 'in_progress', 'waiting')),
    'overdue', (select count(*) from conversations where sla_due_at < now() and status in ('new', 'assigned', 'in_progress')),
    'avg_first_response_minutes', (
      select round(avg(extract(epoch from (first_response_at - first_inbound_at)) / 60)::numeric, 1)
        from conversations where first_response_at >= range_start and first_inbound_at is not null and not is_historical),
    'avg_resolution_minutes', (
      select round(avg(extract(epoch from (resolved_at - sla_started_at)) / 60)::numeric, 1)
        from conversations where resolved_at >= range_start and sla_started_at is not null),
    'by_category', coalesce((
      select jsonb_agg(row_to_json(x) order by x.count desc) from (
        select coalesce(cat.name, 'Uncategorised') as name, coalesce(cat.color, '#94a3b8') as color, count(*) as count
          from conversations c left join categories cat on cat.id = c.category_id
         where c.last_message_at >= range_start and not c.is_historical and c.status <> 'junk'
         group by 1, 2) x), '[]'::jsonb),
    'by_staff', coalesce((
      select jsonb_agg(row_to_json(x) order by x.name) from (
        select u.id, u.name, u.department,
               (select count(*) from conversations c where c.assigned_to = u.id and c.status in ('new', 'assigned', 'in_progress', 'waiting')) as open_assigned,
               (select count(*) from email_events ev where ev.user_id = u.id and ev.event_type = 'email_resolved' and ev.created_at >= range_start) as resolved,
               (select count(*) from email_events ev where ev.user_id = u.id and ev.event_type = 'reply_sent' and ev.created_at >= range_start) as replies,
               (select round(avg(extract(epoch from (c.first_response_at - c.first_inbound_at)) / 60)::numeric, 1)
                  from conversations c where c.first_response_by = u.id and c.first_response_at >= range_start) as avg_response_minutes
          from users u where u.is_active) x), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(row_to_json(x) order by x.day) from (
        select d::date as day,
               (select count(*) from emails e where e.direction = 'inbound' and not exists (select 1 from conversations jc where jc.id = e.conversation_id and jc.status = 'junk')
                  and e.received_at >= (d at time zone tz) and e.received_at < ((d + interval '1 day') at time zone tz)) as received,
               (select count(*) from email_events ev where ev.event_type = 'email_resolved'
                  and ev.created_at >= (d at time zone tz) and ev.created_at < ((d + interval '1 day') at time zone tz)) as resolved
          from generate_series((range_start at time zone tz)::date, (today_start at time zone tz)::date, interval '1 day') d) x), '[]'::jsonb)
  ) into result;
  return result;
end $$;
