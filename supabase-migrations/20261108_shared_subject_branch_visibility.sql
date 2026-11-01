-- Shared academic subjects are attached to one or more branches independently
-- of semester. This is additive: existing course, curriculum, material, and
-- PYQ rows and identifiers are retained.
-- Prerequisites: 20261031_academic_hub, 20261101_academic_admin_hardening,
-- 20261102_super_admin_rbac, 20261103_academic_profile_scoping,
-- 20261029_study_materials_student_sharing, 20261106_learning_assessment_and_papers,
-- and 20261107_previous_year_papers_allocation_scope. Confirm their live state
-- and inspect production schema/policies before manual execution.
begin;

do $$
declare
  missing_columns text[];
  incompatible_columns text[];
begin
  select array_agg(required.table_name || '.' || required.column_name order by required.table_name, required.column_name)
    into missing_columns
  from (values
    ('courses','id'), ('courses','owner_id'), ('courses','name'), ('courses','title'),
    ('courses','semester'), ('courses','branch_id'), ('courses','academic_cycle_id'), ('courses','archived_at'),
    ('academic_profiles','user_id'), ('academic_profiles','branch_id'), ('academic_profiles','academic_cycle_id'), ('academic_profiles','semester'),
    ('academic_staff','user_id'), ('academic_staff','role'),
    ('academic_staff_branches','user_id'), ('academic_staff_branches','branch_id'),
    ('academic_branches','id'), ('academic_branches','name'), ('academic_branches','archived_at'),
    ('academic_units','id'), ('academic_units','course_id'), ('academic_units','archived_at'),
    ('academic_chapters','id'), ('academic_chapters','unit_id'), ('academic_chapters','archived_at'),
    ('academic_topics','id'), ('academic_topics','chapter_id'), ('academic_topics','archived_at'),
    ('study_materials','user_id'), ('study_materials','storage_path'),
    ('study_materials','course_id'), ('study_materials','is_shared'), ('study_materials','archived_at'),
    ('previous_year_papers','course_id'), ('previous_year_papers','semester'),
    ('previous_year_papers','is_published'), ('previous_year_papers','verified'),
    ('previous_year_papers','storage_path')
  ) required(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name
  );
  if missing_columns is not null then
    raise exception 'Shared subject migration prerequisites missing columns: %', array_to_string(missing_columns, ', ');
  end if;
  select array_agg(required.table_name || '.' || required.column_name order by required.table_name, required.column_name)
    into incompatible_columns
  from (values
    ('courses','id','uuid'), ('courses','owner_id','uuid'), ('courses','branch_id','uuid'),
    ('courses','academic_cycle_id','uuid'), ('academic_profiles','user_id','uuid'),
    ('academic_profiles','branch_id','uuid'), ('academic_profiles','academic_cycle_id','uuid'),
    ('academic_branches','id','uuid'), ('academic_staff','user_id','uuid'),
    ('academic_staff_branches','user_id','uuid'), ('academic_staff_branches','branch_id','uuid'),
    ('study_materials','user_id','uuid'), ('study_materials','course_id','uuid'),
    ('study_materials','storage_path','text'), ('study_materials','is_shared','bool'),
    ('previous_year_papers','course_id','uuid'), ('previous_year_papers','semester','int2'),
    ('previous_year_papers','storage_path','text')
  ) required(table_name,column_name,udt_name)
  join information_schema.columns actual on actual.table_schema='public'
    and actual.table_name=required.table_name and actual.column_name=required.column_name
  where actual.udt_name <> required.udt_name;
  if incompatible_columns is not null then
    raise exception 'Shared subject migration has incompatible column types: %', array_to_string(incompatible_columns, ', ');
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage schema is unavailable.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='bucket_id')
     or not exists (select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='name')
     or not exists (select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id') then
    raise exception 'Supabase Storage object bucket, name, or owner columns are missing.';
  end if;
  if to_regprocedure('public.is_current_user_active()') is null
     or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.is_assigned_teacher(uuid)') is null then
    raise exception 'Required account, role, or teacher authorization helpers are missing.';
  end if;
  if not exists (select 1 from storage.buckets where id='study-materials' and public is false) then
    raise exception 'The study-materials bucket must already exist and be private. No bucket settings were changed.';
  end if;
  if not exists (select 1 from storage.buckets where id='previous-year-papers' and public is false) then
    raise exception 'The previous-year-papers bucket must exist and be private; PYQ access policies are being preserved.';
  end if;
end;
$$;

create table if not exists public.course_branch_visibility (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  branch_id uuid not null references public.academic_branches(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint course_branch_visibility_course_branch_key unique (course_id, branch_id)
);

do $$
declare
  incompatible_columns text[];
begin
  select array_agg(expected.column_name order by expected.column_name) into incompatible_columns
  from (values ('id','uuid','NO'), ('course_id','uuid','NO'), ('branch_id','uuid','NO'), ('created_at','timestamptz','NO'), ('created_by','uuid','YES')) expected(column_name,udt_name,is_nullable)
  left join information_schema.columns actual on actual.table_schema='public' and actual.table_name='course_branch_visibility'
    and actual.column_name=expected.column_name and actual.udt_name=expected.udt_name and actual.is_nullable=expected.is_nullable
  where actual.column_name is null;
  if incompatible_columns is not null then raise exception 'Existing course_branch_visibility has missing or incompatible columns: %', array_to_string(incompatible_columns, ', '); end if;
  if not exists (select 1 from pg_constraint c where c.conrelid='public.course_branch_visibility'::regclass and c.contype='p' and pg_get_constraintdef(c.oid)='PRIMARY KEY (id)') then
    raise exception 'course_branch_visibility must have PRIMARY KEY (id).';
  end if;
  if exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='course_branch_visibility' and c.column_name in ('id','created_at') and c.column_default is null) then
    raise exception 'course_branch_visibility.id and created_at must have defaults.';
  end if;
  if not exists (
    select 1 from pg_constraint c where c.conrelid='public.course_branch_visibility'::regclass
      and c.contype='u' and c.conkey = array[
        (select attnum from pg_attribute where attrelid='public.course_branch_visibility'::regclass and attname='course_id'),
        (select attnum from pg_attribute where attrelid='public.course_branch_visibility'::regclass and attname='branch_id')
      ]::smallint[]
  ) then raise exception 'course_branch_visibility must have a unique (course_id, branch_id) constraint.'; end if;
  if not exists (select 1 from pg_constraint c where c.conrelid='public.course_branch_visibility'::regclass and c.contype='f' and c.conkey=array[(select attnum from pg_attribute where attrelid='public.course_branch_visibility'::regclass and attname='course_id')]::smallint[] and c.confrelid='public.courses'::regclass and c.confdeltype='c')
     or not exists (select 1 from pg_constraint c where c.conrelid='public.course_branch_visibility'::regclass and c.contype='f' and c.conkey=array[(select attnum from pg_attribute where attrelid='public.course_branch_visibility'::regclass and attname='branch_id')]::smallint[] and c.confrelid='public.academic_branches'::regclass and c.confdeltype='r') then
    raise exception 'course_branch_visibility has missing or incompatible course/branch foreign keys.';
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid='public.course_branch_visibility'::regclass and c.contype='f' and c.conkey=array[(select attnum from pg_attribute where attrelid='public.course_branch_visibility'::regclass and attname='created_by')]::smallint[] and c.confrelid='auth.users'::regclass and c.confdeltype='n') then
    raise exception 'course_branch_visibility must reference auth.users(created_by) with ON DELETE SET NULL.';
  end if;
