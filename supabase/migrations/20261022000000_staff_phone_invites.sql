-- Staff without a company email sign in with their phone number. The admin adds them by name + phone
-- and shares a one-time set-up link; the staff member chooses their own password.

alter table public.users add column if not exists phone text unique;

-- One-time set-up links. Only a SHA-256 hash of the token is stored; the link itself is shown once.
create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references public.users (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_invites_user_idx on public.staff_invites (user_id);
-- No policies: browsers can never read invites; only server code (service role) touches them.
alter table public.staff_invites enable row level security;
