-- RBAC foundation for Study Sync. Additive and deliberately unapplied.
-- Run only after reviewing against the target project's pg_policies/grants.
begin;

-- Reuse the existing protected staff table. Students are implicit when they
-- have no academic_staff row; clients cannot write staff roles.
alter table public.academic_staff drop constraint if exists academic_staff_role_check;
update public.academic_staff set role = 'super_admin' where role = 'admin';
alter table public.academic_staff
  add constraint academic_staff_role_check check (role in ('super_admin', 'teacher'));
revoke all on table public.academic_staff from public, anon, authenticated;
grant select on table public.academic_staff to authenticated;
grant all on table public.academic_staff to service_role;

create table if not exists public.academic_staff_branches (
  user_id uuid not null references public.academic_staff(user_id) on delete cascade,
  branch_id uuid not null references public.academic_branches(id) on delete restrict,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_user_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  suspended_at timestamptz not null default now(),
  suspended_by uuid references auth.users(id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.academic_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  audience text not null default 'all' check (audience in ('all', 'students', 'teachers')),
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  setting_key text primary key check (char_length(setting_key) between 1 and 100),
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Shared curriculum is kept separate from course_chapters/course_topics,
-- which contain student-owned progress and must remain private.
create table if not exists public.academic_units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  position integer not null default 0 check (position >= 0),
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_chapters (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.academic_units(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  position integer not null default 0 check (position >= 0),
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_topics (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.academic_chapters(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  position integer not null default 0 check (position >= 0),
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '',
  due_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Aggregate-only server helper. The function is not callable by browser roles.
create or replace function public.admin_task_count()
returns bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(sum(
    case when jsonb_typeof(data) = 'array' then jsonb_array_length(data) else 0 end
  ), 0)::bigint
  from public.user_app_data where data_key = 'tasks';
$$;
revoke all on function public.admin_task_count() from public, anon, authenticated;
grant execute on function public.admin_task_count() to service_role;

-- Serialize role changes so two simultaneous requests cannot remove the last
-- Super Admin. Only the verified server-side service client can execute this.
create or replace function public.set_platform_user_role(
  p_actor_id uuid, p_target_id uuid, p_role text
)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  current_role text;
  admin_count bigint;
begin
  if p_role not in ('student', 'teacher', 'super_admin') then
    raise exception 'Unsupported platform role.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.academic_staff where user_id = p_actor_id and role = 'super_admin') then
    raise exception 'Super Admin access is required.' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_user_status where user_id = p_actor_id) then
    raise exception 'This account is suspended.' using errcode = '42501';
  end if;
  if p_actor_id = p_target_id then
    raise exception 'You cannot change your own role.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(7710064291::bigint);
  select role into current_role from public.academic_staff where user_id = p_target_id for update;
  if current_role = 'super_admin' and p_role <> 'super_admin' then
    select count(*) into admin_count from public.academic_staff where role = 'super_admin';
    if admin_count <= 1 then
      raise exception 'The last Super Admin cannot be removed.' using errcode = '23514';
    end if;
  end if;

  if p_role = 'student' then
    delete from public.academic_staff where user_id = p_target_id;
  else
    insert into public.academic_staff(user_id, role) values (p_target_id, p_role)
    on conflict (user_id) do update set role = excluded.role;
  end if;
  if p_role <> 'teacher' then
    delete from public.academic_staff_branches where user_id = p_target_id;
  end if;
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'role_changed', 'user', p_target_id::text,
    jsonb_build_object('from', coalesce(current_role, 'student'), 'to', p_role));
end;
$$;
revoke all on function public.set_platform_user_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_platform_user_role(uuid, uuid, text) to service_role;

alter table public.courses
  add column if not exists archived_at timestamptz;
alter table public.study_materials
  add column if not exists archived_at timestamptz;
alter table public.academic_degrees
  add column if not exists archived_at timestamptz;
alter table public.academic_branches
  add column if not exists archived_at timestamptz;
alter table public.academic_cycles
  add column if not exists archived_at timestamptz;

create index if not exists academic_staff_branches_branch_user_idx
  on public.academic_staff_branches (branch_id, user_id);
create index if not exists platform_audit_logs_created_idx
  on public.platform_audit_logs (created_at desc);
create index if not exists academic_units_course_position_idx
  on public.academic_units (course_id, position);
create index if not exists academic_chapters_unit_position_idx
  on public.academic_chapters (unit_id, position);
create index if not exists academic_topics_chapter_position_idx
  on public.academic_topics (chapter_id, position);
create index if not exists academic_assignments_course_due_idx
  on public.academic_assignments (course_id, due_at);

create or replace function public.is_current_user_active()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and not exists (
    select 1 from public.platform_user_status s where s.user_id = auth.uid()
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.academic_staff s
    where s.user_id = auth.uid() and s.role = 'super_admin'
  ) and public.is_current_user_active();
$$;

create or replace function public.is_assigned_teacher(p_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.is_current_user_active() and p_branch_id is not null and exists (
    select 1
    from public.academic_staff s
    join public.academic_staff_branches sb on sb.user_id = s.user_id
    where s.user_id = auth.uid() and s.role = 'teacher'
      and sb.branch_id = p_branch_id
  );
$$;

create or replace function public.can_manage_academic_course(p_course_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id
      and (public.is_super_admin()
        or public.is_assigned_teacher(c.branch_id))
  );
$$;

revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.is_current_user_active() from public, anon;
revoke all on function public.is_assigned_teacher(uuid) from public, anon;
revoke all on function public.can_manage_academic_course(uuid) from public, anon;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_current_user_active() to authenticated;
grant execute on function public.is_assigned_teacher(uuid) to authenticated;
grant execute on function public.can_manage_academic_course(uuid) to authenticated;

alter table public.academic_staff_branches enable row level security;
alter table public.platform_user_status enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.academic_announcements enable row level security;
alter table public.platform_settings enable row level security;
alter table public.academic_units enable row level security;
alter table public.academic_chapters enable row level security;
alter table public.academic_topics enable row level security;
alter table public.academic_assignments enable row level security;

revoke all on public.academic_staff_branches, public.platform_user_status, public.platform_audit_logs,
  public.academic_announcements, public.platform_settings,
  public.academic_units, public.academic_chapters, public.academic_topics,
  public.academic_assignments from public, anon;
grant select on public.academic_staff_branches to authenticated;
grant select on public.platform_user_status to authenticated;
grant select on public.platform_audit_logs to authenticated;
grant select, insert, update, delete on public.academic_announcements,
  public.platform_settings, public.academic_units, public.academic_chapters,
  public.academic_topics, public.academic_assignments to authenticated;
grant all on public.academic_staff_branches, public.platform_user_status, public.platform_audit_logs,
  public.academic_announcements, public.platform_settings,
  public.academic_units, public.academic_chapters, public.academic_topics,
  public.academic_assignments to service_role;
grant usage, select on sequence public.platform_audit_logs_id_seq to service_role;

drop policy if exists "academic staff branch assignments visible" on public.academic_staff_branches;
create policy "academic staff branch assignments visible" on public.academic_staff_branches
  for select to authenticated using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "super admins read user status" on public.platform_user_status;
create policy "super admins read user status" on public.platform_user_status
  for select to authenticated using (public.is_super_admin());

drop policy if exists "super admins read audit logs" on public.platform_audit_logs;
create policy "super admins read audit logs" on public.platform_audit_logs
  for select to authenticated using (public.is_super_admin());

drop policy if exists "published announcements read" on public.academic_announcements;
create policy "published announcements read" on public.academic_announcements
  for select to authenticated using (
    archived_at is null and published_at <= now() and (
      audience = 'all'
      or (audience = 'teachers' and exists (
        select 1 from public.academic_staff s where s.user_id = auth.uid() and s.role in ('teacher', 'super_admin')
      ))
      or (audience = 'students' and not exists (
        select 1 from public.academic_staff s where s.user_id = auth.uid()
      ))
    )
  );
drop policy if exists "super admins manage announcements" on public.academic_announcements;
create policy "super admins manage announcements" on public.academic_announcements
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "super admins manage platform settings" on public.platform_settings;
create policy "super admins manage platform settings" on public.platform_settings
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

-- Staff catalog writes are super-admin-only. Teachers manage assigned courses
-- and curriculum, never role assignments or global catalogs.
drop policy if exists "academic degrees staff manage" on public.academic_degrees;
create policy "academic degrees super admins manage" on public.academic_degrees
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "academic branches staff manage" on public.academic_branches;
create policy "academic branches super admins manage" on public.academic_branches
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "academic cycles staff manage" on public.academic_cycles;
create policy "academic cycles super admins manage" on public.academic_cycles
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists "super admins read academic profiles" on public.academic_profiles;
create policy "super admins read academic profiles" on public.academic_profiles
  for select to authenticated using (public.is_super_admin());

drop policy if exists "study-sync-course-archive-guard" on public.courses;
create policy "study-sync-course-archive-guard" on public.courses as restrictive
  for select to authenticated using (
    auth.uid() is not null and (archived_at is null or public.is_super_admin())
  );
drop policy if exists "study-sync-course-active-user-guard" on public.courses;
create policy "study-sync-course-active-user-guard" on public.courses as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-material-archive-guard" on public.study_materials;
create policy "study-sync-material-archive-guard" on public.study_materials as restrictive
  for select to authenticated using (
    archived_at is null or public.is_super_admin()
  );
drop policy if exists "study-sync-material-active-user-guard" on public.study_materials;
create policy "study-sync-material-active-user-guard" on public.study_materials as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());

drop policy if exists "study-sync-app-data-active-user-guard" on public.user_app_data;
create policy "study-sync-app-data-active-user-guard" on public.user_app_data as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-academic-profile-active-user-guard" on public.academic_profiles;
create policy "study-sync-academic-profile-active-user-guard" on public.academic_profiles as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-chapter-progress-active-user-guard" on public.course_chapters;
create policy "study-sync-chapter-progress-active-user-guard" on public.course_chapters as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-topic-progress-active-user-guard" on public.course_topics;
create policy "study-sync-topic-progress-active-user-guard" on public.course_topics as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-academic-staff-active-user-guard" on public.academic_staff;
create policy "study-sync-academic-staff-active-user-guard" on public.academic_staff as restrictive
  for select to authenticated using (public.is_current_user_active());
drop policy if exists "study-sync-staff-branches-active-user-guard" on public.academic_staff_branches;
create policy "study-sync-staff-branches-active-user-guard" on public.academic_staff_branches as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-announcements-active-user-guard" on public.academic_announcements;
create policy "study-sync-announcements-active-user-guard" on public.academic_announcements as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-settings-active-user-guard" on public.platform_settings;
create policy "study-sync-settings-active-user-guard" on public.platform_settings as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-units-active-user-guard" on public.academic_units;
create policy "study-sync-units-active-user-guard" on public.academic_units as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-curriculum-chapters-active-user-guard" on public.academic_chapters;
create policy "study-sync-curriculum-chapters-active-user-guard" on public.academic_chapters as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-curriculum-topics-active-user-guard" on public.academic_topics;
create policy "study-sync-curriculum-topics-active-user-guard" on public.academic_topics as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());
drop policy if exists "study-sync-assignments-active-user-guard" on public.academic_assignments;
create policy "study-sync-assignments-active-user-guard" on public.academic_assignments as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());

drop policy if exists "study-sync-storage-active-user-guard" on storage.objects;
create policy "study-sync-storage-active-user-guard" on storage.objects as restrictive
  for all to authenticated
  using (bucket_id not in ('study-materials', 'profile-photos') or public.is_current_user_active())
  with check (bucket_id not in ('study-materials', 'profile-photos') or public.is_current_user_active());

-- Course owner controls continue to apply to students. Super admins and
-- teachers with a branch assignment get explicit row-scoped management rights.
drop policy if exists "super admins manage courses" on public.courses;
create policy "super admins manage courses" on public.courses
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "assigned teachers manage courses" on public.courses;
create policy "assigned teachers manage courses" on public.courses
  for all to authenticated using (public.is_assigned_teacher(branch_id))
  with check (public.is_assigned_teacher(branch_id));

drop policy if exists "study-sync-course-insert-guard" on public.courses;
create policy "study-sync-course-insert-guard" on public.courses as restrictive
  for insert to authenticated with check (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_super_admin())
  );
drop policy if exists "study-sync-course-update-guard" on public.courses;
create policy "study-sync-course-update-guard" on public.courses as restrictive
  for update to authenticated using (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_super_admin()
      or public.is_assigned_teacher(branch_id))
  ) with check (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_super_admin()
      or public.is_assigned_teacher(branch_id))
  );