end;
$$;

create index if not exists course_branch_visibility_branch_course_idx
  on public.course_branch_visibility(branch_id, course_id);
alter table public.course_branch_visibility enable row level security;
revoke all on public.course_branch_visibility from public, anon;
grant select, insert, update, delete on public.course_branch_visibility to authenticated;
grant all on public.course_branch_visibility to service_role;

drop policy if exists "course branch visibility read" on public.course_branch_visibility;
create policy "course branch visibility read" on public.course_branch_visibility
  for select to authenticated using (
    public.is_current_user_active() and (
      public.is_super_admin()
      or exists (select 1 from public.academic_profiles p where p.user_id=auth.uid() and p.branch_id=course_branch_visibility.branch_id)
      or public.is_assigned_teacher(course_branch_visibility.branch_id)
    )
  );
drop policy if exists "course branch visibility super admin manage" on public.course_branch_visibility;
create policy "course branch visibility super admin manage" on public.course_branch_visibility
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "course branch visibility active guard" on public.course_branch_visibility;
create policy "course branch visibility active guard" on public.course_branch_visibility as restrictive
  for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active());
drop policy if exists "course branch visibility read guard" on public.course_branch_visibility;
create policy "course branch visibility read guard" on public.course_branch_visibility as restrictive
  for select to authenticated using (
    public.is_super_admin()
    or exists (select 1 from public.academic_profiles p where p.user_id=auth.uid() and p.branch_id=course_branch_visibility.branch_id)
    or public.is_assigned_teacher(course_branch_visibility.branch_id)
  );
