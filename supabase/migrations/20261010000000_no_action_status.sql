-- Newsletters, notifications and other mail that needs no reply. Kept in its own migration because
-- a new enum value cannot be used in the same transaction that adds it.
alter type public.conversation_status add value if not exists 'no_action';

alter table public.conversations add column if not exists filed_reason text;