drop policy if exists "study-sync-course-delete-guard" on public.courses;
create policy "study-sync-course-delete-guard" on public.courses as restrictive
  for delete to authenticated using (
    auth.uid() is not null and (owner_id = auth.uid() or public.is_super_admin()
      or public.is_assigned_teacher(branch_id))
  );

-- Teachers may review assigned students' chapter progress. Students retain
-- their existing own-row management policies; staff gain read-only access.
drop policy if exists "assigned staff read chapter progress" on public.course_chapters;
create policy "assigned staff read chapter progress" on public.course_chapters
  for select to authenticated using (
    public.is_super_admin() or exists (
      select 1 from public.courses c
      where c.id = course_chapters.course_id and public.is_assigned_teacher(c.branch_id)
    )
  );
drop policy if exists "assigned staff read topic progress" on public.course_topics;
create policy "assigned staff read topic progress" on public.course_topics
  for select to authenticated using (
    public.is_super_admin() or exists (
      select 1 from public.course_chapters ch
      join public.courses c on c.id = ch.course_id
      where ch.id = course_topics.chapter_id and public.is_assigned_teacher(c.branch_id)
    )
  );

-- Shared curriculum content is separate from personal progress rows.
drop policy if exists "academic curriculum authenticated read" on public.academic_units;
create policy "academic curriculum authenticated read" on public.academic_units
  for select to authenticated using (archived_at is null and exists (
    select 1 from public.courses c where c.id = course_id and c.archived_at is null
  ));
