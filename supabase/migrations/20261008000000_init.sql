-- Motogari shared inbox: core schema
-- Workflow state lives on `conversations` (one row per Gmail thread). `emails` holds individual messages.
-- Gmail read/unread state is intentionally NOT stored or used for workflow.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'staff');
create type public.conversation_status as enum ('new', 'assigned', 'in_progress', 'waiting', 'resolved', 'archived');
create type public.email_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.email_direction as enum ('inbound', 'outbound');

-- ---------------------------------------------------------------------------
-- Users (1:1 with auth.users; passwords are hashed and managed by Supabase Auth)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete restrict,
  name text not null,
  email text not null unique,
  role public.user_role not null default 'staff',
  department text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#64748b',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.sla_rules (
  priority public.email_priority primary key,
  resolution_minutes int not null check (resolution_minutes > 0),
  warn_before_minutes int not null default 0 check (warn_before_minutes >= 0),
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Mail connection (server-only; tokens are AES-256-GCM encrypted by the app)
-- ---------------------------------------------------------------------------
create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gmail', 'mock')),
  email_address text not null,
  encrypted_refresh_token text,
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  scopes text,
  history_id text,
  watch_expiration timestamptz,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  import_window_days int not null default 30 check (import_window_days in (7, 30, 90, 365)),
  initial_import_done boolean not null default false,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  sync_lock_until timestamptz,
  connected_by uuid references public.users (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index mail_connections_one_active on public.mail_connections ((is_active)) where is_active;

create table public.sync_logs (
  id bigint generated always as identity primary key,
  level text not null check (level in ('info', 'warn', 'error')),
  message text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Conversations (workflow unit) and emails (messages)
-- `channel` leaves room for WhatsApp/SMS/web enquiries later.
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email',
  gmail_thread_id text not null unique,
  subject text not null default '(no subject)',
  customer_name text,
  customer_email text,
  status public.conversation_status not null default 'new',
  priority public.email_priority not null default 'normal',
  assigned_to uuid references public.users (id),
  category_id uuid references public.categories (id),
  snippet text,
  message_count int not null default 0,
  has_attachments boolean not null default false,
  is_historical boolean not null default false,
  reopened_count int not null default 0,
  first_inbound_at timestamptz,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_activity_at timestamptz not null default now(),
  first_response_at timestamptz,
  first_response_by uuid references public.users (id),
  resolved_at timestamptz,
  resolved_by uuid references public.users (id),
  sla_started_at timestamptz,
  sla_due_at timestamptz,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.emails (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete restrict,
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  message_id text,
  in_reply_to text,
  references_header text,
  direction public.email_direction not null,
  sender_name text,
  sender_email text,
  reply_to text,
  recipient_email text,
  cc text,
  bcc text,
  subject text,
  body_text text,
  body_html text,
  snippet text,
  received_at timestamptz not null,
  has_attachments boolean not null default false,
  labels text[] not null default '{}',
  sent_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(sender_name, '') || ' ' || coalesce(sender_email, '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(body_text, ''), 200000)), 'C')
  ) stored
);

create table public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.emails (id) on delete restrict,
  gmail_attachment_id text,
  part_id text,
  filename text not null,
  mime_type text not null default 'application/octet-stream',
  size bigint not null default 0,
  content_id text,
  storage_path text,
  created_at timestamptz not null default now(),
  unique (email_id, part_id)
);

create table public.email_assignments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete restrict,
  user_id uuid not null references public.users (id),
  assigned_by uuid references public.users (id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

create table public.email_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete restrict,
  user_id uuid not null references public.users (id),
  note text not null check (length(note) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_events (
  id bigint generated always as identity primary key,
  conversation_id uuid references public.conversations (id) on delete restrict,
  email_id uuid references public.emails (id) on delete restrict,
  user_id uuid references public.users (id),
  event_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  type text not null,
  title text not null,
  body text,
  conversation_id uuid references public.conversations (id),
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

-- Development-only mailbox used by MAIL_PROVIDER=mock. Never used in Gmail mode.
create table public.mock_mailbox (
  history_id bigint generated always as identity primary key,
  id text not null unique,
  thread_id text not null,
  message jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index emails_conversation_idx on public.emails (conversation_id, received_at);
create index emails_thread_idx on public.emails (gmail_thread_id);
create index emails_received_idx on public.emails (received_at desc);
create index emails_sender_idx on public.emails (lower(sender_email));
create index emails_search_idx on public.emails using gin (search_vector);
create index conversations_status_idx on public.conversations (status);
create index conversations_assigned_idx on public.conversations (assigned_to);
create index conversations_priority_idx on public.conversations (priority);
create index conversations_last_msg_idx on public.conversations (last_message_at desc);
create index conversations_customer_idx on public.conversations (lower(customer_email));
create index conversations_sla_idx on public.conversations (sla_due_at) where status in ('new', 'assigned', 'in_progress');
create index conversations_category_idx on public.conversations (category_id);
create index events_conversation_idx on public.email_events (conversation_id, created_at);
create index events_created_idx on public.email_events (created_at desc);
create index events_user_idx on public.email_events (user_id, created_at desc);
create index events_type_idx on public.email_events (event_type, created_at desc);
create index notes_conversation_idx on public.email_notes (conversation_id, created_at);
create index assignments_conversation_idx on public.email_assignments (conversation_id, assigned_at);
create index attachments_email_idx on public.email_attachments (email_id);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger users_touch before update on public.users for each row execute function public.touch_updated_at();
create trigger emails_touch before update on public.emails for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.email_notes for each row execute function public.touch_updated_at();
create trigger mail_connections_touch before update on public.mail_connections for each row execute function public.touch_updated_at();

-- Conversations: optimistic-concurrency version + SLA due date derived from priority rules.
create or replace function public.conversations_before_write() returns trigger language plpgsql as $$
declare
  mins int;
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  if tg_op = 'INSERT'
     or new.priority is distinct from old.priority
     or new.sla_started_at is distinct from old.sla_started_at then
    select resolution_minutes into mins from public.sla_rules where priority = new.priority;
    if new.sla_started_at is null or mins is null then
      new.sla_due_at := null;
    else
      new.sla_due_at := new.sla_started_at + make_interval(mins => mins);
    end if;
  end if;
  return new;
end $$;
create trigger conversations_before_write before insert or update on public.conversations
  for each row execute function public.conversations_before_write();

-- Audit log is append-only for everyone, including the service role.
create or replace function public.forbid_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'email_events is append-only';
end $$;
create trigger email_events_immutable before update or delete on public.email_events
  for each row execute function public.forbid_event_mutation();

create or replace function public.recompute_sla() returns void language sql as $$
  update public.conversations c
     set sla_due_at = c.sla_started_at + make_interval(mins => r.resolution_minutes)
    from public.sla_rules r
   where r.priority = c.priority and c.sla_started_at is not null
     and c.status not in ('resolved', 'archived');
$$;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and is_active and role = 'admin');
$$;

create or replace function public.app_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'timezone'), 'Africa/Nairobi');
$$;

create or replace function public.hit_rate_limit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.rate_limits;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end,
        window_start = case when rl.window_start < now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning * into r;
  return r.count <= p_max;
end $$;

create or replace function public.acquire_sync_lock(p_connection uuid, p_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.mail_connections
     set sync_lock_until = now() + make_interval(secs => p_seconds)
   where id = p_connection and is_active and (sync_lock_until is null or sync_lock_until < now());
  return found;
end $$;

-- ---------------------------------------------------------------------------
-- Inbox query (runs as the caller, so RLS applies)
-- ---------------------------------------------------------------------------
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
         when 'all' then c.status <> 'archived'
         when 'new' then c.status = 'new'
         when 'unassigned' then c.assigned_to is null and c.status not in ('resolved', 'archived')
         when 'mine' then c.assigned_to = auth.uid() and c.status not in ('resolved', 'archived')
         when 'assigned' then c.status = 'assigned'
         when 'in_progress' then c.status = 'in_progress'
         when 'waiting' then c.status = 'waiting'
         when 'resolved' then c.status = 'resolved'
         when 'archived' then c.status = 'archived'
         when 'urgent' then c.priority = 'urgent' and c.status not in ('resolved', 'archived')
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
     case when f.priority = 'urgent' and f.status not in ('resolved', 'archived') then 0 else 1 end,
     f.last_message_at desc nulls last
   limit v_limit offset v_offset;
end $$;

create or replace function public.inbox_counts() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'new', count(*) filter (where status = 'new'),
    'unassigned', count(*) filter (where assigned_to is null and status not in ('resolved', 'archived')),
    'assigned', count(*) filter (where status = 'assigned'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'waiting', count(*) filter (where status = 'waiting'),
    'overdue', count(*) filter (where sla_due_at < now() and status in ('new', 'assigned', 'in_progress')),
    'urgent', count(*) filter (where priority = 'urgent' and status not in ('resolved', 'archived')),
    'mine', count(*) filter (where assigned_to = auth.uid() and status not in ('resolved', 'archived')),
    'resolved_today', count(*) filter (where status = 'resolved'
        and resolved_at >= (date_trunc('day', now() at time zone public.app_tz()) at time zone public.app_tz()))
  )
  from public.conversations;
$$;

-- Management analytics. Admin only.
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
    'received_today', (select count(*) from emails where direction = 'inbound' and received_at >= today_start),
    'received_week', (select count(*) from emails where direction = 'inbound' and received_at >= week_start),
    'new_today', (select count(*) from conversations where first_inbound_at >= today_start and not is_historical),
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
         where c.last_message_at >= range_start and not c.is_historical
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
               (select count(*) from emails e where e.direction = 'inbound'
                  and e.received_at >= (d at time zone tz) and e.received_at < ((d + interval '1 day') at time zone tz)) as received,
               (select count(*) from email_events ev where ev.event_type = 'email_resolved'
                  and ev.created_at >= (d at time zone tz) and ev.created_at < ((d + interval '1 day') at time zone tz)) as resolved
          from generate_series((range_start at time zone tz)::date, (today_start at time zone tz)::date, interval '1 day') d) x), '[]'::jsonb)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- All writes go through server code using the service role after explicit
