-- Manual migration for Study Sync.
-- Adds nullable course associations and explicit authenticated sharing of
-- indexed PDF text. Existing materials are unassigned and unshared by default.
-- Run supabase-read-only-audit.sql first. This migration never modifies Storage.

begin;

-- Validate the live schema and RLS before making changes. The application
-- currently reads courses.id, so this file requires that exact column to be
-- the single-column UUID primary key.
do $$
declare
  courses_id_type text;
  courses_owner_type text;
  materials_user_type text;
  materials_course_type text;
  materials_shared_type text;
  courses_rls boolean;
  materials_rls boolean;
  chunks_rls boolean;
begin
  if to_regclass('public.courses') is null
     or to_regclass('public.study_materials') is null
     or to_regclass('public.book_chunks') is null then
    raise exception 'Expected public.courses, public.study_materials, and public.book_chunks. Review the audit output; no schema changes were made.';
  end if;

  select data_type into courses_id_type from information_schema.columns
  where table_schema = 'public' and table_name = 'courses' and column_name = 'id';
  select data_type into courses_owner_type from information_schema.columns
  where table_schema = 'public' and table_name = 'courses' and column_name = 'owner_id';
  select data_type into materials_user_type from information_schema.columns
  where table_schema = 'public' and table_name = 'study_materials' and column_name = 'user_id';
  select data_type into materials_course_type from information_schema.columns
  where table_schema = 'public' and table_name = 'study_materials' and column_name = 'course_id';
  select data_type into materials_shared_type from information_schema.columns
  where table_schema = 'public' and table_name = 'study_materials' and column_name = 'is_shared';

  if courses_id_type is distinct from 'uuid'
     or courses_owner_type is distinct from 'uuid'
     or materials_user_type is distinct from 'uuid' then
    raise exception 'Expected courses.id, courses.owner_id, and study_materials.user_id to be uuid columns. Review the audit output; no schema changes were made.';
  end if;
  if materials_course_type is not null and materials_course_type <> 'uuid' then
    raise exception 'study_materials.course_id exists but is not uuid. Review it manually; no schema changes were made.';
  end if;
  if materials_shared_type is not null and materials_shared_type <> 'boolean' then
    raise exception 'study_materials.is_shared exists but is not boolean. Review it manually; no schema changes were made.';
  end if;

  if not exists (
    select 1
    from pg_constraint pk
    join pg_attribute id_column
      on id_column.attrelid = pk.conrelid
     and id_column.attnum = pk.conkey[1]
    where pk.contype = 'p'
      and pk.conrelid = 'public.courses'::regclass
      and cardinality(pk.conkey) = 1
      and id_column.attname = 'id'
  ) then
    raise exception 'courses.id is not the single-column primary key. Adapt the app and migration to the audited primary key; no schema changes were made.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_materials'
      and column_name = 'storage_path'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'study_materials'
      and column_name = 'created_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_chunks'
      and column_name = 'user_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'book_chunks'
      and column_name = 'storage_path'
  ) then
    raise exception 'Expected study_materials.storage_path/created_at and book_chunks.user_id/storage_path. Review the audit output; no schema changes were made.';
  end if;

  select relrowsecurity into courses_rls from pg_class where oid = 'public.courses'::regclass;
  select relrowsecurity into materials_rls from pg_class where oid = 'public.study_materials'::regclass;
  select relrowsecurity into chunks_rls from pg_class where oid = 'public.book_chunks'::regclass;
  if courses_rls is distinct from true
     or materials_rls is distinct from true
     or chunks_rls is distinct from true then
    raise exception 'RLS must be enabled on courses, study_materials, and book_chunks. Review the audit output and owner policies first; no schema changes were made.';
  end if;
end;
$$;

-- Old material rows retain NULL course_id. Existing rows default to private;
-- only the owner may explicitly opt an item into authenticated text sharing.
alter table public.study_materials
  add column if not exists course_id uuid;
alter table public.study_materials
  add column if not exists is_shared boolean not null default false;