drop policy if exists "course branch visibility insert guard" on public.course_branch_visibility;
create policy "course branch visibility insert guard" on public.course_branch_visibility as restrictive for insert to authenticated with check (public.is_super_admin());
drop policy if exists "course branch visibility update guard" on public.course_branch_visibility;
create policy "course branch visibility update guard" on public.course_branch_visibility as restrictive for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "course branch visibility delete guard" on public.course_branch_visibility;
create policy "course branch visibility delete guard" on public.course_branch_visibility as restrictive for delete to authenticated using (public.is_super_admin());

-- Seed existing centrally-owned course-to-primary-branch associations, then
-- add the requested five CSE subjects to CSE AIML without duplicating courses.
insert into public.course_branch_visibility(course_id, branch_id, created_by)
select c.id, c.branch_id, c.owner_id
from public.courses c
join public.academic_staff s on s.user_id=c.owner_id and s.role='super_admin'
where c.branch_id is not null and c.archived_at is null
on conflict (course_id, branch_id) do nothing;

do $$
declare
  cse_id uuid;
  aiml_id uuid;
  branch_count integer;
  missing_subjects text[];
  duplicate_subjects text[];
begin
  select count(*), (array_agg(id))[1] into branch_count, cse_id from public.academic_branches where lower(btrim(name))='cse' and archived_at is null;
  if branch_count <> 1 then raise exception 'Expected exactly one active CSE branch.'; end if;
  select count(*), (array_agg(id))[1] into branch_count, aiml_id from public.academic_branches where lower(btrim(name))='cse aiml' and archived_at is null;
  if branch_count <> 1 or cse_id=aiml_id then
    raise exception 'Expected one active CSE branch and one active CSE AIML branch; no branch or subject data was changed.';
  end if;
  select array_agg(wanted.name order by wanted.name) into missing_subjects
  from (values
    ('Computer Organization and Architecture'),
    ('Data Structures'),
    ('Database Management System'),
    ('Digital System Design'),
    ('OOP using Java')
  ) wanted(name)
  where not exists (
    select 1 from public.courses c
    where c.branch_id=cse_id and c.archived_at is null
      and lower(btrim(coalesce(nullif(c.name,''),c.title)))=lower(wanted.name)
  );
  if missing_subjects is not null then
    raise exception 'Expected existing CSE subjects are missing: %', array_to_string(missing_subjects, ', ');
  end if;
  select array_agg(wanted.name order by wanted.name) into duplicate_subjects
  from (values
    ('Computer Organization and Architecture'), ('Data Structures'),
    ('Database Management System'), ('Digital System Design'), ('OOP using Java')
  ) wanted(name)
  where (select count(*) from public.courses c where c.branch_id=cse_id and c.archived_at is null
    and lower(btrim(coalesce(nullif(c.name,''),c.title)))=lower(wanted.name)) <> 1;
  if duplicate_subjects is not null then
    raise exception 'CSE subject names must identify exactly one existing course: %', array_to_string(duplicate_subjects, ', ');
  end if;
  insert into public.course_branch_visibility(course_id, branch_id, created_by)
  select c.id, target.branch_id, null
  from public.courses c
  cross join (values (cse_id), (aiml_id)) as target(branch_id)
  where c.branch_id=cse_id and c.archived_at is null
    and lower(btrim(coalesce(nullif(c.name,''),c.title))) in (
      'computer organization and architecture', 'data structures',
      'database management system', 'digital system design', 'oop using java'
    )
  on conflict (course_id, branch_id) do nothing;
