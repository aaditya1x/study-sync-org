-- Make shared study materials readable to authenticated students only.
-- The transaction converts the expected 50 MiB study-materials bucket to
-- private; existing object bytes are retained, but public URLs stop working.
-- New files use <auth.uid()>/<upload-id>-<filename>. Existing object access
-- is verified against storage.objects.owner_id and matching metadata, so
-- valid legacy paths without a user folder remain usable.
-- Review supabase-read-only-audit.sql before running in the intended project.
begin;

do $$
declare
  policy_row record;
  course_policy record;
  policy_expr text;
begin
  -- Validate the columns this migration actually uses. Personal app data and
  -- profile-photo tables/bucket policies are outside its scope.
  if to_regclass('public.study_materials') is null
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='study_materials' and column_name='user_id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='study_materials' and column_name='storage_path' and data_type='text')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='study_materials' and column_name='is_shared' and data_type='boolean')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='study_materials' and column_name='course_id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='owner_id' and data_type='uuid')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='progress')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='materials')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='title')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='code')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='course_code')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='semester')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='description')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='color')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='courses' and column_name='created_at') then
    raise exception 'Expected study material columns and every courses column used by policies, app queries, or column grants. Review supabase-read-only-audit.sql; no policy changes were made.';
  end if;

  if to_regclass('storage.objects') is null
     or not exists (select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='bucket_id' and data_type='text')
     or not exists (select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='name' and data_type='text')
     or not exists (select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id' and data_type in ('text','uuid')) then
    raise exception 'Expected storage.objects bucket_id/name text and owner_id text or uuid. Review the storage schema; no policy changes were made.';
  end if;

  if not exists (select 1 from storage.buckets where id='study-materials') then
    raise exception 'study-materials bucket is missing; no policy changes were made.';
  end if;
  if not exists (
    select 1 from storage.buckets
    where id='study-materials' and file_size_limit=52428800
  ) then
    raise exception 'study-materials has an unexpected or missing 50 MiB size limit. Review the bucket configuration; no policy changes were made.';
  end if;
  if not exists (select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'RLS is not enabled on storage.objects; no policy changes were made.';
  end if;
  if not exists (select 1 from pg_class where oid='public.courses'::regclass and relrowsecurity) then
    raise exception 'RLS is not enabled on courses, so course authorization cannot be checked by visibility. No policy changes were made.';
  end if;

  -- Verify every metadata row points to an existing object in this bucket and
  -- that Storage itself records the metadata uploader as the object owner.
  -- This intentionally accepts both current UUID-folder paths and legacy
  -- flat paths; it never repairs or changes the existing rows or objects.
  if exists (
    select 1
    from public.study_materials m
    left join storage.objects o
      on o.bucket_id = 'study-materials'
     and o.name = m.storage_path
    where o.name is null
       or o.owner_id::text is distinct from m.user_id::text
  ) then
    raise exception 'A study_materials row references a missing study-materials object or its storage.objects.owner_id differs from user_id. Review the affected rows; no policy changes were made.';
  end if;

  -- The audit identified these exact, unrestricted policies. Abort if they
  -- have changed since the audit rather than dropping an unexpected policy.
  select * into policy_row from pg_policies
  where schemaname='public' and tablename='study_materials' and policyname='Anyone can view study materials';
  if found and (policy_row.permissive <> 'PERMISSIVE'
     or policy_row.cmd <> 'SELECT' or policy_row.qual <> 'true'
     or not (policy_row.roles @> array['anon'::name, 'authenticated'::name])) then
    raise exception 'Anyone can view study materials no longer matches the audited unrestricted SELECT policy. Review policies; no policy changes were made.';
  end if;

  select * into policy_row from pg_policies
  where schemaname='public' and tablename='study_materials' and policyname='Anyone can add study materials';
  if found and (policy_row.permissive <> 'PERMISSIVE'
     or policy_row.cmd <> 'INSERT' or policy_row.with_check <> 'true'
     or not (policy_row.roles @> array['anon'::name, 'authenticated'::name])) then
    raise exception 'Anyone can add study materials no longer matches the audited unrestricted INSERT policy. Review policies; no policy changes were made.';
  end if;

  select * into policy_row from pg_policies
  where schemaname='storage' and tablename='objects' and policyname='Anyone can read study material files';
  if found and (policy_row.permissive <> 'PERMISSIVE'
     or policy_row.cmd not in ('SELECT', 'ALL')
     or not (policy_row.roles @> array['anon'::name] or policy_row.roles @> array['authenticated'::name] or policy_row.roles @> array['public'::name])
     or position('auth.uid()' in coalesce(policy_row.qual, '')) > 0
     or position('storage.foldername' in coalesce(policy_row.qual, '')) > 0
     or not (coalesce(policy_row.qual, '') = 'true'
             or position('study-materials' in coalesce(policy_row.qual, '')) > 0)) then
    raise exception 'Anyone can read study material files differs from the audited unrestricted SELECT policy. Review policies; no policy changes were made.';
  end if;

  select * into policy_row from pg_policies
  where schemaname='storage' and tablename='objects' and policyname='Anyone can upload study material files';
  if found and (policy_row.permissive <> 'PERMISSIVE'
     or policy_row.cmd not in ('INSERT', 'ALL')
     or not (policy_row.roles @> array['anon'::name] or policy_row.roles @> array['authenticated'::name] or policy_row.roles @> array['public'::name])
     or position('auth.uid()' in coalesce(policy_row.with_check, '')) > 0
     or position('storage.foldername' in coalesce(policy_row.with_check, '')) > 0
     or not (coalesce(policy_row.with_check, '') = 'true'
             or position('study-materials' in coalesce(policy_row.with_check, '')) > 0)) then
    raise exception 'Anyone can upload study material files differs from the audited unrestricted write policy. Review policies; no policy changes were made.';
  end if;

  -- Unrecognized restrictive guards can silently block the intended shared
  -- reads. Stop for review; retain the known profile-photo guard unchanged.
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='courses' and permissive='RESTRICTIVE'
      and policyname not in (
        'courses-owner-guard',
        'study-sync-course-select-guard', 'study-sync-course-insert-guard',
        'study-sync-course-update-guard', 'study-sync-course-delete-guard'
      )
  ) then
    raise exception 'An unrecognized restrictive courses policy exists. Review the audit output; no policy changes were made.';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='study_materials' and permissive='RESTRICTIVE'
      and policyname not in (
        'study_materials-owner-guard',
        'study-sync-material-select-guard', 'study-sync-material-insert-guard',
        'study-sync-material-update-guard', 'study-sync-material-delete-guard'
      )
  ) then
    raise exception 'An unrecognized restrictive study_materials policy exists. Review the audit output; no policy changes were made.';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE'
      and policyname not in (
        'study-materials-owner-folder-guard',
        'study-sync-shared-material-file-select-guard',
        'study-sync-material-file-mutation-guard',
        'study-sync-material-file-insert-guard', 'study-sync-material-file-update-guard',
        'study-sync-material-file-delete-guard',
        'profile-photos-owner-folder-guard'
      )
  ) then
    raise exception 'An unrecognized restrictive storage.objects policy exists. Review the audit output; no policy changes were made.';
  end if;

  -- Remove only named legacy course policies when they are actually broad
  -- anon/PUBLIC policies; retain owner-scoped policies even if similarly named.
  for course_policy in
    select * from (values
      ('Anyone can add shared courses', 'INSERT'),
      ('Anyone can read shared courses', 'SELECT'),
      ('Anyone reads courses', 'SELECT')
    ) as targets(policyname, expected_cmd)
  loop
    select * into policy_row from pg_policies
    where schemaname='public' and tablename='courses'
      and policyname=course_policy.policyname;
    if found and policy_row.cmd=course_policy.expected_cmd
       and (policy_row.roles @> array['anon'::name] or policy_row.roles @> array['public'::name]) then
      policy_expr := case when course_policy.expected_cmd='INSERT'
        then coalesce(policy_row.with_check, '') else coalesce(policy_row.qual, '') end;
      if position('auth.uid()' in policy_expr)=0 and position('owner_id' in policy_expr)=0 then
        execute format('drop policy %I on public.courses', course_policy.policyname);
      end if;
    end if;
  end loop;

  -- Remove only the owner-only restrictive guards from this project's prior
  -- repair migrations; they would otherwise block cross-account shared reads.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study_materials-owner-guard') then
    select * into policy_row from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study_materials-owner-guard';
    if policy_row.permissive <> 'RESTRICTIVE'
       or not (policy_row.roles @> array['public'::name])
       or policy_row.cmd <> 'ALL'
       or policy_row.qual <> '(user_id = auth.uid())'
       or policy_row.with_check <> '(user_id = auth.uid())' then
      raise exception 'study_materials-owner-guard differs from the expected Study Sync owner guard. Review it; no policy changes were made.';
    end if;
    drop policy "study_materials-owner-guard" on public.study_materials;
  end if;

  -- Replace only the known all-command course owner guard. Course reads will
  -- be authenticated college-wide; course writes will remain owner-scoped.
  if exists (select 1 from pg_policies where schemaname='public' and tablename='courses' and policyname='courses-owner-guard') then
    select * into policy_row from pg_policies where schemaname='public' and tablename='courses' and policyname='courses-owner-guard';
    if policy_row.permissive <> 'RESTRICTIVE'
       or not (policy_row.roles @> array['public'::name])
       or policy_row.cmd <> 'ALL'
       or policy_row.qual <> '(owner_id = auth.uid())'
       or policy_row.with_check <> '(owner_id = auth.uid())' then
      raise exception 'courses-owner-guard differs from the expected Study Sync owner guard. Review it; no policy changes were made.';
    end if;
    drop policy "courses-owner-guard" on public.courses;
  end if;

  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='study-materials-owner-folder-guard') then
    select * into policy_row from pg_policies where schemaname='storage' and tablename='objects' and policyname='study-materials-owner-folder-guard';
    if policy_row.cmd <> 'ALL'
       or policy_row.permissive <> 'RESTRICTIVE'
       or not (policy_row.roles @> array['public'::name])
       or position('study-materials' in coalesce(policy_row.qual, '')) = 0
       or position('storage.foldername(name)' in coalesce(policy_row.qual, '')) = 0
       or position('auth.uid()' in coalesce(policy_row.qual, '')) = 0
       or position('study-materials' in coalesce(policy_row.with_check, '')) = 0
       or position('storage.foldername(name)' in coalesce(policy_row.with_check, '')) = 0
       or position('auth.uid()' in coalesce(policy_row.with_check, '')) = 0 then
      raise exception 'study-materials-owner-folder-guard differs from the expected Study Sync owner-folder guard. Review it; no policy changes were made.';
    end if;
    drop policy "study-materials-owner-folder-guard" on storage.objects;
  end if;

  -- Replace the known legacy mutation guard only when it is the expected
  -- folder-owner guard. The new UPDATE/DELETE restrictive guards below use
  -- Storage's owner_id, preserving uploader-only protection while supporting
  -- verified legacy object names. An unfamiliar definition aborts safely.
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='study-sync-material-file-mutation-guard') then
    select * into policy_row from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='study-sync-material-file-mutation-guard';
    if policy_row.cmd <> 'ALL'
       or policy_row.permissive <> 'RESTRICTIVE'
       or not (policy_row.roles @> array['public'::name])
       or position('study-materials' in coalesce(policy_row.qual, '')) = 0
       or position('storage.foldername(name)' in coalesce(policy_row.qual, '')) = 0
       or position('auth.uid()' in coalesce(policy_row.qual, '')) = 0
       or position('study-materials' in coalesce(policy_row.with_check, '')) = 0
       or position('storage.foldername(name)' in coalesce(policy_row.with_check, '')) = 0
       or position('auth.uid()' in coalesce(policy_row.with_check, '')) = 0 then
      raise exception 'study-sync-material-file-mutation-guard is not the expected bucket-scoped owner-folder guard. Review it; no policy changes were made.';
    end if;
    drop policy "study-sync-material-file-mutation-guard" on storage.objects;
  end if;
