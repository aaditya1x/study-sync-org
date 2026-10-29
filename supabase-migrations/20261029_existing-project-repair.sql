-- Existing-project repair for Study Sync.
-- Run supabase-read-only-audit.sql first in the intended Supabase project.
-- This migration preserves rows and uploaded objects. It never disables RLS
-- or modifies unrelated policies. It explicitly makes study-materials private.

begin;

-- Bucket preflight comes before policy changes. Missing lowercase buckets are
-- allowed and created below. An existing study-materials bucket may be public;
-- this migration will make it private without modifying its stored objects.
do $$
begin
  if exists (
    select 1 from storage.buckets
    where id = 'study-materials'
      and file_size_limit is distinct from 52428800
  ) then
    raise exception 'study-materials has an unexpected size limit. Review manually; expected 52,428,800 bytes.';
  end if;
  if exists (
    select 1 from storage.buckets
    where id = 'profile-photos'
      and (public is distinct from false or file_size_limit is distinct from 2097152)
  ) then
    raise exception 'profile-photos exists with unexpected visibility or size. Review manually; expected private and 2,097,152 bytes.';
  end if;
  if exists (select 1 from storage.buckets where id = 'Profile-photos' and public is true) then
    raise exception 'A separate public Profile-photos bucket exists. Review its files and visibility manually; this migration will not alter or delete it.';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('study-materials', 'study-materials', false, 52428800),
  ('profile-photos', 'profile-photos', false, 2097152)
on conflict (id) do nothing;

-- Changing bucket visibility does not delete or rewrite Storage objects.
-- Public object URLs will stop working; the app uses authenticated signed URLs.
update storage.buckets
set public = false
where id = 'study-materials';

-- Verify both intended bucket IDs and configurations before touching policies.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'study-materials' and public is false and file_size_limit = 52428800
  ) then
    raise exception 'study-materials is missing or not private at 52,428,800 bytes; no policies were changed.';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id = 'profile-photos' and public is false and file_size_limit = 2097152
  ) then
    raise exception 'profile-photos is missing or not private at 2,097,152 bytes; no policies were changed.';
  end if;
end;
$$;

-- Fail before policy edits if the tables/ownership columns differ from the app.
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('courses', 'owner_id'),
      ('study_materials', 'user_id'),
      ('user_app_data', 'user_id'),
      ('book_chunks', 'user_id')
    ) as expected(table_name, owner_column)
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = item.table_name
        and column_name = item.owner_column
    ) then
      raise exception 'Expected public.%.% was not found. Review the audit output; no RLS policies were changed.', item.table_name, item.owner_column;
    end if;
  end loop;
end;
$$;

alter table public.study_materials
  add column if not exists is_indexed boolean not null default false;

-- Remove the identified broad PUBLIC/anon table policies only when their
-- current command and predicate still show no auth.uid() owner restriction.
-- Owner-scoped policies with these names are retained.
do $$
declare
  item record;
  current_policy record;
  owner_column text;
  policy_expr text;
begin
  for item in
    select * from (values
      ('courses', 'Anyone can add shared courses', 'INSERT'),
      ('courses', 'Anyone can read shared courses', 'SELECT'),
      ('courses', 'Anyone reads courses', 'SELECT'),
      ('study_materials', 'Anyone can add study materials', 'INSERT'),
      ('study_materials', 'Anyone can view study materials', 'SELECT')
    ) as targets(table_name, policy_name, expected_cmd)
  loop
    owner_column := case when item.table_name = 'courses' then 'owner_id' else 'user_id' end;
    select roles, cmd, qual, with_check
      into current_policy
    from pg_policies
    where schemaname = 'public'
      and tablename = item.table_name
      and policyname = item.policy_name;

    if found
       and current_policy.cmd = item.expected_cmd
       and (current_policy.roles @> array['anon'::name]
            or current_policy.roles @> array['public'::name]) then
      policy_expr := case
        when item.expected_cmd = 'INSERT' then current_policy.with_check
        else current_policy.qual
      end;
      if lower(coalesce(policy_expr, '')) not like '%auth.uid%'
         or lower(coalesce(policy_expr, '')) not like '%' || lower(owner_column) || '%' then
        execute format('drop policy %I on public.%I', item.policy_name, item.table_name);
      end if;
    end if;
  end loop;
end;
$$;

-- Remove only the explicitly reported broad Storage rules when they still
-- target study-materials and have no auth.uid()/folder restriction.
-- Remove named legacy anon/profile duplicates; all other profile policies remain
-- and are constrained by the restrictive folder guard below.
do $$
declare
  policy_roles name[];
  policy_expr text;
  policy_cmd text;