end;
$$;

-- The UI changes a subject's full branch set atomically. Direct table writes
-- remain protected by the table's Super Admin-only RLS policies.
create or replace function public.set_course_branch_visibility(p_course_id uuid, p_branch_ids uuid[])
returns void language plpgsql security definer set search_path=pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.is_current_user_active() or not public.is_super_admin() then
    raise exception 'Only an active Super Admin can assign subject branches.' using errcode='42501';
  end if;
  if p_course_id is null or p_branch_ids is null or array_position(p_branch_ids, null::uuid) is not null then
    raise exception 'A course and a non-null branch list are required.' using errcode='22023';
  end if;
  perform 1 from public.courses where id=p_course_id for update;
  if not found then raise exception 'Subject not found.' using errcode='P0002'; end if;
  if exists (
    select 1 from unnest(p_branch_ids) requested(branch_id)
    left join public.academic_branches b on b.id=requested.branch_id and b.archived_at is null
    where b.id is null
  ) then raise exception 'Every selected branch must exist and be active.' using errcode='22023'; end if;
  delete from public.course_branch_visibility m
  where m.course_id=p_course_id and not (m.branch_id=any(p_branch_ids));
  insert into public.course_branch_visibility(course_id, branch_id, created_by)
  select p_course_id, requested.branch_id, auth.uid()
  from (select distinct unnest(p_branch_ids) branch_id) requested
  on conflict (course_id, branch_id) do nothing;
end;
$$;
revoke all on function public.set_course_branch_visibility(uuid, uuid[]) from public, anon;
grant execute on function public.set_course_branch_visibility(uuid, uuid[]) to authenticated;
grant select (branch_id, academic_cycle_id, year_level, archived_at) on public.courses to authenticated;

-- One read predicate for course rows: no semester/cycle condition is used.
drop policy if exists "academic profile branch course read scope" on public.courses;
drop policy if exists "course branch visibility read" on public.courses;
create policy "course branch visibility read" on public.courses for select to authenticated
  using (
    public.is_current_user_active() and (
      public.is_super_admin()
      or owner_id=auth.uid()
      or (
        exists (select 1 from public.academic_staff s where s.user_id=auth.uid() and s.role='teacher')
        and (
          (branch_id is not null and public.is_assigned_teacher(branch_id))
          or exists (select 1 from public.course_branch_visibility m where m.course_id=courses.id and public.is_assigned_teacher(m.branch_id))
        )
      )
      or (
        not exists (select 1 from public.academic_staff s where s.user_id=auth.uid())
        and exists (
          select 1 from public.academic_profiles p
          join public.course_branch_visibility m on m.branch_id=p.branch_id
          where p.user_id=auth.uid() and m.course_id=courses.id
        )
      )
    )
  );
drop policy if exists "course branch visibility read guard" on public.courses;
create policy "course branch visibility read guard" on public.courses as restrictive for select to authenticated
  using (
    public.is_current_user_active() and (archived_at is null or public.is_super_admin())
    and (
      public.is_super_admin()
      or owner_id=auth.uid()
      or (exists (select 1 from public.academic_staff s where s.user_id=auth.uid() and s.role='teacher') and (
        (branch_id is not null and public.is_assigned_teacher(branch_id))
        or exists (select 1 from public.course_branch_visibility m where m.course_id=courses.id and public.is_assigned_teacher(m.branch_id))
      ))
      or (not exists (select 1 from public.academic_staff s where s.user_id=auth.uid()) and exists (
        select 1 from public.academic_profiles p join public.course_branch_visibility m on m.branch_id=p.branch_id
        where p.user_id=auth.uid() and m.course_id=courses.id
      ))
    )
  );