end;
$$;

-- The app uses authenticated signed URLs. Privatize this bucket in the same
-- transaction as the policy changes, so public object URLs stop resolving
-- when the authenticated policies below take effect. This does not alter
-- profile-photos or delete existing objects.
update storage.buckets
set public = false
where id = 'study-materials' and public is distinct from false;

alter table public.study_materials enable row level security;
alter table public.courses enable row level security;

-- Remove the audited broad permissive policies. PostgreSQL permissive policies
-- are ORed, so leaving these in place would defeat narrower policies below.
drop policy if exists "Anyone can view study materials" on public.study_materials;
drop policy if exists "Anyone can add study materials" on public.study_materials;
drop policy if exists "Anyone can read study material files" on storage.objects;
drop policy if exists "Anyone can upload study material files" on storage.objects;

-- Academic course fields are college-wide. RLS still requires authentication
-- for reads, and all course mutations remain limited to owner_id.
drop policy if exists "study-sync-shared-course-select" on public.courses;
create policy "study-sync-shared-course-select"
  on public.courses for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "study-sync-course-select-guard" on public.courses;
create policy "study-sync-course-select-guard"
  on public.courses as restrictive for select to public
  using (auth.uid() is not null);

drop policy if exists "study-sync-course-insert" on public.courses;
create policy "study-sync-course-insert"
  on public.courses for insert to authenticated
  with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "study-sync-course-insert-guard" on public.courses;