drop policy if exists "academic curriculum managers units" on public.academic_units;
create policy "academic curriculum managers units" on public.academic_units
  for all to authenticated using (public.can_manage_academic_course(course_id))
  with check (public.can_manage_academic_course(course_id));

drop policy if exists "academic curriculum authenticated read chapters" on public.academic_chapters;
create policy "academic curriculum authenticated read chapters" on public.academic_chapters
  for select to authenticated using (archived_at is null and exists (
    select 1 from public.academic_units u where u.id = unit_id and u.archived_at is null
  ));
drop policy if exists "academic curriculum managers chapters" on public.academic_chapters;
create policy "academic curriculum managers chapters" on public.academic_chapters
  for all to authenticated using (exists (
    select 1 from public.academic_units u where u.id = unit_id and public.can_manage_academic_course(u.course_id)
  )) with check (exists (
    select 1 from public.academic_units u where u.id = unit_id and public.can_manage_academic_course(u.course_id)
  ));

drop policy if exists "academic curriculum authenticated read topics" on public.academic_topics;
create policy "academic curriculum authenticated read topics" on public.academic_topics
  for select to authenticated using (archived_at is null and exists (
    select 1 from public.academic_chapters ch join public.academic_units u on u.id = ch.unit_id
    where ch.id = chapter_id and ch.archived_at is null and u.archived_at is null
  ));
