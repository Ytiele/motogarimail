-- Chat-only accounts must never reach email data. Mail tables now require an active *mail* user
-- (admin or staff); team chat and the staff directory stay open to every active user.

create or replace function public.is_mail_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active and role in ('admin', 'staff'));
$$;

-- Messages, attachments, assignments, notes and history all follow this check.
create or replace function public.can_view_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mail_user() and exists (select 1 from public.conversations c where c.id = p_conversation);
$$;

drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations for select to authenticated using (public.is_mail_user());

drop policy if exists events_read on public.email_events;
create policy events_read on public.email_events for select to authenticated
  using (public.is_mail_user() and (case when conversation_id is null then public.is_admin() else public.can_view_conversation(conversation_id) end));

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid() and public.is_mail_user());

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to authenticated using (public.is_mail_user());

drop policy if exists sla_read on public.sla_rules;
create policy sla_read on public.sla_rules for select to authenticated using (public.is_mail_user());

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated using (public.is_mail_user());

drop policy if exists junk_senders_read on public.junk_senders;
create policy junk_senders_read on public.junk_senders for select to authenticated using (public.is_mail_user());

-- Analytics "per staff" only lists people who work on email.
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
          from users u where u.is_active and u.role <> 'chat') x), '[]'::jsonb),
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
