-- Third role: "chat" users can only use team chat. Kept in its own migration because a new enum
-- value cannot be used in the same transaction that adds it.
alter type public.user_role add value if not exists 'chat';
