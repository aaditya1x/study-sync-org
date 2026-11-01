-- Make the private PYQ library available only to students in the paper's
-- academic allocation. Super Admins retain full paper and object management.
-- Apply after 20261102_super_admin_rbac.sql and the academic profile/catalog
-- migrations (20261031, 20261101), if these objects are not already present.
-- This migration is additive/idempotent and does not alter unrelated data.
begin;

-- Fail before creating/changing anything if required academic schema or
-- authorization/audit helpers are missing. This does not attempt to repair or
-- create prerequisites because their deployment order must be reviewed first.
do $$
declare
  missing_columns text[];
begin
  select array_agg(required.table_name || '.' || required.column_name order by required.table_name, required.column_name)
    into missing_columns
  from (values
    ('courses', 'branch_id'),
    ('courses', 'academic_cycle_id'),
    ('courses', 'semester'),
    ('academic_profiles', 'branch_id'),
    ('academic_profiles', 'academic_cycle_id'),
    ('academic_profiles', 'semester')
  ) as required(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = required.table_name
      and column_info.column_name = required.column_name
  );

  if missing_columns is not null then
    raise exception 'PYQ migration prerequisites missing columns: %', array_to_string(missing_columns, ', ');
  end if;
  if to_regclass('public.academic_units') is null then
    raise exception 'PYQ migration prerequisite missing: public.academic_units';
  end if;
  if not exists (
    select 1 from pg_proc function_info
    join pg_namespace schema_info on schema_info.oid = function_info.pronamespace
    where schema_info.nspname = 'public'
      and function_info.proname = 'log_academic_admin_change'
      and function_info.pronargs = 0
      and function_info.prorettype = 'trigger'::regtype
  ) then
    raise exception 'PYQ migration prerequisite missing: public.log_academic_admin_change() trigger function';
  end if;
  if to_regprocedure('public.is_current_user_active()') is null
     or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'PYQ migration prerequisites missing: public.is_current_user_active() and/or public.is_super_admin()';
  end if;
end;
$$;

-- The earlier learning feature migration may not have been applied yet.
create table if not exists public.previous_year_papers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  course_id uuid references public.courses(id) on delete restrict,
  semester smallint not null check (semester between 1 and 24),
  exam_year smallint not null check (exam_year between 1950 and 2200),
  unit_id uuid references public.academic_units(id) on delete set null,
  storage_path text not null unique check (storage_path !~ '(^/|\.\.|\\)'),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  content_type text not null check (content_type = 'application/pdf'),
  file_size bigint not null check (file_size between 1 and 26214400),
  verified boolean not null default false,
  is_published boolean not null default false,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (not is_published or (verified and published_at is not null))
);

-- CREATE TABLE IF NOT EXISTS does not validate an existing relation. Verify
-- the feature's column contract and key relationships before adding policies.
do $$
declare
  incompatible_columns text[];
  missing_checks text[];