drop policy if exists "academic curriculum managers topics" on public.academic_topics;
create policy "academic curriculum managers topics" on public.academic_topics
  for all to authenticated using (exists (
    select 1 from public.academic_chapters ch join public.academic_units u on u.id = ch.unit_id
    where ch.id = chapter_id and public.can_manage_academic_course(u.course_id)
  )) with check (exists (
    select 1 from public.academic_chapters ch join public.academic_units u on u.id = ch.unit_id
    where ch.id = chapter_id and public.can_manage_academic_course(u.course_id)
  ));

drop policy if exists "academic assignments authenticated read" on public.academic_assignments;
create policy "academic assignments authenticated read" on public.academic_assignments
  for select to authenticated using (archived_at is null and exists (
    select 1 from public.courses c where c.id = course_id and c.archived_at is null
  ));
drop policy if exists "academic assignments managers" on public.academic_assignments;
create policy "academic assignments managers" on public.academic_assignments
  for all to authenticated using (public.can_manage_academic_course(course_id))
  with check (public.can_manage_academic_course(course_id));

-- Append-only audit records from authenticated catalog/curriculum/course edits.
create or replace function public.log_academic_admin_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  changed text[];
  old_row jsonb;
  new_row jsonb;
begin
  -- Service-role API mutations record their verified actor explicitly.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  old_row := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  select coalesce(array_agg(key order by key), '{}') into changed
  from (
    select coalesce(n.key, o.key) as key
    from jsonb_each(new_row) n full join jsonb_each(old_row) o using (key)
    where n.value is distinct from o.value
  ) diff;
  insert into public.platform_audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), lower(tg_op), tg_table_name,
    coalesce(new_row->>'id', old_row->>'id', new_row->>'setting_key', old_row->>'setting_key'),
    jsonb_build_object('changed_fields', changed)
  );
  return coalesce(new, old);
end;
$$;
revoke all on function public.log_academic_admin_change() from public, anon, authenticated;

drop trigger if exists audit_academic_degrees on public.academic_degrees;
create trigger audit_academic_degrees after insert or update or delete on public.academic_degrees
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_academic_branches on public.academic_branches;
create trigger audit_academic_branches after insert or update or delete on public.academic_branches
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_academic_cycles on public.academic_cycles;
create trigger audit_academic_cycles after insert or update or delete on public.academic_cycles
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_courses on public.courses;
create trigger audit_courses after insert or update or delete on public.courses
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_academic_units on public.academic_units;
create trigger audit_academic_units after insert or update or delete on public.academic_units
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_academic_chapters on public.academic_chapters;
create trigger audit_academic_chapters after insert or update or delete on public.academic_chapters
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_academic_topics on public.academic_topics;
create trigger audit_academic_topics after insert or update or delete on public.academic_topics
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_academic_assignments on public.academic_assignments;
create trigger audit_academic_assignments after insert or update or delete on public.academic_assignments
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_announcements on public.academic_announcements;
create trigger audit_announcements after insert or update or delete on public.academic_announcements
  for each row execute function public.log_academic_admin_change();
drop trigger if exists audit_platform_settings on public.platform_settings;
create trigger audit_platform_settings after insert or update or delete on public.platform_settings
  for each row execute function public.log_academic_admin_change();

notify pgrst, 'reload schema';
commit;