begin
  select roles, qual, cmd into policy_roles, policy_expr, policy_cmd
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'Anyone can read study material files';
  if found
     and policy_cmd = 'SELECT'
     and (policy_roles @> array['anon'::name] or policy_roles @> array['public'::name])
     and lower(coalesce(policy_expr, '')) like '%study-materials%'
     and lower(coalesce(policy_expr, '')) not like '%auth.uid%'
     and lower(coalesce(policy_expr, '')) not like '%foldername%' then
    execute 'drop policy "Anyone can read study material files" on storage.objects';
  end if;

  select roles, with_check, cmd into policy_roles, policy_expr, policy_cmd
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'Anyone can upload study material files';
  if found
     and policy_cmd = 'INSERT'
     and (policy_roles @> array['anon'::name] or policy_roles @> array['public'::name])
     and lower(coalesce(policy_expr, '')) like '%study-materials%'
     and lower(coalesce(policy_expr, '')) not like '%auth.uid%'
     and lower(coalesce(policy_expr, '')) not like '%foldername%' then
    execute 'drop policy "Anyone can upload study material files" on storage.objects';
  end if;

  -- This exact policy explicitly grants anon JPG access and references the
  -- mismatched legacy profile bucket/folder. Remove only that named rule.
  select roles, qual, cmd into policy_roles, policy_expr, policy_cmd
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname = 'Give anon users access to JPG images in folder i2tdtx_0';
  if found
     and policy_cmd in ('SELECT', 'ALL')
     and (policy_roles @> array['anon'::name] or policy_roles @> array['public'::name])
     and lower(coalesce(policy_expr, '')) like '%profile-photos%'
     and lower(coalesce(policy_expr, '')) not like '%auth.uid%' then
    execute 'drop policy "Give anon users access to JPG images in folder i2tdtx_0" on storage.objects';
  end if;

  -- The _i2tdtx_0 entries are the explicitly reported duplicate profile rules.
  -- "Read own profile photos" is also redundant with the retained
  -- "Users read own profile photos" rule. Drop only these exact listed names;
  -- canonical rules and all unrelated policies remain. The own-folder policy
  -- below preserves legitimate owner access.
  execute 'drop policy if exists "Read own profile photos" on storage.objects';
  execute 'drop policy if exists " read own profile photos i2tdtx_0" on storage.objects';
  execute 'drop policy if exists "Users read own profile photos i2tdtx_0" on storage.objects';
  execute 'drop policy if exists "Users upload own profile photos i2tdtx_0" on storage.objects';
end;
$$;

-- Enforce owner-folder rules for both private buckets regardless of other
-- permissive policies. For all other buckets these guards evaluate true.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'study-materials-user-folder-access'
  ) then
    create policy "study-materials-user-folder-access"
      on storage.objects for all to authenticated
      using (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'study-materials' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'profile-photos-user-folder-access'
  ) then
    create policy "profile-photos-user-folder-access"
      on storage.objects for all to authenticated
      using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'study-materials-owner-folder-guard'
  ) then
    create policy "study-materials-owner-folder-guard"
      on storage.objects as restrictive for all to public
      using (bucket_id <> 'study-materials' or (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id <> 'study-materials' or (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'profile-photos-owner-folder-guard'
  ) then
    create policy "profile-photos-owner-folder-guard"
      on storage.objects as restrictive for all to public
      using (bucket_id <> 'profile-photos' or (storage.foldername(name))[1] = auth.uid()::text)
      with check (bucket_id <> 'profile-photos' or (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end;
$$;

-- Separate table RLS: retain existing owner-scoped policies and add only a
-- missing owner-scoped command. Restrictive guards clamp broader policies.
do $$
declare
  item record;
  action record;
  access_policy text;
  guard_policy text;
  has_safe_policy boolean;
begin
  for item in
    select * from (values
      ('courses', 'owner_id'),
      ('study_materials', 'user_id'),
      ('user_app_data', 'user_id'),
      ('book_chunks', 'user_id')
    ) as owners(table_name, owner_column)
  loop
    execute format('alter table public.%I enable row level security', item.table_name);
    guard_policy := item.table_name || '-owner-guard';

    for action in
      select * from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as commands(cmd)
    loop
      access_policy := item.table_name || '-owner-' || lower(action.cmd);
      select exists (
        select 1 from pg_policies p
        where p.schemaname = 'public'
          and p.tablename = item.table_name
          and (p.cmd = 'ALL' or p.cmd = action.cmd)
          and (p.roles @> array['authenticated'::name]
               or p.roles @> array['public'::name])
          and (action.cmd = 'INSERT' or (
            lower(coalesce(p.qual, '')) like '%' || lower(item.owner_column) || '%'
            and lower(coalesce(p.qual, '')) like '%auth.uid%'
          ))
          and (action.cmd not in ('INSERT', 'UPDATE') or (
            lower(coalesce(p.with_check, '')) like '%' || lower(item.owner_column) || '%'
            and lower(coalesce(p.with_check, '')) like '%auth.uid%'
          ))
      ) into has_safe_policy;

      if not has_safe_policy then
        if action.cmd = 'SELECT' then
          execute format(
            'create policy %I on public.%I as permissive for select to authenticated using (%I = auth.uid())',
            access_policy, item.table_name, item.owner_column
          );
        elsif action.cmd = 'INSERT' then
          execute format(
            'create policy %I on public.%I as permissive for insert to authenticated with check (%I = auth.uid())',
            access_policy, item.table_name, item.owner_column
          );
        elsif action.cmd = 'UPDATE' then
          execute format(
            'create policy %I on public.%I as permissive for update to authenticated using (%I = auth.uid()) with check (%I = auth.uid())',
            access_policy, item.table_name, item.owner_column, item.owner_column
          );
        else
          execute format(
            'create policy %I on public.%I as permissive for delete to authenticated using (%I = auth.uid())',
            access_policy, item.table_name, item.owner_column
          );
        end if;
      end if;
    end loop;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = item.table_name
        and policyname = guard_policy
    ) then
      execute format(
        'create policy %I on public.%I as restrictive for all to public using (%I = auth.uid()) with check (%I = auth.uid())',
        guard_policy, item.table_name, item.owner_column, item.owner_column
      );
    end if;
  end loop;
end;
$$;

-- SQL privileges are required in addition to RLS. These grants are scoped to
-- authenticated users; the owner policies above remain mandatory filters.
grant select, insert, update, delete on public.courses to authenticated;
grant select, insert, update, delete on public.study_materials to authenticated;
grant select, insert, update on public.user_app_data to authenticated;

notify pgrst, 'reload schema';
commit;
