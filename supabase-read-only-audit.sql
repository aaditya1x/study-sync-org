-- Read-only: inspect current schema, bucket configuration, and RLS policies.
-- Safe to run in Supabase SQL Editor; does not change project data or settings.
-- Run this in the intended Supabase project; the SQL itself cannot identify a project URL.

select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'courses', 'user_app_data', 'study_materials', 'book_chunks', 'profiles'
  )
order by table_name, ordinal_position;

-- Read-only: report declared foreign-key relationships involving courses and
-- study_materials, including the referenced columns and delete behavior.
select tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type,
       kcu.column_name, ccu.table_schema as referenced_table_schema,
       ccu.table_name as referenced_table_name, ccu.column_name as referenced_column_name,
       rc.delete_rule
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_catalog = kcu.constraint_catalog
 and tc.constraint_schema = kcu.constraint_schema
 and tc.constraint_name = kcu.constraint_name
 and tc.table_name = kcu.table_name
left join information_schema.constraint_column_usage ccu
  on tc.constraint_catalog = ccu.constraint_catalog
 and tc.constraint_schema = ccu.constraint_schema
 and tc.constraint_name = ccu.constraint_name
left join information_schema.referential_constraints rc
  on tc.constraint_catalog = rc.constraint_catalog
 and tc.constraint_schema = rc.constraint_schema
 and tc.constraint_name = rc.constraint_name
where tc.table_schema = 'public'
  and tc.table_name in ('courses', 'study_materials')
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
order by tc.table_name, tc.constraint_name, kcu.ordinal_position;

select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where (n.nspname = 'public'
       and c.relname in ('courses', 'user_app_data', 'study_materials', 'book_chunks', 'profiles'))
   or (n.nspname = 'storage' and c.relname = 'objects')
order by n.nspname, c.relname;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('study-materials', 'profile-photos')
order by id;

-- Read-only: expose table- and column-level SQL grants, including the course
-- progress/material counters that the college-wide course browser keeps private.
select grantee, table_name, 'table' as privilege_scope,
       privilege_type, null::text as column_name
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('courses', 'study_materials', 'user_app_data', 'book_chunks')
union all
select grantee, table_name, 'column' as privilege_scope,
       privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('courses', 'study_materials', 'user_app_data', 'book_chunks')
order by table_name, grantee, privilege_scope, privilege_type, column_name;

-- Read-only: verify metadata-to-Storage existence and ownership. Legacy paths
-- are reported for review but are valid when the object owner matches user_id.
select m.user_id,
       m.storage_path,
       split_part(m.storage_path, '/', 1) as path_owner_id,
       case when split_part(m.storage_path, '/', 1) = m.user_id::text
                  and position('/' in m.storage_path) > 0
            then 'user-folder' else 'legacy-path' end as path_layout,
       o.name is not null as storage_object_exists,
       o.owner_id::text as storage_owner_id,
       o.owner_id::text = m.user_id::text as storage_owner_matches
from public.study_materials m
left join storage.objects o
  on o.bucket_id = 'study-materials'
 and o.name = m.storage_path
where split_part(m.storage_path, '/', 1) <> m.user_id::text
   or position('/' in m.storage_path) = 0
   or o.name is null
   or o.owner_id::text is distinct from m.user_id::text
order by m.user_id, m.storage_path;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public'
       and tablename in ('courses', 'user_app_data', 'study_materials', 'book_chunks', 'profiles'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, policyname;