-- Add an owner-scoped course SELECT policy so the ownership subqueries and
-- course picker work even when existing course SELECT policies are broad.
-- This does not remove or widen any existing course policy.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'courses'
      and policyname = 'study-sync-course-owner-select'
  ) then
    create policy "study-sync-course-owner-select"
      on public.courses as permissive for select to authenticated
      using (owner_id = auth.uid());
  end if;
end;
$$;

-- Refuse pre-existing dangling or cross-owner associations; do not repair them
-- by rewriting user data.
do $$
begin
  if exists (
    select 1
    from public.study_materials material
    left join public.courses course on course.id = material.course_id
    where material.course_id is not null
      and (course.id is null or course.owner_id is distinct from material.user_id)
  ) then
    raise exception 'Existing course_id values include a missing or differently owned course. Review those rows manually; this transaction makes no data changes.';
  end if;
end;
$$;

-- Validate a pre-existing FK instead of stacking an unknown relationship.
do $$
declare
  source_attnum smallint;
  target_attnum smallint;
  has_course_fk boolean;
begin
  select attnum into source_attnum from pg_attribute
  where attrelid = 'public.study_materials'::regclass
    and attname = 'course_id' and not attisdropped;
  select attnum into target_attnum from pg_attribute
  where attrelid = 'public.courses'::regclass
    and attname = 'id' and not attisdropped;

  select exists (
    select 1 from pg_constraint fk
    where fk.contype = 'f'
      and fk.conrelid = 'public.study_materials'::regclass
      and source_attnum = any(fk.conkey)
  ) into has_course_fk;

  if has_course_fk and not exists (
    select 1 from pg_constraint fk
    where fk.contype = 'f'
      and fk.conrelid = 'public.study_materials'::regclass
      and fk.confrelid = 'public.courses'::regclass
      and fk.conkey = array[source_attnum]::smallint[]
      and fk.confkey = array[target_attnum]::smallint[]
      and fk.confdeltype = 'n'
  ) then
    raise exception 'study_materials.course_id already participates in an incompatible FK. Review it manually; no schema changes were made.';
  end if;

  if not has_course_fk then
    alter table public.study_materials
      add constraint study_materials_course_id_fkey
      foreign key (course_id) references public.courses(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists study_materials_user_course_created_idx
  on public.study_materials (user_id, course_id, created_at desc);
create index if not exists book_chunks_shared_lookup_idx
  on public.book_chunks (storage_path, user_id);

-- Replace only the restrictive owner-only guard created by the existing
-- Study Sync repair migration. Abort if a same-named policy has another shape.
do $$
declare
  policy_row record;
begin
  select permissive, cmd, qual, with_check into policy_row
  from pg_policies where schemaname = 'public' and tablename = 'study_materials'
    and policyname = 'study_materials-owner-guard';
  if found then
    if policy_row.permissive <> 'RESTRICTIVE' or policy_row.cmd <> 'ALL'
       or lower(coalesce(policy_row.qual, '')) not like '%user_id%'
       or lower(coalesce(policy_row.qual, '')) not like '%auth.uid%'
       or lower(coalesce(policy_row.with_check, '')) not like '%user_id%'
       or lower(coalesce(policy_row.with_check, '')) not like '%auth.uid%' then
      raise exception 'The named study_materials owner guard differs from the expected Study Sync policy. Review it manually; no policies were changed.';
    end if;
    drop policy "study_materials-owner-guard" on public.study_materials;
  end if;

  select permissive, cmd, qual, with_check into policy_row
  from pg_policies where schemaname = 'public' and tablename = 'book_chunks'
    and policyname = 'book_chunks-owner-guard';
  if found then
    if policy_row.permissive <> 'RESTRICTIVE' or policy_row.cmd <> 'ALL'
       or lower(coalesce(policy_row.qual, '')) not like '%user_id%'
       or lower(coalesce(policy_row.qual, '')) not like '%auth.uid%'
       or lower(coalesce(policy_row.with_check, '')) not like '%user_id%'
       or lower(coalesce(policy_row.with_check, '')) not like '%auth.uid%' then
      raise exception 'The named book_chunks owner guard differs from the expected Study Sync policy. Review it manually; no policies were changed.';
    end if;
    drop policy "book_chunks-owner-guard" on public.book_chunks;
  end if;
end;
$$;

-- Material reads: owner or authenticated students when the owner has opted in.
-- Writes stay owner-only, including assignment to an owner-owned course.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-select') then
    create policy "study-sync-material-select" on public.study_materials as permissive for select to authenticated
      using (user_id = auth.uid() or is_shared is true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-select-guard') then
    create policy "study-sync-material-select-guard" on public.study_materials as restrictive for select to public
      using (auth.uid() is not null and (user_id = auth.uid() or is_shared is true));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-insert') then
    create policy "study-sync-material-insert" on public.study_materials as permissive for insert to authenticated
      with check (user_id = auth.uid() and (
  course_id is null
  OR EXISTS (
        select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid()
      )));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-insert-guard') then
    create policy "study-sync-material-insert-guard" on public.study_materials as restrictive for insert to public
      with check (auth.uid() is not null and user_id = auth.uid() and (
  course_id is null
  OR EXISTS (
        select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid()
      )));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-update') then
    create policy "study-sync-material-update" on public.study_materials as permissive for update to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid() and (course_id is null or exists (
        select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid()
      )));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-update-guard') then
    create policy "study-sync-material-update-guard" on public.study_materials as restrictive for update to public
      using (auth.uid() is not null and user_id = auth.uid())
      with check (auth.uid() is not null and user_id = auth.uid() and (course_id is null or exists (
        select 1 from public.courses c where c.id = course_id and c.owner_id = auth.uid()
      )));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-delete') then
    create policy "study-sync-material-delete" on public.study_materials as permissive for delete to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='study_materials' and policyname='study-sync-material-delete-guard') then
    create policy "study-sync-material-delete-guard" on public.study_materials as restrictive for delete to public
      using (auth.uid() is not null and user_id = auth.uid());
  end if;