begin
  select array_agg(expected.column_name order by expected.column_name)
    into incompatible_columns
  from (values
    ('id', 'uuid', 'NO'),
    ('title', 'text', 'NO'),
    ('course_id', 'uuid', 'YES'),
    ('semester', 'int2', 'NO'),
    ('exam_year', 'int2', 'NO'),
    ('unit_id', 'uuid', 'YES'),
    ('storage_path', 'text', 'NO'),
    ('original_filename', 'text', 'NO'),
    ('content_type', 'text', 'NO'),
    ('file_size', 'int8', 'NO'),
    ('verified', 'bool', 'NO'),
    ('is_published', 'bool', 'NO'),
    ('uploaded_by', 'uuid', 'NO'),
    ('published_by', 'uuid', 'YES'),
    ('published_at', 'timestamptz', 'YES'),
    ('created_at', 'timestamptz', 'NO')
  ) as expected(column_name, udt_name, is_nullable)
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = 'previous_year_papers'
   and actual.column_name = expected.column_name
   and actual.udt_name = expected.udt_name
   and actual.is_nullable = expected.is_nullable
  where actual.column_name is null;

  if incompatible_columns is not null then
    raise exception 'Existing public.previous_year_papers has missing or incompatible columns: %',
      array_to_string(incompatible_columns, ', ');
  end if;
  select array_agg(required.constraint_name order by required.constraint_name)
    into missing_checks
  from (values
    ('previous_year_papers_title_check'),
    ('previous_year_papers_semester_check'),
    ('previous_year_papers_exam_year_check'),
    ('previous_year_papers_storage_path_check'),
    ('previous_year_papers_original_filename_check'),
    ('previous_year_papers_content_type_check'),
    ('previous_year_papers_file_size_check'),
    ('previous_year_papers_check')
  ) as required(constraint_name)
  where not exists (
    select 1 from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.previous_year_papers'::regclass
      and constraint_info.contype = 'c'
      and constraint_info.conname = required.constraint_name
  );
  if missing_checks is not null then
    raise exception 'Existing public.previous_year_papers is missing expected integrity checks: %',
      array_to_string(missing_checks, ', ');
  end if;
  if not exists (
    select 1 from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.previous_year_papers'::regclass
      and constraint_info.contype = 'p'
      and pg_get_constraintdef(constraint_info.oid) = 'PRIMARY KEY (id)'
  ) then
    raise exception 'Existing public.previous_year_papers must have PRIMARY KEY (id).';
  end if;
  if not exists (
    select 1 from pg_index index_info
    join pg_attribute column_info
      on column_info.attrelid = index_info.indrelid
     and column_info.attnum = any(index_info.indkey)
    where index_info.indrelid = 'public.previous_year_papers'::regclass
      and index_info.indisunique and index_info.indisvalid
      and index_info.indnatts = 1 and column_info.attname = 'storage_path'
  ) then
    raise exception 'Existing public.previous_year_papers must uniquely index storage_path.';
  end if;
  if not exists (
    select 1 from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.previous_year_papers'::regclass
      and constraint_info.contype = 'f'
      and constraint_info.conkey = array[(select attnum from pg_attribute where attrelid = 'public.previous_year_papers'::regclass and attname = 'course_id')]::smallint[]
      and constraint_info.confrelid = 'public.courses'::regclass
  ) or not exists (
    select 1 from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.previous_year_papers'::regclass
      and constraint_info.contype = 'f'
      and constraint_info.conkey = array[(select attnum from pg_attribute where attrelid = 'public.previous_year_papers'::regclass and attname = 'unit_id')]::smallint[]
      and constraint_info.confrelid = 'public.academic_units'::regclass
  ) then
    raise exception 'Existing public.previous_year_papers is missing its course_id or unit_id foreign key.';
  end if;
  if not exists (
    select 1 from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.previous_year_papers'::regclass
      and constraint_info.contype = 'f'
      and constraint_info.conkey = array[(select attnum from pg_attribute where attrelid = 'public.previous_year_papers'::regclass and attname = 'uploaded_by')]::smallint[]
      and constraint_info.confrelid = 'auth.users'::regclass
  ) or not exists (
    select 1 from pg_constraint constraint_info
    where constraint_info.conrelid = 'public.previous_year_papers'::regclass
      and constraint_info.contype = 'f'
      and constraint_info.conkey = array[(select attnum from pg_attribute where attrelid = 'public.previous_year_papers'::regclass and attname = 'published_by')]::smallint[]
      and constraint_info.confrelid = 'auth.users'::regclass
  ) then
    raise exception 'Existing public.previous_year_papers is missing its uploaded_by or published_by auth.users foreign key.';
  end if;
end;
$$;

create index if not exists previous_year_papers_public_idx
  on public.previous_year_papers(semester, exam_year desc, course_id)
  where is_published and verified;
create index if not exists previous_year_papers_course_unit_idx
  on public.previous_year_papers(course_id, unit_id) where course_id is not null;

alter table public.previous_year_papers enable row level security;
revoke all on public.previous_year_papers from public, anon;
grant select, insert, update, delete on public.previous_year_papers to authenticated;
grant all on public.previous_year_papers to service_role;

-- Replace the broad published-paper policy from the earlier PYQ draft.
drop policy if exists "published verified papers read" on public.previous_year_papers;
create policy "published verified papers read" on public.previous_year_papers
  for select to authenticated using (
    public.is_current_user_active()
    and (
      public.is_super_admin()
      or (
        is_published and verified and course_id is not null
        and not exists (
          select 1 from public.academic_staff staff where staff.user_id = auth.uid()
        )
        and exists (
          select 1
          from public.academic_profiles profile
          join public.courses course on course.id = previous_year_papers.course_id
          where profile.user_id = auth.uid()
            and profile.branch_id is not null
            and course.branch_id = profile.branch_id
            and (course.academic_cycle_id is null
              or course.academic_cycle_id = profile.academic_cycle_id)
            and profile.semester = previous_year_papers.semester
            and course.semester = previous_year_papers.semester
        )
      )
    )
  );

-- Only a currently authorized Super Admin may create, change verification or
-- publication state, or delete official paper metadata. Students receive no
-- permissive write policy; this restrictive guard also blocks pre-existing
-- permissive policies from granting writes or broad reads.
drop policy if exists "super admins manage papers" on public.previous_year_papers;
create policy "super admins manage papers" on public.previous_year_papers
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
drop policy if exists "paper active account guard" on public.previous_year_papers;
create policy "paper active account guard" on public.previous_year_papers as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "paper allocation read guard" on public.previous_year_papers;
create policy "paper allocation read guard" on public.previous_year_papers as restrictive
  for select to authenticated using (
    public.is_super_admin()
    or (
      is_published and verified and course_id is not null
      and not exists (
        select 1 from public.academic_staff staff where staff.user_id = auth.uid()
      )
      and exists (
        select 1
        from public.academic_profiles profile
        join public.courses course on course.id = previous_year_papers.course_id
        where profile.user_id = auth.uid()
          and profile.branch_id is not null
          and course.branch_id = profile.branch_id
          and (course.academic_cycle_id is null
            or course.academic_cycle_id = profile.academic_cycle_id)
          and profile.semester = previous_year_papers.semester
          and course.semester = previous_year_papers.semester
      )
    )
  );
