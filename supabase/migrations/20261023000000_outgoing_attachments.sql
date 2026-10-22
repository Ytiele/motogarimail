-- Private staging area for files attached to outgoing replies. Browsers upload with one-time signed
-- URLs issued by the server; the server reads them when sending and deletes them afterwards.
-- No storage policies: nothing here is readable or writable from the browser except via those URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('outgoing', 'outgoing', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