create policy "study-sync-course-insert-guard"
  on public.courses as restrictive for insert to public
  with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "study-sync-course-update" on public.courses;
create policy "study-sync-course-update"
  on public.courses for update to authenticated
  using (auth.uid() is not null and owner_id = auth.uid())
  with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "study-sync-course-update-guard" on public.courses;
create policy "study-sync-course-update-guard"
  on public.courses as restrictive for update to public
  using (auth.uid() is not null and owner_id = auth.uid())
  with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "study-sync-course-delete" on public.courses;
create policy "study-sync-course-delete"
  on public.courses for delete to authenticated
  using (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "study-sync-course-delete-guard" on public.courses;
create policy "study-sync-course-delete-guard"
  on public.courses as restrictive for delete to public
  using (auth.uid() is not null and owner_id = auth.uid());

-- Retain uploader access and grant authenticated students access to shared
-- metadata only. The restrictive guard also clamps any other permissive policy.
drop policy if exists "study-sync-shared-material-select" on public.study_materials;
create policy "study-sync-shared-material-select"
  on public.study_materials for select to authenticated
  using (user_id = auth.uid() or is_shared is true);

drop policy if exists "study-sync-material-select-guard" on public.study_materials;
create policy "study-sync-material-select-guard"
  on public.study_materials as restrictive for select to public
  using (auth.uid() is not null and (user_id = auth.uid() or is_shared is true));

-- Authenticated inserts and metadata updates are uploader-only. A null course
-- is allowed; a non-null course must be visible under courses RLS to the user.
drop policy if exists "study-sync-material-insert" on public.study_materials;
create policy "study-sync-material-insert"
  on public.study_materials for insert to authenticated
  with check (auth.uid() is not null and user_id = auth.uid() and (
    course_id is null or exists (select 1 from public.courses c where c.id = course_id)
  ));

drop policy if exists "study-sync-material-insert-guard" on public.study_materials;
create policy "study-sync-material-insert-guard"
  on public.study_materials as restrictive for insert to public
  with check (auth.uid() is not null and user_id = auth.uid() and (
    course_id is null or exists (select 1 from public.courses c where c.id = course_id)
  ));

drop policy if exists "study-sync-material-update" on public.study_materials;
create policy "study-sync-material-update"
  on public.study_materials for update to authenticated
  using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid() and (
    course_id is null or exists (select 1 from public.courses c where c.id = course_id)
  ));