drop policy if exists "paper insert admin guard" on public.previous_year_papers;
create policy "paper insert admin guard" on public.previous_year_papers as restrictive
  for insert to authenticated with check (public.is_super_admin());
drop policy if exists "paper update admin guard" on public.previous_year_papers;
create policy "paper update admin guard" on public.previous_year_papers as restrictive
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "paper delete admin guard" on public.previous_year_papers;
create policy "paper delete admin guard" on public.previous_year_papers as restrictive
  for delete to authenticated using (public.is_super_admin());
drop trigger if exists audit_previous_year_papers on public.previous_year_papers;
create trigger audit_previous_year_papers after insert or update or delete on public.previous_year_papers
  for each row execute function public.log_academic_admin_change();

-- Keep the bucket private. Refuse an existing incompatible bucket instead of
-- changing its production settings.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('previous-year-papers', 'previous-year-papers', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'previous-year-papers' and public is false
      and file_size_limit = 26214400
      and allowed_mime_types = array['application/pdf']::text[]
  ) then
    raise exception 'The previous-year-papers bucket must be private, PDF-only, and limited to exactly 25 MiB. Existing settings were not changed.';
  end if;
end;
$$;

drop policy if exists "published pyq objects read" on storage.objects;
create policy "published pyq objects read" on storage.objects for select to authenticated
  using (
    bucket_id = 'previous-year-papers'
    and public.is_current_user_active()
    and (
      public.is_super_admin()
      or exists (
        select 1
        from public.previous_year_papers paper
        join public.academic_profiles profile on profile.user_id = auth.uid()
        join public.courses course on course.id = paper.course_id
        where paper.storage_path = storage.objects.name
          and paper.is_published and paper.verified
          and not exists (
            select 1 from public.academic_staff staff where staff.user_id = auth.uid()
          )
          and profile.branch_id is not null
          and course.branch_id = profile.branch_id
          and (course.academic_cycle_id is null
            or course.academic_cycle_id = profile.academic_cycle_id)
          and profile.semester = paper.semester
          and course.semester = paper.semester
      )
    )
  );
drop policy if exists "super admins upload pyq objects" on storage.objects;
create policy "super admins upload pyq objects" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'previous-year-papers'
    and owner_id = auth.uid()::text
    and public.is_super_admin()
  );
drop policy if exists "super admins delete pyq objects" on storage.objects;
create policy "super admins delete pyq objects" on storage.objects for delete to authenticated
  using (bucket_id = 'previous-year-papers' and public.is_super_admin());

-- Restrictive bucket-specific checks prevent differently named permissive
-- storage policies from widening access to PYQ objects.
drop policy if exists "pyq object active account guard" on storage.objects;
create policy "pyq object active account guard" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'previous-year-papers' or public.is_current_user_active())
  with check (bucket_id <> 'previous-year-papers' or public.is_current_user_active());
drop policy if exists "pyq object select access guard" on storage.objects;
create policy "pyq object select access guard" on storage.objects as restrictive for select to authenticated
  using (
    bucket_id <> 'previous-year-papers'
    or (
      public.is_current_user_active()
      and (
        public.is_super_admin()
        or exists (
          select 1
          from public.previous_year_papers paper
          join public.academic_profiles profile on profile.user_id = auth.uid()
          join public.courses course on course.id = paper.course_id
          where paper.storage_path = storage.objects.name
            and paper.is_published and paper.verified
            and not exists (
              select 1 from public.academic_staff staff where staff.user_id = auth.uid()
            )
            and profile.branch_id is not null
            and course.branch_id = profile.branch_id
            and (course.academic_cycle_id is null
              or course.academic_cycle_id = profile.academic_cycle_id)
            and profile.semester = paper.semester
            and course.semester = paper.semester
        )
      )
    )
  );
drop policy if exists "pyq object insert access guard" on storage.objects;
create policy "pyq object insert access guard" on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'previous-year-papers'
    or (public.is_super_admin() and owner_id = auth.uid()::text)
  );
drop policy if exists "pyq object update access guard" on storage.objects;
create policy "pyq object update access guard" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'previous-year-papers' or public.is_super_admin())
  with check (bucket_id <> 'previous-year-papers' or public.is_super_admin());
drop policy if exists "pyq object delete access guard" on storage.objects;
create policy "pyq object delete access guard" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'previous-year-papers' or public.is_super_admin());

notify pgrst, 'reload schema';
commit;