end;
$$;

-- Indexed text reads follow the parent material's explicit share flag. Chunk
-- writes/deletes remain uploader-only; the server indexing route uses its
-- server-side service key and independently verifies the authenticated owner.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='book_chunks' and policyname='study-sync-chunks-select') then
    create policy "study-sync-chunks-select" on public.book_chunks as permissive for select to authenticated
      using (
        user_id = auth.uid()
        or exists (select 1 from public.study_materials m
          where m.storage_path = book_chunks.storage_path
            and m.user_id = book_chunks.user_id and m.is_shared is true)
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='book_chunks' and policyname='study-sync-chunks-select-guard') then
    create policy "study-sync-chunks-select-guard" on public.book_chunks as restrictive for select to public
      using (
        auth.uid() is not null and (user_id = auth.uid()
        or exists (select 1 from public.study_materials m
          where m.storage_path = book_chunks.storage_path
            and m.user_id = book_chunks.user_id and m.is_shared is true))
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='book_chunks' and policyname='study-sync-chunks-write') then
    create policy "study-sync-chunks-write" on public.book_chunks as permissive for all to authenticated
      using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='book_chunks' and policyname='study-sync-chunks-write-guard') then
    create policy "study-sync-chunks-write-guard" on public.book_chunks as restrictive for insert to public
      with check (auth.uid() is not null and user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='book_chunks' and policyname='study-sync-chunks-update-guard') then
    create policy "study-sync-chunks-update-guard" on public.book_chunks as restrictive for update to public
      using (auth.uid() is not null and user_id = auth.uid())
      with check (auth.uid() is not null and user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='book_chunks' and policyname='study-sync-chunks-delete-guard') then
    create policy "study-sync-chunks-delete-guard" on public.book_chunks as restrictive for delete to public
      using (auth.uid() is not null and user_id = auth.uid());
  end if;
end;
$$;

-- RLS filters remain mandatory; these grants expose no service-role key.
grant select, insert, update, delete on public.study_materials to authenticated;
grant select on public.book_chunks to authenticated;

notify pgrst, 'reload schema';
commit;