-- Students can retain private personal courses, but cannot mutate any shared
-- or centrally-managed course. Staff management remains assignment-scoped.
create or replace function public.can_manage_personal_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.courses c
    where c.id=p_course_id and c.owner_id=auth.uid()
      and c.branch_id is null and c.academic_cycle_id is null
      and not exists (select 1 from public.course_branch_visibility m where m.course_id=c.id)
      and not exists (select 1 from public.academic_staff s where s.user_id=auth.uid())
  );
$$;
revoke all on function public.can_manage_personal_course(uuid) from public, anon;
grant execute on function public.can_manage_personal_course(uuid) to authenticated;

drop policy if exists "study-sync-course-insert-guard" on public.courses;
create policy "study-sync-course-insert-guard" on public.courses as restrictive for insert to authenticated
  with check (public.is_current_user_active() and (
    public.is_super_admin()
    or (owner_id=auth.uid() and branch_id is null and academic_cycle_id is null
      and not exists (select 1 from public.academic_staff s where s.user_id=auth.uid()))
    or (owner_id=auth.uid() and public.is_assigned_teacher(branch_id))
  ));
drop policy if exists "study-sync-course-update-guard" on public.courses;
create policy "study-sync-course-update-guard" on public.courses as restrictive for update to authenticated
  using (public.is_current_user_active() and (public.is_super_admin() or public.is_assigned_teacher(branch_id) or public.can_manage_personal_course(id)))
  with check (public.is_current_user_active() and (public.is_super_admin() or public.is_assigned_teacher(branch_id)
    or (public.can_manage_personal_course(id) and owner_id=auth.uid() and branch_id is null and academic_cycle_id is null)));
drop policy if exists "study-sync-course-delete-guard" on public.courses;
create policy "study-sync-course-delete-guard" on public.courses as restrictive for delete to authenticated
  using (public.is_current_user_active() and (public.is_super_admin() or public.is_assigned_teacher(branch_id) or public.can_manage_personal_course(id)));

-- Teachers assigned to any mapped branch can manage that course's curriculum.
create or replace function public.can_manage_academic_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog, public
as $$
  select auth.uid() is not null and public.is_current_user_active() and exists (
    select 1 from public.courses c where c.id=p_course_id and (
      public.is_super_admin()
      or (c.branch_id is not null and public.is_assigned_teacher(c.branch_id))
      or exists (select 1 from public.course_branch_visibility m where m.course_id=c.id and public.is_assigned_teacher(m.branch_id))
    )
  );
$$;
revoke all on function public.can_manage_academic_course(uuid) from public, anon;
grant execute on function public.can_manage_academic_course(uuid) to authenticated;

-- Curriculum SELECT remains available only to active users who can see the
-- parent course. This clamps any additional permissive curriculum policies.
drop policy if exists "shared subject units visibility guard" on public.academic_units;
create policy "shared subject units visibility guard" on public.academic_units as restrictive for select to authenticated
  using (public.is_current_user_active() and archived_at is null and exists (select 1 from public.courses c where c.id=academic_units.course_id));
drop policy if exists "shared subject chapters visibility guard" on public.academic_chapters;
create policy "shared subject chapters visibility guard" on public.academic_chapters as restrictive for select to authenticated
  using (public.is_current_user_active() and archived_at is null and exists (
    select 1 from public.academic_units u join public.courses c on c.id=u.course_id
    where u.id=academic_chapters.unit_id and u.archived_at is null
  ));
drop policy if exists "shared subject topics visibility guard" on public.academic_topics;
create policy "shared subject topics visibility guard" on public.academic_topics as restrictive for select to authenticated
  using (public.is_current_user_active() and archived_at is null and exists (
    select 1 from public.academic_chapters ch join public.academic_units u on u.id=ch.unit_id
    join public.courses c on c.id=u.course_id
    where ch.id=academic_topics.chapter_id and ch.archived_at is null and u.archived_at is null
  ));