-- authorization checks. Browsers only ever read, and only as an active user.
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.sla_rules enable row level security;
alter table public.app_settings enable row level security;
alter table public.mail_connections enable row level security;
alter table public.sync_logs enable row level security;
alter table public.conversations enable row level security;
alter table public.emails enable row level security;
alter table public.email_attachments enable row level security;
alter table public.email_assignments enable row level security;
alter table public.email_notes enable row level security;
alter table public.email_events enable row level security;
alter table public.notifications enable row level security;
alter table public.rate_limits enable row level security;
alter table public.mock_mailbox enable row level security;

create policy users_read on public.users for select to authenticated using (id = auth.uid() or public.is_active_user());
create policy categories_read on public.categories for select to authenticated using (public.is_active_user());
create policy sla_read on public.sla_rules for select to authenticated using (public.is_active_user());
create policy settings_read on public.app_settings for select to authenticated using (public.is_active_user());
create policy conversations_read on public.conversations for select to authenticated using (public.is_active_user());
create policy emails_read on public.emails for select to authenticated using (public.is_active_user());
create policy attachments_read on public.email_attachments for select to authenticated using (public.is_active_user());
create policy assignments_read on public.email_assignments for select to authenticated using (public.is_active_user());
create policy notes_read on public.email_notes for select to authenticated using (public.is_active_user());
create policy events_read on public.email_events for select to authenticated using (public.is_active_user());
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid() and public.is_active_user());
create policy sync_logs_read on public.sync_logs for select to authenticated using (public.is_admin());
-- mail_connections, rate_limits, mock_mailbox: no policies => service role only.

revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
revoke execute on function public.acquire_sync_lock(uuid, int) from public, anon, authenticated;
revoke execute on function public.recompute_sla() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.notifications;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
insert into public.categories (name, color, sort_order) values
  ('Customer Enquiry', '#2563eb', 1),
  ('Booking', '#7c3aed', 2),
  ('Payment', '#059669', 3),
  ('Complaint', '#dc2626', 4),
  ('Support', '#0891b2', 5),
  ('Supplier', '#ca8a04', 6),
  ('Partnership', '#db2777', 7),
  ('General', '#64748b', 8),
  ('Other', '#94a3b8', 9);

insert into public.sla_rules (priority, resolution_minutes, warn_before_minutes) values
  ('low', 4320, 240),
  ('normal', 1440, 120),
  ('high', 240, 30),
  ('urgent', 60, 15);

insert into public.app_settings (key, value) values
  ('timezone', '"Africa/Nairobi"'),
  ('import_as_active', 'false'),
  ('onboarding_complete', 'false');