drop policy if exists "study-sync-material-update-guard" on public.study_materials;
create policy "study-sync-material-update-guard"
  on public.study_materials as restrictive for update to public
  using (auth.uid() is not null and user_id = auth.uid())
  with check (auth.uid() is not null and user_id = auth.uid() and (
    course_id is null or exists (select 1 from public.courses c where c.id = course_id)
  ));

-- Preserve the existing "Users can delete own materials" policy; these
-- restrictive rules ensure no other permissive policy can broaden deletion.
drop policy if exists "study-sync-material-delete" on public.study_materials;
create policy "study-sync-material-delete"
  on public.study_materials for delete to authenticated
  using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "study-sync-material-delete-guard" on public.study_materials;
create policy "study-sync-material-delete-guard"
  on public.study_materials as restrictive for delete to public
  using (auth.uid() is not null and user_id = auth.uid());

-- Reads require authenticated ownership of the actual Storage object and its
-- matching metadata row. Owners can read private materials; every student can
-- read shared materials. The owner_id check supports verified legacy paths.
drop policy if exists "study-sync-shared-material-file-select" on storage.objects;
create policy "study-sync-shared-material-file-select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'study-materials'
    and exists (
      select 1 from public.study_materials m
      where m.storage_path = storage.objects.name
        and m.user_id::text = storage.objects.owner_id::text
        and (m.user_id = auth.uid() or m.is_shared is true)
    )
  );