drop policy if exists "shared subject units write guard" on public.academic_units;
create policy "shared subject units write guard" on public.academic_units as restrictive for insert to authenticated with check (public.can_manage_academic_course(course_id));
drop policy if exists "shared subject units update guard" on public.academic_units;
create policy "shared subject units update guard" on public.academic_units as restrictive for update to authenticated using (public.can_manage_academic_course(course_id)) with check (public.can_manage_academic_course(course_id));
drop policy if exists "shared subject units delete guard" on public.academic_units;
create policy "shared subject units delete guard" on public.academic_units as restrictive for delete to authenticated using (public.can_manage_academic_course(course_id));
drop policy if exists "shared subject chapters insert guard" on public.academic_chapters;
create policy "shared subject chapters insert guard" on public.academic_chapters as restrictive for insert to authenticated with check (exists (select 1 from public.academic_units u where u.id=unit_id and public.can_manage_academic_course(u.course_id)));
drop policy if exists "shared subject chapters update guard" on public.academic_chapters;
create policy "shared subject chapters update guard" on public.academic_chapters as restrictive for update to authenticated using (exists (select 1 from public.academic_units u where u.id=unit_id and public.can_manage_academic_course(u.course_id))) with check (exists (select 1 from public.academic_units u where u.id=unit_id and public.can_manage_academic_course(u.course_id)));
drop policy if exists "shared subject chapters delete guard" on public.academic_chapters;
create policy "shared subject chapters delete guard" on public.academic_chapters as restrictive for delete to authenticated using (exists (select 1 from public.academic_units u where u.id=unit_id and public.can_manage_academic_course(u.course_id)));
drop policy if exists "shared subject topics insert guard" on public.academic_topics;
create policy "shared subject topics insert guard" on public.academic_topics as restrictive for insert to authenticated with check (exists (select 1 from public.academic_chapters ch join public.academic_units u on u.id=ch.unit_id where ch.id=chapter_id and public.can_manage_academic_course(u.course_id)));
drop policy if exists "shared subject topics update guard" on public.academic_topics;
create policy "shared subject topics update guard" on public.academic_topics as restrictive for update to authenticated using (exists (select 1 from public.academic_chapters ch join public.academic_units u on u.id=ch.unit_id where ch.id=chapter_id and public.can_manage_academic_course(u.course_id))) with check (exists (select 1 from public.academic_chapters ch join public.academic_units u on u.id=ch.unit_id where ch.id=chapter_id and public.can_manage_academic_course(u.course_id)));
drop policy if exists "shared subject topics delete guard" on public.academic_topics;
create policy "shared subject topics delete guard" on public.academic_topics as restrictive for delete to authenticated using (exists (select 1 from public.academic_chapters ch join public.academic_units u on u.id=ch.unit_id where ch.id=chapter_id and public.can_manage_academic_course(u.course_id)));

-- Shared material metadata and its Storage object must agree on owner/path and
-- branch-mapped course. No public URL or public-bucket access is introduced.
drop policy if exists "study-sync-shared-material-select" on public.study_materials;
create policy "study-sync-shared-material-select" on public.study_materials for select to authenticated
  using (user_id=auth.uid() or public.is_super_admin() or (is_shared is true and exists (
    select 1 from public.courses c join public.course_branch_visibility m on m.course_id=c.id
    where c.id=study_materials.course_id and (
      (not exists (select 1 from public.academic_staff s where s.user_id=auth.uid())
        and exists (select 1 from public.academic_profiles p where p.user_id=auth.uid() and p.branch_id=m.branch_id))
      or public.is_assigned_teacher(m.branch_id)
    )
  )));
drop policy if exists "study-sync-material-select-guard" on public.study_materials;
create policy "study-sync-material-select-guard" on public.study_materials as restrictive for select to public
  using (auth.uid() is not null and public.is_current_user_active() and (user_id=auth.uid() or public.is_super_admin() or (is_shared is true and exists (
    select 1 from public.courses c join public.course_branch_visibility m on m.course_id=c.id
    where c.id=study_materials.course_id and (
      (not exists (select 1 from public.academic_staff s where s.user_id=auth.uid())
        and exists (select 1 from public.academic_profiles p where p.user_id=auth.uid() and p.branch_id=m.branch_id))
      or public.is_assigned_teacher(m.branch_id)
    )
  ))));

drop policy if exists "study-sync-material-insert" on public.study_materials;
create policy "study-sync-material-insert" on public.study_materials for insert to authenticated
  with check (public.is_current_user_active() and (user_id=auth.uid() or public.is_super_admin()) and course_id is not null and exists (select 1 from public.courses c where c.id=study_materials.course_id));
