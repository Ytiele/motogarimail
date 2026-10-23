-- Remove the default "Other" category. Conversations tagged with it become uncategorised.
update public.conversations set category_id = null
 where category_id in (select id from public.categories where name = 'Other');
delete from public.categories where name = 'Other';