drop policy if exists "study-sync-shared-material-file-select-guard" on storage.objects;
create policy "study-sync-shared-material-file-select-guard"
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'study-materials'
    or (auth.uid() is not null and (
      exists (
        select 1 from public.study_materials m
        where m.storage_path = storage.objects.name
          and m.user_id::text = storage.objects.owner_id::text
          and (m.user_id = auth.uid() or m.is_shared is true)
      )
    ))
  );

-- New object creation still requires <auth.uid()>/... . Later updates and
-- deletes rely on Storage's recorded owner_id so legacy paths remain manageable.
drop policy if exists "study-sync-material-file-insert" on storage.objects;
create policy "study-sync-material-file-insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'study-materials' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "study-sync-material-file-insert-guard" on storage.objects;
create policy "study-sync-material-file-insert-guard"
  on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'study-materials' or (auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists "study-sync-material-file-update" on storage.objects;
create policy "study-sync-material-file-update"
  on storage.objects for update to authenticated
  using (bucket_id = 'study-materials' and auth.uid() is not null and owner_id::text = auth.uid()::text)
  with check (bucket_id = 'study-materials' and auth.uid() is not null and owner_id::text = auth.uid()::text);

drop policy if exists "study-sync-material-file-update-guard" on storage.objects;
create policy "study-sync-material-file-update-guard"
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'study-materials' or (auth.uid() is not null and owner_id::text = auth.uid()::text))
  with check (bucket_id <> 'study-materials' or (auth.uid() is not null and owner_id::text = auth.uid()::text));

drop policy if exists "study-sync-material-file-delete" on storage.objects;
create policy "study-sync-material-file-delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'study-materials' and auth.uid() is not null and owner_id::text = auth.uid()::text);

drop policy if exists "study-sync-material-file-delete-guard" on storage.objects;
create policy "study-sync-material-file-delete-guard"
  on storage.objects as restrictive for delete to public
  using (bucket_id <> 'study-materials' or (auth.uid() is not null and owner_id::text = auth.uid()::text));