drop policy if exists "study-sync-material-insert-guard" on public.study_materials;
create policy "study-sync-material-insert-guard" on public.study_materials as restrictive for insert to public
  with check (auth.uid() is not null and public.is_current_user_active() and (user_id=auth.uid() or public.is_super_admin()) and course_id is not null and exists (select 1 from public.courses c where c.id=study_materials.course_id));
drop policy if exists "study-sync-material-update" on public.study_materials;
create policy "study-sync-material-update" on public.study_materials for update to authenticated
  using (user_id=auth.uid() or public.is_super_admin())
  with check ((user_id=auth.uid() or public.is_super_admin()) and course_id is not null and exists (select 1 from public.courses c where c.id=study_materials.course_id));
drop policy if exists "study-sync-material-update-guard" on public.study_materials;
create policy "study-sync-material-update-guard" on public.study_materials as restrictive for update to public
  using (auth.uid() is not null and public.is_current_user_active() and (user_id=auth.uid() or public.is_super_admin()))
  with check (auth.uid() is not null and public.is_current_user_active() and (user_id=auth.uid() or public.is_super_admin()) and course_id is not null and exists (select 1 from public.courses c where c.id=study_materials.course_id));
drop policy if exists "study-sync-material-delete" on public.study_materials;
create policy "study-sync-material-delete" on public.study_materials for delete to authenticated using (user_id=auth.uid() or public.is_super_admin());
drop policy if exists "study-sync-material-delete-guard" on public.study_materials;
create policy "study-sync-material-delete-guard" on public.study_materials as restrictive for delete to public
  using (auth.uid() is not null and public.is_current_user_active() and (user_id=auth.uid() or public.is_super_admin()));

drop policy if exists "study-sync-shared-material-file-select" on storage.objects;
create policy "study-sync-shared-material-file-select" on storage.objects for select to authenticated using (
  bucket_id='study-materials' and exists (
    select 1 from public.study_materials m
    where m.storage_path=storage.objects.name and m.user_id::text=storage.objects.owner_id::text
      and (m.user_id=auth.uid() or public.is_super_admin() or m.is_shared is true)
  )
);
drop policy if exists "study-sync-shared-material-file-select-guard" on storage.objects;
create policy "study-sync-shared-material-file-select-guard" on storage.objects as restrictive for select to public using (
  bucket_id<>'study-materials' or (auth.uid() is not null and public.is_current_user_active() and exists (
    select 1 from public.study_materials m
    where m.storage_path=storage.objects.name and m.user_id::text=storage.objects.owner_id::text
      and (m.user_id=auth.uid() or public.is_super_admin() or (m.is_shared is true and exists (
        select 1 from public.courses c join public.course_branch_visibility map on map.course_id=c.id
        where c.id=m.course_id and (
          (not exists (select 1 from public.academic_staff s where s.user_id=auth.uid())
            and exists (select 1 from public.academic_profiles p where p.user_id=auth.uid() and p.branch_id=map.branch_id))
          or public.is_assigned_teacher(map.branch_id)
        )
      )))
  ))
);

drop policy if exists "study-sync-shared-material-file-delete-admin" on storage.objects;
create policy "study-sync-shared-material-file-delete-admin" on storage.objects for delete to authenticated
  using (bucket_id='study-materials' and public.is_super_admin());
drop policy if exists "study-sync-material-file-delete-guard" on storage.objects;
create policy "study-sync-material-file-delete-guard" on storage.objects as restrictive for delete to public
  using (bucket_id<>'study-materials' or (auth.uid() is not null and public.is_current_user_active()
    and (owner_id::text=auth.uid()::text or public.is_super_admin())));
drop policy if exists "study-sync-shared-material-file-update-admin" on storage.objects;
create policy "study-sync-shared-material-file-update-admin" on storage.objects for update to authenticated
  using (bucket_id='study-materials' and public.is_super_admin())
  with check (bucket_id='study-materials' and public.is_super_admin());
