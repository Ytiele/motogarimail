-- Junk / spam. Kept in its own migration because a new enum value cannot be used in the same
-- transaction that adds it.
alter type public.conversation_status add value if not exists 'junk';