-- Postflight: verify each command has a PUBLIC restrictive guard. PostgreSQL
-- ORs permissive policies, but ANDs these guards with all of them, including
-- any additional anon/authenticated policies found by the audit query.
do $$
declare
  required_guard record;
begin
  if not exists (
    select 1 from storage.buckets
    where id='study-materials' and public is false and file_size_limit=52428800
  ) then
    raise exception 'study-materials is not private at the expected 50 MiB limit; transaction will roll back.';
  end if;

  for required_guard in
    select * from (values
      ('public',  'courses',          'study-sync-course-select-guard', 'SELECT'),
      ('public',  'courses',          'study-sync-course-insert-guard', 'INSERT'),
      ('public',  'courses',          'study-sync-course-update-guard', 'UPDATE'),
      ('public',  'courses',          'study-sync-course-delete-guard', 'DELETE'),
      ('public',  'study_materials', 'study-sync-material-select-guard', 'SELECT'),
      ('public',  'study_materials', 'study-sync-material-insert-guard', 'INSERT'),
      ('public',  'study_materials', 'study-sync-material-update-guard', 'UPDATE'),
      ('public',  'study_materials', 'study-sync-material-delete-guard', 'DELETE'),
      ('storage', 'objects',         'study-sync-shared-material-file-select-guard', 'SELECT'),
      ('storage', 'objects',         'study-sync-material-file-insert-guard', 'INSERT'),
      ('storage', 'objects',         'study-sync-material-file-update-guard', 'UPDATE'),
      ('storage', 'objects',         'study-sync-material-file-delete-guard', 'DELETE')
    ) as guards(schemaname, tablename, policyname, cmd)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = required_guard.schemaname
        and p.tablename = required_guard.tablename
        and p.policyname = required_guard.policyname
        and p.cmd = required_guard.cmd
        and p.permissive = 'RESTRICTIVE'
        and p.roles @> array['public'::name]
    ) then
      raise exception 'Required restrictive guard %.% (% / %) is missing; transaction will roll back.',
        required_guard.schemaname, required_guard.tablename, required_guard.policyname, required_guard.cmd;
    end if;
  end loop;

  if exists (
    select 1 from pg_policies
    where (schemaname='public' and tablename='study_materials'
           and policyname in ('Anyone can view study materials', 'Anyone can add study materials'))
       or (schemaname='storage' and tablename='objects'
           and policyname in ('Anyone can read study material files', 'Anyone can upload study material files'))
  ) then
    raise exception 'An audited broad policy remains; transaction will roll back.';
  end if;
end;
$$;

-- anon retains no SQL privilege for this table; authenticated users receive
-- only the commands whose RLS policies above constrain them.
revoke all on public.study_materials from anon;
grant select, insert, update, delete on public.study_materials to authenticated;
revoke select on table public.courses from public, anon, authenticated;
revoke select (progress, materials) on table public.courses from public, anon, authenticated;
grant select (id, owner_id, name, title, code, course_code, semester, description, color, created_at)
  on table public.courses to authenticated;
grant insert, update, delete on table public.courses to authenticated;
do $$
begin
  if has_column_privilege('authenticated', 'public.courses', 'progress', 'SELECT')
     or has_column_privilege('authenticated', 'public.courses', 'materials', 'SELECT')
     or has_column_privilege('anon', 'public.courses', 'progress', 'SELECT')
     or has_column_privilege('anon', 'public.courses', 'materials', 'SELECT') then
    raise exception 'Course progress/material counter columns are still readable by client roles; transaction will roll back.';
  end if;
  if not has_column_privilege('authenticated', 'public.courses', 'id', 'SELECT')
     or not has_column_privilege('authenticated', 'public.courses', 'semester', 'SELECT') then
    raise exception 'Authenticated course browse grants are incomplete; transaction will roll back.';
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