drop policy if exists "study-sync-material-file-update-guard" on storage.objects;
create policy "study-sync-material-file-update-guard" on storage.objects as restrictive for update to public
  using (bucket_id<>'study-materials' or (auth.uid() is not null and public.is_current_user_active()
    and (owner_id::text=auth.uid()::text or public.is_super_admin())))
  with check (bucket_id<>'study-materials' or (auth.uid() is not null and public.is_current_user_active()
    and (owner_id::text=auth.uid()::text or public.is_super_admin())));

-- Preserve PYQ's semester, cycle, verified/published, active-account and
-- teacher-denial checks while recognizing the new branch mapping. The only
-- scope change is that a mapped branch can read its existing paper.
drop policy if exists "published verified papers read" on public.previous_year_papers;
create policy "published verified papers read" on public.previous_year_papers for select to authenticated
  using (public.is_current_user_active() and (public.is_super_admin() or (
    is_published and verified and course_id is not null
    and not exists (select 1 from public.academic_staff staff where staff.user_id=auth.uid())
    and exists (
      select 1 from public.academic_profiles profile
      join public.courses course on course.id=previous_year_papers.course_id
      join public.course_branch_visibility mapping on mapping.course_id=course.id
        and mapping.branch_id=profile.branch_id
      where profile.user_id=auth.uid()
        and profile.branch_id is not null
        and (course.academic_cycle_id is null or course.academic_cycle_id=profile.academic_cycle_id)
        and profile.semester=previous_year_papers.semester
        and course.semester=previous_year_papers.semester
    )
  )));
drop policy if exists "paper allocation read guard" on public.previous_year_papers;
create policy "paper allocation read guard" on public.previous_year_papers as restrictive for select to authenticated
  using (public.is_super_admin() or (
    is_published and verified and course_id is not null
    and not exists (select 1 from public.academic_staff staff where staff.user_id=auth.uid())
    and exists (
      select 1 from public.academic_profiles profile
      join public.courses course on course.id=previous_year_papers.course_id
      join public.course_branch_visibility mapping on mapping.course_id=course.id
        and mapping.branch_id=profile.branch_id
      where profile.user_id=auth.uid() and profile.branch_id is not null
        and (course.academic_cycle_id is null or course.academic_cycle_id=profile.academic_cycle_id)
        and profile.semester=previous_year_papers.semester
        and course.semester=previous_year_papers.semester
    )
  ));

drop policy if exists "published pyq objects read" on storage.objects;
create policy "published pyq objects read" on storage.objects for select to authenticated using (
  bucket_id='previous-year-papers' and public.is_current_user_active() and (
    public.is_super_admin() or exists (
      select 1 from public.previous_year_papers paper
      join public.academic_profiles profile on profile.user_id=auth.uid()
      join public.courses course on course.id=paper.course_id
      join public.course_branch_visibility mapping on mapping.course_id=course.id and mapping.branch_id=profile.branch_id
      where paper.storage_path=storage.objects.name and paper.is_published and paper.verified
        and profile.branch_id is not null
        and not exists (select 1 from public.academic_staff staff where staff.user_id=auth.uid())
        and (course.academic_cycle_id is null or course.academic_cycle_id=profile.academic_cycle_id)
        and profile.semester=paper.semester and course.semester=paper.semester
    )
  )
);
drop policy if exists "pyq object select access guard" on storage.objects;
create policy "pyq object select access guard" on storage.objects as restrictive for select to authenticated using (
  bucket_id<>'previous-year-papers' or (public.is_current_user_active() and (
    public.is_super_admin() or exists (
      select 1 from public.previous_year_papers paper
      join public.academic_profiles profile on profile.user_id=auth.uid()
      join public.courses course on course.id=paper.course_id
      join public.course_branch_visibility mapping on mapping.course_id=course.id and mapping.branch_id=profile.branch_id
      where paper.storage_path=storage.objects.name and paper.is_published and paper.verified
        and profile.branch_id is not null
        and not exists (select 1 from public.academic_staff staff where staff.user_id=auth.uid())
        and (course.academic_cycle_id is null or course.academic_cycle_id=profile.academic_cycle_id)
        and profile.semester=paper.semester and course.semester=paper.semester
    )
  ))
);

notify pgrst, 'reload schema';
commit;
